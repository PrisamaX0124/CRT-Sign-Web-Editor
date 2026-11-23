/* Modified by PrisamaX0124, 2026-10-06: text lines, custom and Beijing palettes, badge ink fitting, railway icon, station glyphs and public release data separation; see docs/fork-changes.md. */
/* Modified by PrisamaX0124, 2026-10-05: guidance sign and platform editor enhancements; see docs/fork-changes.md. */
/**
 * storage.js — 自动保存 / 多标签页检测 / 项目 JSON 导入导出（issue 06）
 */
(function (global) {
  'use strict';

  var State = global.SignState;
  var AUTOSAVE_KEY = 'public-sign-autosave';
  var INSTANCE_KEY = 'public-sign-instance';
  var PREFS_KEY = 'public-sign-prefs';
  var HEARTBEAT_MS = 2000;
  var FRESH_WINDOW_MS = 5000;

  var instanceId = null;
  var heartbeatTimer = null;

  // ─── 编辑器偏好 ────────────────────────────────────────────

  /** 读取编辑器偏好（autoLineColor / paletteCity）；缺失或损坏的项以默认值补齐 */
  function loadPrefs() {
    var prefs = { autoLineColor: true, paletteCity: 'shanghai' };
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return prefs;
      var data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        if (typeof data.autoLineColor === 'boolean') prefs.autoLineColor = data.autoLineColor;
        if (typeof data.paletteCity === 'string' && global.SignCore.isPalette(data.paletteCity)) {
          prefs.paletteCity = data.paletteCity;
        }
      }
    } catch (e) { /* 损坏存档按默认处理 */ }
    return prefs;
  }

  function savePrefs(prefs) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) { /* 忽略 */ }
  }

  // ─── 自动保存 ──────────────────────────────────────────────

  function createAutosave({ storageKey, indicator, serializeProject, exportProject, notice, delay = 0, restored = false }) {
    var status = indicator.querySelector('[role="status"]');
    var backup = indicator.querySelector('button');
    var saveTimer;
    var pending = false;
    var conflict = false;
    var saveFailed = false;
    var lastSaved;
    var reload;
    try { lastSaved = global.localStorage.getItem(storageKey); } catch { /* 存储恢复后仍需允许重试。 */ }
    backup.addEventListener('click', exportProject);

    function showStatus(state, message) {
      indicator.dataset.saveState = state;
      if (status.textContent !== message) status.textContent = message;
    }

    function showConflict() {
      conflict = true;
      clearTimeout(saveTimer);
      var message = '项目已在其他窗口修改，自动保存已停止';
      showStatus('conflict', message);
      notice?.(message, 'warning');
      backup.hidden = false;
      if (!reload) {
        reload = document.createElement('button');
        reload.type = 'button';
        reload.className = backup.className;
        reload.textContent = '重新加载';
        reload.title = '请先导出本页备份，再加载其他窗口保存的项目';
        reload.addEventListener('click', function () { global.location.reload(); });
        indicator.append(reload);
      }
    }

    function changedElsewhere() {
      var stored = global.localStorage.getItem(storageKey);
      if (stored !== (lastSaved ?? null)) {
        showConflict();
        return true;
      }
      return false;
    }

    function writeProject(serializedProject) {
      if (conflict) return;
      try {
        if (changedElsewhere()) return;
        var content = serializedProject ?? serializeProject();
        global.localStorage.setItem(storageKey, content);
        lastSaved = content;
      } catch {
        showStatus('failed', '保存失败');
        backup.hidden = false;
        if (!saveFailed) notice?.('项目保存失败，请先导出备份', 'error');
        saveFailed = true;
        return;
      }
      showStatus('saved', '已保存');
      saveFailed = false;
      pending = false;
      backup.hidden = true;
    }

    function flush() {
      clearTimeout(saveTimer);
      if (pending) writeProject();
    }

    function schedule(serializedProject) {
      if (conflict) return;
      pending = true;
      showStatus('saving', '保存中');
      if (!delay) {
        writeProject(serializedProject);
        return;
      }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, delay);
    }

    if (restored) showStatus('saved', '已保存');
    global.addEventListener('storage', function (event) {
      if (conflict || (event.key !== storageKey && event.key !== null)) return;
      try { changedElsewhere(); } catch { /* 浏览器可能暂时禁止读取，稍后仍需允许重试。 */ }
    });
    if (delay) {
      // 浏览器可能在页面离开或切到后台时暂停计时。
      global.addEventListener('beforeunload', flush);
      global.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) flush();
      });
    }
    return { schedule };
  }

  /** 启动时恢复上次编辑状态；无存档返回 null */
  function loadAutosave() {
    try {
      var raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      return State.deserializeSign(raw);
    } catch (e) {
      console.warn('自动存档恢复失败，使用默认标识牌', e);
      return null;
    }
  }

  // ─── 多标签页检测 ──────────────────────────────────────────

  function readInstance() {
    try {
      var raw = localStorage.getItem(INSTANCE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeInstance() {
    try {
      localStorage.setItem(INSTANCE_KEY, JSON.stringify({
        id: instanceId,
        ts: Date.now(),
      }));
    } catch (e) { /* 存储被禁/写满：守卫退化为无心跳，不致命 */ }
  }

  /**
   * 多实例守卫。返回 Promise<true>（可继续）——检测到其他活跃实例时弹确认，
   * 用户拒绝则 Promise resolve(false)，调用方应停止启动编辑器。
   */
  function setupInstanceGuard() {
    instanceId = SignCore.uuid();
    return new Promise(function (resolve) {
      var existing = readInstance();
      var fresh = existing && existing.id !== instanceId &&
        Date.now() - existing.ts < FRESH_WINDOW_MS;
      if (!fresh) {
        writeInstance();
        startHeartbeat();
        resolve(true);
        return;
      }
      global.SignUI.confirmDialog(
        '检测到已有运行中的编辑器实例。同时编辑多个标签页可能导致数据丢失。是否继续？',
        '多实例警告', '继续'
      ).then(function (ok) {
        if (ok) {
          writeInstance();
          startHeartbeat();
        }
        resolve(ok);
      });
    });
  }

  function startHeartbeat() {
    heartbeatTimer = setInterval(writeInstance, HEARTBEAT_MS);
    window.addEventListener('beforeunload', releaseInstance);
    window.addEventListener('pagehide', releaseInstance);
    // 移动端切后台不触发 beforeunload：页面隐藏时停心跳并释放实例标记
    // （后台挂起的心跳定时器被节流，留着只会误拦自己）；回前台立即重写并恢复。
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        releaseInstance();
      } else if (heartbeatTimer === null && instanceId) {
        heartbeatTimer = setInterval(writeInstance, HEARTBEAT_MS);
        writeInstance();
      }
    });
  }

  function releaseInstance() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    var cur = readInstance();
    if (cur && cur.id === instanceId) {
      localStorage.removeItem(INSTANCE_KEY);
    }
  }

  // ─── 项目 JSON 导入导出 ────────────────────────────────────

  function timestamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function exportProject(serializeProject, filename, notice, saveFile = global.SignStorage.download) {
    try {
      var file = new Blob([serializeProject()], { type: 'application/json' });
      saveFile(file, filename);
    } catch {
      notice('导出失败。无法生成项目 JSON', 'error');
      return;
    }
    notice('项目 JSON 已导出', 'success');
  }

  async function readProjectFile(file, deserialize, limitSize = true) {
    if (!/\.json$/i.test(file.name)) throw new Error('请选择 JSON 文件');
    if (limitSize && file.size > 2 * 1024 * 1024) throw new Error('项目文件不能超过 2 MB');
    var source;
    try {
      source = await file.text();
    } catch {
      throw new Error('无法读取文件');
    }
    try {
      return await deserialize(source);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('JSON 格式有误');
      throw error;
    }
  }

  function bindProjectImport({ input, deserialize, applyProject, notice, limitSize }) {
    var lastSelection = 0;
    input.addEventListener('change', async function () {
      var file = input.files[0];
      input.value = '';
      if (!file) return;
      // 读取或检查底纹可能需要更久，较早选中的文件不能覆盖后选的文件。
      var selection = ++lastSelection;
      try {
        var project = await readProjectFile(file, deserialize, limitSize);
        if (selection !== lastSelection) return;
        await applyProject(project, file);
        if (selection !== lastSelection) return;
        notice('项目已导入', 'success');
      } catch (error) {
        if (selection === lastSelection) notice('导入失败。' + error.message, 'error');
      }
    });
  }

  global.SignStorage = {
    AUTOSAVE_KEY: AUTOSAVE_KEY,
    INSTANCE_KEY: INSTANCE_KEY,
    PREFS_KEY: PREFS_KEY,
    createAutosave: createAutosave,
    loadAutosave: loadAutosave,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    setupInstanceGuard: setupInstanceGuard,
    exportProject: exportProject,
    bindProjectImport: bindProjectImport,
    readProjectFile: readProjectFile,
    download: download,
    timestamp: timestamp,
  };
})(typeof window !== 'undefined' ? window : globalThis);
