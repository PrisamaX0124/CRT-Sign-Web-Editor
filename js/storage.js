/* Modified by PrisamaX0124, 2026-10-06: text lines, railway icon, station glyphs and public release data separation; see docs/fork-changes.md. */
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

  var saveTimer = null;
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
        if (typeof data.paletteCity === 'string' && global.SignCore.CITY_PALETTES[data.paletteCity]) {
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

  /** 状态变更后调用；debounce 500ms 写入 localStorage */
  function scheduleAutosave(state) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(AUTOSAVE_KEY, State.serializeSign(state));
      } catch (e) {
        console.error('自动保存失败', e);
      }
    }, 500);
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

  function exportProject(state) {
    var blob = new Blob([State.serializeSign(state)], { type: 'application/json' });
    download(blob, 'sign-project-' + timestamp() + '.json');
    SignUI.toast('项目已导出为 JSON', 'success');
  }

  /** 从用户选择的文件导入 → Promise<SignState>；失败 reject（错误消息中文） */
  function importProject(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          resolve(State.deserializeSign(String(reader.result)));
        } catch (e) {
          reject(new Error('导入失败：' + (e.message || '文件格式不合法')));
        }
      };
      reader.onerror = function () { reject(new Error('导入失败：无法读取文件')); };
      reader.readAsText(file);
    });
  }

  function pickImportFile() {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      document.body.appendChild(input);
      function done() {
        input.remove();
        resolve(input.files[0] || null);
      }
      input.addEventListener('change', done);
      input.addEventListener('cancel', done); // 用户取消也须结算并移除节点
      input.click();
    });
  }

  global.SignStorage = {
    AUTOSAVE_KEY: AUTOSAVE_KEY,
    INSTANCE_KEY: INSTANCE_KEY,
    PREFS_KEY: PREFS_KEY,
    scheduleAutosave: scheduleAutosave,
    loadAutosave: loadAutosave,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    setupInstanceGuard: setupInstanceGuard,
    exportProject: exportProject,
    importProject: importProject,
    pickImportFile: pickImportFile,
    download: download,
    timestamp: timestamp,
  };
})(typeof window !== 'undefined' ? window : globalThis);
