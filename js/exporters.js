/* Modified by PrisamaX0124, 2026-10-05: guidance sign and platform editor enhancements; see docs/fork-changes.md. */
/**
 * exporters.js — SVG / PNG 导出（issue 06）
 *
 * 导出的文件内嵌 @font-face（优先离线本机字体，其次按实际字符读取命中的 WOFF2 分片，
 * 本地 file:// 回退生成的字体数据脚本），保证导出产物在任意环境视觉一致且弱网下体积最小。
 * PNG 通过 SVG → Image → Canvas 光栅化为标识牌实际像素尺寸。
 */
(function (global) {
  'use strict';

  var Core = global.SignCore;
  var Render = global.SignRender;
  var Storage = global.SignStorage;

  var FONT_FILES = {
    zh400: 'MiSans-Regular.ttf',
    zh600: 'MiSans-Semibold.ttf',
    zh700: 'MiSans-Bold.ttf',
    en400: 'MiSans-Regular.ttf',
    en700: 'MiSans-Bold.ttf',
    num400: 'Frutiger-Regular.ttf',
    num700: 'Frutiger-Bold.ttf',
    cond400: 'FrutigerCondensed-Regular.ttf',
    cond700: 'FrutigerCondensed-Bold.ttf',
  };

  // ─── 字体内嵌数据（懒加载与缓存）───────────────────────────

  var fontDataPromises = {};
  var chunkDataPromises = {};

  function blobToDataURL(blob, fallbackMime) {
    return new Promise(function (resolve, reject) {
      var typed = fallbackMime && blob && typeof blob.slice === 'function'
        ? blob.slice(0, blob.size, fallbackMime)
        : blob;
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('字体读取失败')); };
      reader.readAsDataURL(typed);
    });
  }

  function arrayBufferToDataURL(buffer, mime) {
    var blob = new Blob([buffer], { type: mime || 'font/ttf' });
    return blobToDataURL(blob, mime || 'font/ttf');
  }

  // file://不能fetch本地字体，但可以加载同目录的经典脚本。
  // 数据由gen-export-fonts.mjs从原始TTF生成，不替换为旧字体或系统字体。
  function loadFontScript(file) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'fonts-export/' + file + '.js';
      function finish(failed) {
        var data = global.SignExportFontData && global.SignExportFontData[file];
        if (global.SignExportFontData) delete global.SignExportFontData[file];
        script.onload = script.onerror = null;
        script.remove();
        if (failed || typeof data !== 'string' || data.indexOf('data:font/ttf;base64,') !== 0) {
          reject(new Error('字体加载失败：' + file + '（请检查fonts-export目录是否完整）'));
        } else resolve(data);
      }
      script.onload = function () { finish(false); };
      script.onerror = function () { finish(true); };
      document.head.appendChild(script);
    });
  }

  function fetchFontData(file) {
    var manager = global.SignFontManager;
    var url = 'fonts/' + file;
    var blobPromise = manager && typeof manager.fetchFontBlob === 'function'
      ? manager.fetchFontBlob(url, { mime: 'font/ttf' })
      : fetch(url).then(function (response) {
          if (!response.ok) throw new Error('字体加载失败：' + file);
          return response.blob();
        });
    return blobPromise.then(function (blob) {
      // 静态服务器可能将TTF标成font/sfnt或application/octet-stream。
      return blobToDataURL(blob, 'font/ttf');
    });
  }

  function loadChunkData(chunk) {
    if (chunkDataPromises[chunk.url]) return chunkDataPromises[chunk.url];
    var manager = global.SignFontManager;
    var mime = chunk.mime || 'font/woff2';
    var blobPromise = manager && typeof manager.fetchFontBlob === 'function'
      ? manager.fetchFontBlob(chunk.url, { mime: mime })
      : fetch(chunk.url).then(function (response) {
          if (!response.ok) throw new Error('字体分片加载失败：' + chunk.url);
          return response.blob();
        });
    chunkDataPromises[chunk.url] = blobPromise.then(function (blob) {
      return blobToDataURL(blob, mime);
    }).then(function (dataUrl) {
      return {
        url: chunk.url,
        dataUrl: dataUrl,
        format: chunk.format || 'woff2',
        unicodeRange: chunk.unicodeRange,
      };
    }).catch(function (err) {
      delete chunkDataPromises[chunk.url];
      throw err;
    });
    return chunkDataPromises[chunk.url];
  }

  function loadFullFontData(file) {
    if (fontDataPromises[file]) return fontDataPromises[file];
    fontDataPromises[file] = Promise.resolve().then(function () {
      if (global.location && global.location.protocol === 'file:') return loadFontScript(file);
      return fetchFontData(file).catch(function (err) {
        // HTTP字体请求被浏览器/网络拦截时，也可尝试同源的字体数据脚本。
        if (global.document && err.name === 'TypeError') return loadFontScript(file);
        throw err;
      });
    }).catch(function (err) {
      delete fontDataPromises[file]; // 失败后可重试，已成功的文件仍保留缓存。
      throw err;
    });
    return fontDataPromises[file];
  }

  function loadFontForFile(file, characters) {
    var manager = global.SignFontManager;
    if (manager && typeof manager.getLocalFont === 'function') {
      var local = manager.getLocalFont(file);
      if (local && local.buffer) {
        return arrayBufferToDataURL(local.buffer, local.mime || 'font/ttf');
      }
    }

    var isFileProtocol = global.location && global.location.protocol === 'file:';
    if (!isFileProtocol && characters && manager && typeof manager.resolveChunks === 'function') {
      var chunks = manager.resolveChunks(file, characters);
      if (Array.isArray(chunks)) {
        if (!chunks.length) {
          var info = manager.getFamilyManifest && manager.getFamilyManifest(file);
          if (info && info.chunks && info.chunks.length) {
            chunks = [{
              file: info.chunks[0].file,
              url: info.basePath + info.chunks[0].file,
              unicodeRange: info.chunks[0].unicodeRange,
              format: info.format,
              mime: info.mime,
            }];
          }
        }
        if (chunks.length) {
          return Promise.all(chunks.map(loadChunkData)).catch(function (err) {
            // HTTP 分片 fetch 被浏览器或网络策略拦截时，回退到同源字体数据脚本。
            if (global.document && err && err.name === 'TypeError') {
              return loadFullFontData(file);
            }
            throw err;
          });
        }
      }
    }

    return loadFullFontData(file);
  }

  // ─── 收集牌面用到的字体与字符 ──────────────────────────────

  /** 扫描导向标识牌，收集每个字体键对应的实际文本，供按字符加载分片使用。 */
  function collectUsedCharacters(sign) {
    var chars = {};
    function append(key, value) {
      if (!value) return;
      chars[key] = (chars[key] || '') + String(value);
    }
    if (!sign || !Array.isArray(sign.rows)) return chars;
    sign.rows.forEach(function (row) {
      row.elements.forEach(function (el) {
        var p = el.props || {};
        switch (el.type) {
          case 'bilingual-text':
          case 'small-bilingual-text':
            append('zh' + (p.bold ? 700 : 400), p.textZh);
            append('en' + (p.bold ? 700 : 400), p.textEn);
            break;
          case 'big-number':
            if (p.text) {
              append('num400', p.text);
              if (/[^\x00-\x7F]/.test(p.text)) append('zh400', p.text);
            }
            break;
          case 'number-line':
            append('num400', p.number);
            append('zh400', '号线');
            append('en400', 'Line ' + (p.number || ''));
            break;
          case 'text-line':
            append('zh400', (p.textZh || '') + '线');
            append('en400', p.textEn);
            break;
          case 'entrance':
          case 'exit':
            if (p.code) append('num400', p.code);
            append('zh400', el.type === 'entrance' ? '入口' : '出口');
            append('en400', el.type === 'entrance' ? 'Entrance' : 'Exit');
            break;
        }
      });
    });
    return chars;
  }

  /** 从站台/换乘渲染场景节点提取每个字体键用到的实际字符。 */
  function collectSceneCharacters(scene) {
    var chars = {};
    function append(key, value) {
      if (!value) return;
      chars[key] = (chars[key] || '') + String(value);
    }
    if (!scene || !Array.isArray(scene.nodes)) return chars;
    scene.nodes.forEach(function (node) {
      if (node.tag !== 'text' || !node.text) return;
      var attrs = node.attrs || node.attributes || {};
      var family = String(attrs['font-family'] || '');
      var weight = Number(attrs['font-weight']) || 400;
      if (family === Core.FONT_NUM || family.indexOf('Frutiger') !== -1) {
        append('num' + (weight === 700 ? 700 : 400), node.text);
        if (/[^\x00-\x7F]/.test(node.text)) append('zh400', node.text);
      } else {
        append('zh' + weight, node.text);
      }
    });
    return chars;
  }

  function ensureFontData(sign) {
    var used = sign ? collectUsedFonts(sign) : { zh400: true, zh600: true, zh700: true, num400: true };
    var characters = sign ? collectUsedCharacters(sign) : null;
    return ensureUsedFontData(used, characters ? { characters: characters } : undefined);
  }

  /** Shared by independent SVG editors that already collect font keys from their metrics. */
  function ensureUsedFontData(used, options) {
    options = options || {};
    var characters = options.characters || (options.scene ? collectSceneCharacters(options.scene) : null);
    var fileChars = {};
    var files = [];
    Object.keys(used || {}).forEach(function (key) {
      var file = FONT_FILES[key];
      if (!used[key] || !file) return;
      if (files.indexOf(file) === -1) files.push(file);
      if (characters && characters[key]) {
        fileChars[file] = (fileChars[file] || '') + characters[key];
      }
    });
    var ready = global.SignFontManager && typeof global.SignFontManager.restoreLocalFonts === 'function'
      ? global.SignFontManager.restoreLocalFonts().catch(function () {})
      : Promise.resolve();
    return ready.then(function () {
      return Promise.all(files.map(function (file) {
        return loadFontForFile(file, fileChars[file]);
      })).then(function (values) {
        var data = {};
        files.forEach(function (file, i) { data[file] = values[i]; });
        return data;
      });
    });
  }

  /** 扫描标识牌，确定需要内嵌的字体面 */
  function collectUsedFonts(sign) {
    var used = {};
    function anyZh(weight) { used['zh' + (weight || 400)] = true; }
    function anyEn(weight) { used['en' + (weight || 400)] = true; }
    function anyNum() { used.num400 = true; }
    sign.rows.forEach(function (row) {
      row.elements.forEach(function (el) {
        var p = el.props;
        switch (el.type) {
          case 'bilingual-text':
          case 'small-bilingual-text':
            if (p.textZh) anyZh(p.bold ? 700 : 400);
            if (p.textEn) anyEn(p.bold ? 700 : 400);
            break;
          case 'big-number':
            if (p.text) {
              anyNum();
              // Frutiger 缺字时由 MiSans 回退，导出保持中文等混排可见。
              if (/[^\x00-\x7F]/.test(p.text)) anyZh();
            }
            break;
          case 'number-line':
            anyZh(); anyEn(); anyNum();
            break;
          case 'text-line':
            anyZh();                      // 大字 + 「线」标签恒用中文
            if (p.textEn) anyEn();
            break;
          case 'entrance':
          case 'exit':
            if (p.code) anyNum();
            anyZh(); anyEn();
            break;
        }
      });
    });
    return used;
  }

  function formatFromDataURL(dataUrl, fallback) {
    if (typeof dataUrl !== 'string') return fallback;
    if (dataUrl.indexOf('data:font/woff2') === 0) return 'woff2';
    if (dataUrl.indexOf('data:font/woff') === 0) return 'woff';
    if (dataUrl.indexOf('data:font/otf') === 0) return 'opentype';
    if (dataUrl.indexOf('data:font/ttf') === 0) return 'truetype';
    return fallback;
  }

  function buildFontCSS(used, embedData) {
    var rules = [];
    var faces = {
      zh400: ["'MiSans'", 400, 'truetype'],
      zh600: ["'MiSans'", 600, 'truetype'],
      zh700: ["'MiSans'", 700, 'truetype'],
      en400: ["'MiSans'", 400, 'truetype'],
      en700: ["'MiSans'", 700, 'truetype'],
      num400: ["Frutiger", 400, 'truetype'],
      num700: ["Frutiger", 700, 'truetype'],
      cond400: ["'Frutiger Condensed'", 400, 'truetype'],
      cond700: ["'Frutiger Condensed'", 700, 'truetype'],
    };
    var emitted = {};
    Object.keys(used || {}).forEach(function (key) {
      if (!used[key]) return;
      var file = FONT_FILES[key];
      var data = embedData && embedData[file];
      if (!data || emitted[file]) return;
      emitted[file] = true;
      var face = faces[key];
      if (Array.isArray(data)) {
        data.forEach(function (chunk) {
          if (!chunk || !chunk.dataUrl) return;
          var fmt = chunk.format || formatFromDataURL(chunk.dataUrl, 'woff2');
          rules.push(
            "@font-face{font-family:" + face[0] + ";src:url(" + chunk.dataUrl + ") format('" +
            fmt + "');font-weight:" + face[1] + ";font-style:normal" +
            (chunk.unicodeRange ? ";unicode-range:" + chunk.unicodeRange : '') + "}"
          );
        });
      } else {
        var format = formatFromDataURL(data, face[2]);
        rules.push(
          "@font-face{font-family:" + face[0] + ";src:url(" + data + ") format('" +
          format + "');font-weight:" + face[1] + ";font-style:normal}"
        );
      }
    });
    return rules.join('\n');
  }

  // ─── 导出 SVG ──────────────────────────────────────────────

  /** 生成自包含 SVG 字符串（内嵌字体） */
  function buildExportSVGString(sign, measure, embedData) {
    var layout = Render.layoutSign(sign, measure);
    var svg = document.createElementNS(Core.SVG_NS, 'svg');
    Render.renderSignInto(svg, sign, measure, { clean: true });
    svg.setAttribute('width', layout.width);
    svg.setAttribute('height', layout.height);
    var css = buildFontCSS(collectUsedFonts(sign), embedData);
    if (css) {
      var style = document.createElementNS(Core.SVG_NS, 'style');
      style.textContent = css;
      svg.insertBefore(style, svg.firstChild);
    }
    var xml = new XMLSerializer().serializeToString(svg);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
  }

  function exportSVGFile(sign, measure) {
    return ensureFontData(sign).then(function (embedData) {
      var str = buildExportSVGString(sign, measure, embedData);
      var blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
      Storage.download(blob, 'sign-' + Storage.timestamp() + '.svg');
      SignUI.toast('SVG 已导出（内嵌字体）', 'success');
    }, function (err) {
      SignUI.toast(err.message || '导出失败', 'error');
    });
  }

  // ─── 导出 PNG ──────────────────────────────────────────────

  /** Rasterize vectors at the sampling size, never upscale an already decoded bitmap. */
  function rasterizePNG(source, size, scale, signal) {
    return new Promise(function (resolve, reject) {
      if (signal) signal.throwIfAborted();
      scale = scale === undefined ? 1 : scale;
      var width = Math.round(size.width * scale), height = Math.round(size.height * scale);
      if ([1, 2, 4].indexOf(scale) < 0 || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 32768 || height > 32768 || width * height > 67108864) {
        reject(new Error('PNG 尺寸超出支持范围，请降低导出倍率或标识牌尺寸')); return;
      }
      // Small signs get 4x supersampling. Bound the temporary surface for large exports.
      var sampling = Math.max(1, Math.min(4, Math.floor(32768 / width), Math.floor(32768 / height), Math.floor(Math.sqrt(16777216 / (width * height)))));
      var svg;
      if (typeof source === 'string') {
        var doc = new DOMParser().parseFromString(source, 'image/svg+xml');
        svg = doc.documentElement;
        if (svg.localName !== 'svg' || doc.querySelector('parsererror')) { reject(new Error('SVG 光栅化失败')); return; }
      } else {
        // 批量导出时，重新解析每张图的内嵌字体会占用主线程。
        svg = source.cloneNode(true);
      }
      // viewBox keeps the original layout while width/height select actual raster resolution.
      if (!svg.hasAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 ' + size.width + ' ' + size.height);
      svg.setAttribute('width', width * sampling); svg.setAttribute('height', height * sampling);
      var str = new XMLSerializer().serializeToString(svg);
      var url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml;charset=utf-8' })), img = new Image();
      var canvas;
      function releaseImage() {
        img.onload = img.onerror = null;
        img.removeAttribute('src');
        if (url) URL.revokeObjectURL(url);
        url = null;
      }
      function finish(error, blob) {
        releaseImage();
        if (canvas) { canvas.width = canvas.height = 0; canvas = null; }
        if (signal) signal.removeEventListener('abort', abort);
        if (blob) resolve(blob); else reject(error);
      }
      function abort() { finish(signal.reason); }
      if (signal) signal.addEventListener('abort', abort, { once: true });
      img.onload = function () {
        try {
          canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          var ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法创建 PNG');
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);
          releaseImage();
          canvas.toBlob(function (blob) {
            if (blob) finish(null, blob); else finish(new Error('PNG 编码失败'));
          }, 'image/png');
        } catch (err) { finish(err); }
      };
      img.onerror = function () { finish(new Error('SVG 光栅化失败')); };
      img.src = url;
    });
  }

  function createImage(sign, measure, scale = 1) {
    return ensureFontData(sign).then(function (embedData) {
      var size = Render.layoutSign(sign, measure);
      var source = buildExportSVGString(sign, measure, embedData);
      return rasterizePNG(source, size, scale).then(function (image) {
        return { image: image, width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
      });
    });
  }

  function exportPNGFile(sign, measure, scale) {
    return createImage(sign, measure, scale).then(function (result) {
      Storage.download(result.image, 'sign-' + Storage.timestamp() + '.png');
      SignUI.toast('PNG 已导出（' + result.width + '×' + result.height + ' px）', 'success');
    }).catch(function (error) {
      SignUI.toast(error.message || '导出失败', 'error');
    });
  }

  global.SignExporters = {
    ensureFontData: ensureFontData,
    ensureUsedFontData: ensureUsedFontData,
    collectUsedFonts: collectUsedFonts,
    collectUsedCharacters: collectUsedCharacters,
    collectSceneCharacters: collectSceneCharacters,
    buildFontCSS: buildFontCSS,
    buildExportSVGString: buildExportSVGString,
    rasterizePNG: rasterizePNG,
    createImage: createImage,
    exportSVGFile: exportSVGFile,
    exportPNGFile: exportPNGFile,
  };
})(typeof window !== 'undefined' ? window : globalThis);
