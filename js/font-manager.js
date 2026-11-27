/**
 * font-manager.js — WOFF2 分片匹配、持久缓存、弱网重试与离线本机字体导入
 *
 * 三个编辑器与导出模块共用。不强依赖 DOM，可在 Node 单元测试中直接运行。
 */
(function (global) {
  'use strict';

  var FONT_CACHE_NAME = 'crt-sign-fonts-cache-v1';
  var DB_NAME = 'crt-sign-fonts-v1';
  var STORE_NAME = 'local-fonts';
  var SYNC_CHANNEL_NAME = 'crt-sign-fonts-sync';
  var SYNC_STORAGE_KEY = 'crt-sign-fonts-sync-ts';

  var SLOTS = {
    zh400: { key: 'zh400', file: 'MiSans-Regular.ttf', family: 'MiSans', weight: 400, label: 'MiSans 常规（400）' },
    zh600: { key: 'zh600', file: 'MiSans-Semibold.ttf', family: 'MiSans', weight: 600, label: 'MiSans 中粗（600）' },
    zh700: { key: 'zh700', file: 'MiSans-Bold.ttf', family: 'MiSans', weight: 700, label: 'MiSans 粗体（700）' },
    num400: { key: 'num400', file: 'Frutiger-Regular.ttf', family: 'Frutiger', weight: 400, label: 'Frutiger 编号（400）' },
  };
  var SLOT_ORDER = ['zh400', 'zh600', 'zh700', 'num400'];

  var FILE_TO_SLOT = {};
  SLOT_ORDER.forEach(function (key) { FILE_TO_SLOT[SLOTS[key].file] = key; });

  var parsedChunkCache = new WeakMap();
  var inflightBlobs = new Map();
  var localFontRecords = new Map();
  var registeredFaces = new Map();
  var restorePromise = null;
  var swRegistered = false;
  var syncChannel = null;

  // ─── 分片区间解析与字符匹配 ─────────────────────────────────

  function parseUnicodeRanges(rangeStr) {
    if (!rangeStr) return [];
    var parts = rangeStr.split(',');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var token = parts[i].trim().replace(/^U\+/i, '');
      if (!token) continue;
      var dash = token.indexOf('-');
      if (dash >= 0) {
        var start = parseInt(token.slice(0, dash), 16);
        var end = parseInt(token.slice(dash + 1), 16);
        if (!isNaN(start) && !isNaN(end)) out.push([start, end]);
      } else {
        var point = parseInt(token, 16);
        if (!isNaN(point)) out.push([point, point]);
      }
    }
    return out;
  }

  function getParsedChunks(chunks) {
    if (!Array.isArray(chunks)) return [];
    var cached = parsedChunkCache.get(chunks);
    if (cached) return cached;
    cached = chunks.map(function (chunk) {
      return {
        file: chunk.file,
        unicodeRange: chunk.unicodeRange,
        ranges: parseUnicodeRanges(chunk.unicodeRange),
      };
    });
    parsedChunkCache.set(chunks, cached);
    return cached;
  }

  function rangesContain(ranges, cp) {
    var lo = 0, hi = ranges.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var pair = ranges[mid];
      if (cp < pair[0]) hi = mid - 1;
      else if (cp > pair[1]) lo = mid + 1;
      else return true;
    }
    return false;
  }

  function getFamilyManifest(file) {
    var manifest = global.SignFontManifest;
    if (!manifest || !manifest.families || !manifest.families[file]) return null;
    var entry = manifest.families[file];
    var rawChunks = entry.chunks || manifest.sharedChunks;
    if (!Array.isArray(rawChunks) || !rawChunks.length) return null;
    return {
      version: manifest.version || 'v1',
      family: entry.family,
      weight: entry.weight,
      basePath: entry.basePath,
      format: entry.format || 'woff2',
      mime: entry.mime || 'font/woff2',
      chunks: getParsedChunks(rawChunks),
    };
  }

  /** 按给定文本解析该字体文件命中的分片列表（保持顺序并去重）。 */
  function resolveChunks(file, text) {
    var info = getFamilyManifest(file);
    if (!info) return null;
    if (!text) return [];
    var seen = new Set();
    var matched = [];
    var codepoints = new Set();
    for (var ch of String(text)) {
      var cp = ch.codePointAt(0);
      if (cp !== undefined) codepoints.add(cp);
    }
    for (var i = 0; i < info.chunks.length; i++) {
      var chunk = info.chunks[i];
      if (seen.has(chunk.file)) continue;
      for (var point of codepoints) {
        if (rangesContain(chunk.ranges, point)) {
          seen.add(chunk.file);
          matched.push({
            file: chunk.file,
            url: info.basePath + chunk.file,
            unicodeRange: chunk.unicodeRange,
            format: info.format,
            mime: info.mime,
          });
          break;
        }
      }
    }
    return matched;
  }

  /** 根据项目实际使用的字体键筛选预加载列表。 */
  function specsForUsedFonts(usedFonts, allSpecs) {
    var specs = allSpecs || (global.SignCore && global.SignCore.FONT_LOAD_SPECS) || [];
    if (!usedFonts || typeof usedFonts !== 'object') return specs.slice();
    var wanted = {};
    Object.keys(usedFonts).forEach(function (key) {
      if (!usedFonts[key]) return;
      if (key === 'en400') wanted.zh400 = true;
      else if (key === 'en700') wanted.zh700 = true;
      else wanted[key] = true;
    });
    var picked = specs.filter(function (spec) { return !!wanted[spec.key]; });
    return picked.length ? picked : specs.slice();
  }

  // ─── 持久缓存与自动重试下载 ─────────────────────────────────

  function normalizeCacheKey(url) {
    try {
      if (global.location && /^https?:$/i.test(global.location.protocol) && global.URL) {
        return new global.URL(url, global.location.href).href;
      }
    } catch (_) { /* 保持原路径 */ }
    return url;
  }

  function openFontCache() {
    if (!global.caches || typeof global.caches.open !== 'function') return Promise.resolve(null);
    return global.caches.open(FONT_CACHE_NAME).catch(function () { return null; });
  }

  function delay(ms) {
    return new Promise(function (resolve) { global.setTimeout(resolve, ms); });
  }

  function fetchWithRetry(url, retries, retryDelayMs) {
    var attempts = Math.max(1, retries || 3);
    var baseDelay = retryDelayMs === undefined ? 300 : retryDelayMs;
    var index = 0;

    function attempt() {
      index += 1;
      return global.fetch(url).then(function (response) {
        if (response && response.ok) return response;
        var status = response ? response.status : 0;
        var err = new Error('字体加载失败：' + url + (status ? '（HTTP ' + status + '）' : ''));
        err.status = status;
        // 4xx 属于客户端/资源缺失错误，无需重复请求。
        if (status >= 400 && status < 500) err.noRetry = true;
        throw err;
      }).catch(function (err) {
        if (err && err.noRetry || index >= attempts) throw err;
        return delay(baseDelay * Math.pow(2, index - 1)).then(attempt);
      });
    }
    return attempt();
  }

  function fetchFontBlob(url, options) {
    options = options || {};
    var cacheKey = normalizeCacheKey(url);
    if (inflightBlobs.has(cacheKey)) return inflightBlobs.get(cacheKey);

    var task = openFontCache().then(function (cache) {
      if (!cache) return null;
      return cache.match(cacheKey).then(function (hit) {
        if (hit) return hit;
        if (cacheKey !== url) return cache.match(url);
        return null;
      }).catch(function () { return null; });
    }).then(function (cachedResponse) {
      if (cachedResponse) return cachedResponse.blob();
      return fetchWithRetry(url, options.retries ?? 3, options.retryDelayMs).then(function (response) {
        var cloned = typeof response.clone === 'function' ? response.clone() : null;
        return openFontCache().then(function (cache) {
          if (cache && cloned) {
            return cache.put(cacheKey, cloned).catch(function () {});
          }
        }).then(function () {
          return response.blob();
        });
      });
    }).then(function (blob) {
      if (options.mime && blob && typeof blob.slice === 'function') {
        return blob.slice(0, blob.size, options.mime);
      }
      return blob;
    }).finally(function () {
      inflightBlobs.delete(cacheKey);
    });

    inflightBlobs.set(cacheKey, task);
    return task;
  }

  function getCacheStats() {
    return openFontCache().then(function (cache) {
      if (!cache || typeof cache.keys !== 'function') return { chunkCount: 0, totalBytes: 0 };
      return cache.keys().then(function (keys) {
        return { chunkCount: keys.length, totalBytes: 0 };
      }).catch(function () { return { chunkCount: 0, totalBytes: 0 }; });
    });
  }

  function clearOnlineCache() {
    var jobs = [];
    if (global.caches && typeof global.caches.delete === 'function') {
      jobs.push(global.caches.delete(FONT_CACHE_NAME).catch(function () {}));
    }
    try {
      if (global.navigator && global.navigator.serviceWorker && global.navigator.serviceWorker.controller) {
        global.navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_FONT_CACHE' });
      }
    } catch (_) { /* 忽略通信异常 */ }
    return Promise.all(jobs).then(function () { return true; });
  }

  function registerServiceWorker() {
    if (swRegistered) return;
    if (!global.navigator || !global.navigator.serviceWorker || !global.location) return;
    if (!/^https?:$/i.test(global.location.protocol)) return;
    swRegistered = true;
    global.navigator.serviceWorker.register('sw.js').catch(function () {
      // 某些隐私模式或测试环境禁用 SW，静默回退到页面内 Cache API。
    });
  }

  // ─── 本机字体校验、识别与 IndexedDB 存储 ─────────────────────

  function toUint8Array(data) {
    if (!data) return null;
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (typeof data.byteLength === 'number' && data.buffer) {
      return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
    }
    if (typeof data.byteLength === 'number' && typeof data.slice === 'function') {
      return new Uint8Array(data);
    }
    return null;
  }

  function validateFontBuffer(data) {
    var bytes = toUint8Array(data);
    if (!bytes || bytes.byteLength < 12) {
      return { valid: false, reason: '文件内容为空或已损坏' };
    }
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var tag = view.getUint32(0, false);
    if (tag === 0x00010000 || tag === 0x74727565) { // 00010000 / 'true'
      return { valid: true, mime: 'font/ttf', format: 'truetype' };
    }
    if (tag === 0x4F54544F) { // 'OTTO'
      return { valid: true, mime: 'font/otf', format: 'opentype' };
    }
    if (tag === 0x774F4632) { // 'wOF2'
      return { valid: true, mime: 'font/woff2', format: 'woff2' };
    }
    if (tag === 0x774F4646) { // 'wOFF'
      return { valid: true, mime: 'font/woff', format: 'woff' };
    }
    return { valid: false, reason: '不支持的字体格式，请选择 .ttf、.otf 或 .woff2 文件' };
  }

  function readOpenTypeMeta(bytes) {
    var meta = { weight: null, familyHint: '' };
    if (!bytes || bytes.byteLength < 12) return meta;
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var tag = view.getUint32(0, false);
    if (tag !== 0x00010000 && tag !== 0x74727565 && tag !== 0x4F54544F) return meta;
    var numTables = view.getUint16(4, false);
    if (12 + numTables * 16 > bytes.byteLength) return meta;

    for (var i = 0; i < numTables; i++) {
      var entry = 12 + i * 16;
      var tableTag = String.fromCharCode(bytes[entry], bytes[entry + 1], bytes[entry + 2], bytes[entry + 3]);
      var offset = view.getUint32(entry + 8, false);
      var length = view.getUint32(entry + 12, false);
      if (offset + length > bytes.byteLength) continue;
      if (tableTag === 'OS/2' && length >= 6) {
        meta.weight = view.getUint16(offset + 4, false);
      } else if (tableTag === 'name' && length >= 6) {
        var count = view.getUint16(offset + 2, false);
        var stringOffset = view.getUint16(offset + 4, false);
        for (var j = 0; j < count; j++) {
          var rec = offset + 6 + j * 12;
          if (rec + 12 > offset + length) break;
          var platformId = view.getUint16(rec, false);
          var nameId = view.getUint16(rec + 6, false);
          if (nameId !== 1 && nameId !== 4) continue;
          var strLen = view.getUint16(rec + 8, false);
          var strOff = offset + stringOffset + view.getUint16(rec + 10, false);
          if (strOff + strLen > bytes.byteLength) continue;
          var text = '';
          if (platformId === 3 || platformId === 0) {
            for (var k = 0; k + 1 < strLen; k += 2) {
              text += String.fromCharCode(view.getUint16(strOff + k, false));
            }
          } else if (platformId === 1) {
            for (var m = 0; m < strLen; m++) text += String.fromCharCode(bytes[strOff + m]);
          }
          if (text) meta.familyHint += ' ' + text;
        }
      }
    }
    return meta;
  }

  function identifyFontSlot(filename, data) {
    var lower = String(filename || '').toLowerCase();
    var bytes = toUint8Array(data);
    var meta = bytes ? readOpenTypeMeta(bytes) : { weight: null, familyHint: '' };
    var combined = lower + ' ' + meta.familyHint.toLowerCase();

    if (combined.indexOf('frutiger') !== -1) {
      return 'num400';
    }
    if (lower.indexOf('semibold') !== -1 || lower.indexOf('demibold') !== -1 || lower.indexOf('600') !== -1) {
      return 'zh600';
    }
    if (lower.indexOf('bold') !== -1 || lower.indexOf('700') !== -1) {
      return 'zh700';
    }
    if (lower.indexOf('regular') !== -1 || lower.indexOf('normal') !== -1 || lower.indexOf('400') !== -1) {
      return 'zh400';
    }
    if (meta.weight !== null) {
      if (meta.weight >= 650) return 'zh700';
      if (meta.weight >= 550) return 'zh600';
      return 'zh400';
    }
    if (combined.indexOf('misans') !== -1) return 'zh400';
    return null;
  }

  // ─── IndexedDB 持久化 ───────────────────────────────────────

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { resolve(null); return; }
      var req = global.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('无法打开字体本地存储')); };
    });
  }

  function runTransaction(mode, action) {
    return openDatabase().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, mode);
        var store = tx.objectStore(STORE_NAME);
        var request = action(store);
        var result;
        if (request) {
          request.onsuccess = function () { result = request.result; };
          request.onerror = function () { reject(request.error); };
        }
        tx.oncomplete = function () { db.close(); resolve(result); };
        tx.onerror = function () { db.close(); reject(tx.error || new Error('字体存储写入失败')); };
        tx.onabort = function () { db.close(); reject(tx.error || new Error('字体存储操作已取消')); };
      });
    });
  }

  function registerFaceInDocument(slotKey, record) {
    var slot = SLOTS[slotKey];
    if (!slot || !global.document || !global.document.fonts || typeof global.FontFace !== 'function') {
      return Promise.resolve(false);
    }
    unregisterFaceInDocument(slotKey);
    var bytes = toUint8Array(record.buffer);
    if (!bytes) return Promise.resolve(false);
    var copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    var face = new global.FontFace(slot.family, copy, {
      weight: String(slot.weight),
      style: 'normal',
      display: 'swap',
    });
    return face.load().then(function (loaded) {
      global.document.fonts.add(loaded);
      registeredFaces.set(slotKey, loaded);
      return true;
    });
  }

  function unregisterFaceInDocument(slotKey) {
    var existing = registeredFaces.get(slotKey);
    if (existing && global.document && global.document.fonts) {
      try { global.document.fonts.delete(existing); } catch (_) { /* 忽略 */ }
    }
    registeredFaces.delete(slotKey);
  }

  function broadcastLocalFontChange() {
    try {
      if (syncChannel) syncChannel.postMessage({ type: 'local-fonts-changed', at: Date.now() });
    } catch (_) { /* 忽略 */ }
    try {
      if (global.localStorage) global.localStorage.setItem(SYNC_STORAGE_KEY, String(Date.now()));
    } catch (_) { /* 忽略 */ }
    notifyFontsUpdated({ reason: 'local-fonts-changed' });
  }

  function notifyFontsUpdated(detail) {
    if (typeof global.dispatchEvent !== 'function' || typeof global.CustomEvent !== 'function') return;
    try {
      global.dispatchEvent(new global.CustomEvent('sign-fonts-updated', { detail: detail || {} }));
    } catch (_) { /* 忽略 */ }
  }

  function setMemoryLocalFont(slotKey, record) {
    if (!SLOTS[slotKey]) throw new Error('未知字体槽位：' + slotKey);
    if (!record) {
      localFontRecords.delete(slotKey);
      unregisterFaceInDocument(slotKey);
      return;
    }
    var bytes = toUint8Array(record.buffer);
    var copy = bytes ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : record.buffer;
    localFontRecords.set(slotKey, {
      key: slotKey,
      name: record.name || SLOTS[slotKey].file,
      size: bytes ? bytes.byteLength : (record.size || 0),
      mime: record.mime || 'font/ttf',
      format: record.format || 'truetype',
      buffer: copy,
      updatedAt: record.updatedAt || Date.now(),
    });
  }

  function getLocalFont(slotKey) {
    if (slotKey === 'en400') slotKey = 'zh400';
    else if (slotKey === 'en700') slotKey = 'zh700';
    if (FILE_TO_SLOT[slotKey]) slotKey = FILE_TO_SLOT[slotKey];
    return localFontRecords.get(slotKey) || null;
  }

  function listLocalFonts() {
    return SLOT_ORDER.map(function (key) {
      var slot = SLOTS[key];
      var record = localFontRecords.get(key) || null;
      return {
        key: key,
        file: slot.file,
        label: slot.label,
        family: slot.family,
        weight: slot.weight,
        imported: !!record,
        name: record ? record.name : '',
        size: record ? record.size : 0,
        updatedAt: record ? record.updatedAt : 0,
      };
    });
  }

  function importLocalFont(slotKey, file, bufferOverride) {
    if (!SLOTS[slotKey]) return Promise.reject(new Error('未知字体槽位'));
    var readBuffer = bufferOverride
      ? Promise.resolve(bufferOverride)
      : (file && typeof file.arrayBuffer === 'function' ? file.arrayBuffer() : Promise.reject(new Error('无法读取字体文件')));

    return readBuffer.then(function (buffer) {
      var check = validateFontBuffer(buffer);
      if (!check.valid) throw new Error(check.reason);
      var bytes = toUint8Array(buffer);
      var record = {
        key: slotKey,
        name: (file && file.name) || SLOTS[slotKey].file,
        size: bytes.byteLength,
        mime: check.mime,
        format: check.format,
        buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        updatedAt: Date.now(),
      };
      return registerFaceInDocument(slotKey, record).then(function () {
        localFontRecords.set(slotKey, record);
        return runTransaction('readwrite', function (store) { return store.put(record); }).catch(function () {});
      }).then(function () {
        broadcastLocalFontChange();
        return record;
      });
    });
  }

  function removeLocalFont(slotKey) {
    if (!SLOTS[slotKey]) return Promise.resolve(false);
    localFontRecords.delete(slotKey);
    unregisterFaceInDocument(slotKey);
    return runTransaction('readwrite', function (store) { return store.delete(slotKey); })
      .catch(function () {})
      .then(function () {
        broadcastLocalFontChange();
        return true;
      });
  }

  function clearLocalFonts() {
    SLOT_ORDER.forEach(function (key) {
      localFontRecords.delete(key);
      unregisterFaceInDocument(key);
    });
    return runTransaction('readwrite', function (store) { return store.clear(); })
      .catch(function () {})
      .then(function () {
        broadcastLocalFontChange();
        return true;
      });
  }

  function reloadFromDatabase() {
    return runTransaction('readonly', function (store) { return store.getAll(); }).then(function (records) {
      if (!Array.isArray(records)) return Array.from(localFontRecords.keys());
      var nextKeys = new Set();
      var jobs = records.map(function (record) {
        if (!record || !SLOTS[record.key]) return Promise.resolve();
        nextKeys.add(record.key);
        localFontRecords.set(record.key, record);
        return registerFaceInDocument(record.key, record).catch(function () {});
      });
      SLOT_ORDER.forEach(function (key) {
        if (!nextKeys.has(key) && localFontRecords.has(key)) {
          localFontRecords.delete(key);
          unregisterFaceInDocument(key);
        }
      });
      return Promise.all(jobs).then(function () { return Array.from(nextKeys); });
    }).catch(function () { return Array.from(localFontRecords.keys()); });
  }

  function restoreLocalFonts() {
    if (!restorePromise) {
      restorePromise = reloadFromDatabase();
    }
    return restorePromise;
  }

  // ─── 字体增量加载与跨标签页监听 ────────────────────────────

  function watchFontUpdates(onUpdate) {
    if (typeof onUpdate !== 'function') return function () {};
    var timer = 0;
    function schedule() {
      global.clearTimeout(timer);
      timer = global.setTimeout(function () { onUpdate(); }, 60);
    }
    function onLoadingDone(event) {
      var faces = (event && event.fontfaces) || [];
      var relevant = !faces.length || faces.some(function (face) {
        var fam = String(face.family || '').replace(/["']/g, '');
        return fam === 'MiSans' || fam === 'Frutiger' || fam === 'Frutiger Condensed';
      });
      if (relevant) schedule();
    }
    function onCustom() { schedule(); }

    if (global.document && global.document.fonts && typeof global.document.fonts.addEventListener === 'function') {
      global.document.fonts.addEventListener('loadingdone', onLoadingDone);
    }
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('sign-fonts-updated', onCustom);
    }
    return function () {
      global.clearTimeout(timer);
      if (global.document && global.document.fonts && typeof global.document.fonts.removeEventListener === 'function') {
        global.document.fonts.removeEventListener('loadingdone', onLoadingDone);
      }
      if (typeof global.removeEventListener === 'function') {
        global.removeEventListener('sign-fonts-updated', onCustom);
      }
    };
  }

  function initCrossTabSync() {
    if (typeof global.BroadcastChannel === 'function') {
      try {
        syncChannel = new global.BroadcastChannel(SYNC_CHANNEL_NAME);
        syncChannel.addEventListener('message', function () {
          reloadFromDatabase().then(function () { notifyFontsUpdated({ reason: 'cross-tab-sync' }); });
        });
      } catch (_) { /* 忽略 */ }
    }
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('storage', function (event) {
        if (event && event.key === SYNC_STORAGE_KEY) {
          reloadFromDatabase().then(function () { notifyFontsUpdated({ reason: 'cross-tab-sync' }); });
        }
      });
    }
  }

  initCrossTabSync();
  registerServiceWorker();

  global.SignFontManager = {
    FONT_CACHE_NAME: FONT_CACHE_NAME,
    SLOTS: SLOTS,
    SLOT_ORDER: SLOT_ORDER,
    FILE_TO_SLOT: FILE_TO_SLOT,
    resolveChunks: resolveChunks,
    getFamilyManifest: getFamilyManifest,
    specsForUsedFonts: specsForUsedFonts,
    fetchFontBlob: fetchFontBlob,
    getCacheStats: getCacheStats,
    clearOnlineCache: clearOnlineCache,
    registerServiceWorker: registerServiceWorker,
    validateFontBuffer: validateFontBuffer,
    identifyFontSlot: identifyFontSlot,
    setMemoryLocalFont: setMemoryLocalFont,
    getLocalFont: getLocalFont,
    listLocalFonts: listLocalFonts,
    importLocalFont: importLocalFont,
    removeLocalFont: removeLocalFont,
    clearLocalFonts: clearLocalFonts,
    restoreLocalFonts: restoreLocalFonts,
    notifyFontsUpdated: notifyFontsUpdated,
    watchFontUpdates: watchFontUpdates,
  };
})(typeof window !== 'undefined' ? window : globalThis);
