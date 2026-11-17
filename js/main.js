/* Modified by PrisamaX0124, 2026-10-05: guidance sign and platform editor enhancements; see docs/fork-changes.md. */
/**
 * main.js — 启动装配
 *
 * 顺序：实例守卫 → 字体预加载（测量依赖）→ 恢复/新建状态 → 装配 UI → 首帧渲染。
 */
(function (global) {
  'use strict';

  var FONT_TIMEOUT_MS = 30000;   // 字体面加载的兑底放行时限
  var FONT_SLOW_HINT_MS = 8000;  // 超过此时长更新提示文案

  function showLoading(text) {
    var el = document.getElementById('loading-overlay');
    el.hidden = false;
    if (text) document.getElementById('loading-text').textContent = text;
  }

  function hideLoading() {
    document.getElementById('loading-overlay').hidden = true;
  }

  /**
   * 预加载全部字体面（度量依赖，未就绪不进界面）。
   * 超过 FONT_TIMEOUT_MS 仍不齐则带系统回退放行（resolve(false)），
   * 单面失败继续等其余面，最终返回 false 提示度量可能不准。
   */
  function loadFonts() {
    var all = Promise.all(SignCore.FONT_LOAD_SPECS.map(function (s) {
      return document.fonts.load(s.css).then(function () { return true; }, function () { return false; });
    })).then(function (loaded) { return loaded.every(function (ready) { return ready; }); });
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(false); }, FONT_TIMEOUT_MS); });
    var slowHint = setTimeout(function () {
      showLoading('字体加载较慢，仍在等待…（可检查网络后刷新）');
    }, FONT_SLOW_HINT_MS);
    return Promise.race([all, timeout]).then(function (ready) {
      clearTimeout(slowHint);
      return ready;
    });
  }

  function wireStaticButtons() {
    ['left', 'right'].forEach(function (side) {
      var panel = document.getElementById(side + '-panel');
      var collapse = document.getElementById(side + '-collapse');
      var expand = document.getElementById(side + '-expander');
      collapse.addEventListener('click', function () {
        panel.classList.add('collapsed');
        expand.hidden = false;
        expand.focus({ preventScroll: true });
        panel.inert = true;
      });
      expand.addEventListener('click', function () {
        panel.classList.remove('collapsed');
        panel.inert = false;
        collapse.focus({ preventScroll: true });
        expand.hidden = true;
      });
    });

    document.getElementById('close-element-btn').addEventListener('click', function () {
      if (App.presetPreviewId) App.previewPreset(null);
      else App.select(null);
      document.getElementById('right-panel-title').focus({ preventScroll: true });
    });

    App.previewZoom = PreviewZoom.create({
      viewport: document.getElementById('canvas-scroll'),
      stage: document.getElementById('canvas-area'),
      paper: document.getElementById('canvas-wrap'),
      graphic: document.getElementById('sign-svg'),
      controls: document.getElementById('guidance-zoom'),
      addRow: document.getElementById('add-row-btn'),
      alignTop: true,
      onChange: SignInteract.positionElementToolbar,
    });
  }

  function showBlockedNotice() {
    document.body.innerHTML = '';
    var div = document.createElement('div');
    div.style.cssText = 'height:100vh;display:flex;align-items:center;justify-content:center;' +
      'flex-direction:column;gap:12px;color:#6b7684;font-size:15px;font-family:system-ui,sans-serif;';
    div.textContent = '已取消启动，以保护另一标签页中的编辑数据。请直接关闭此页面。';
    document.body.appendChild(div);
  }

  function boot() {
    if (document.getElementById('app').hidden) return;
    showLoading('正在检查编辑器实例…');

    SignStorage.setupInstanceGuard().then(function (proceed) {
      if (!proceed) {
        hideLoading();
        showBlockedNotice();
        return;
      }
      showLoading('正在加载 MiSans 与编号字体…');
      loadFonts().then(function (fontsReady) {
        App.measure = SignCore.createCanvasMeasurer();
        var restoredProject = SignStorage.loadAutosave();
        App.state = restoredProject || SignState.createSign();
        function serializeProject() { return SignState.serializeSign(App.state); }
        App.exportProject = function () {
          SignStorage.exportProject(serializeProject, 'sign-project-' + SignStorage.timestamp() + '.json', SignUI.toast);
        };
        SignStorage.bindProjectImport({
          input: document.getElementById('guidance-project-file'),
          deserialize: SignState.deserializeSign,
          applyProject: function (project) { App.update(function () { return project; }, null, { replaceProject: true }); },
          notice: SignUI.toast,
          limitSize: false,
        });
        App.autosave = SignStorage.createAutosave({
          storageKey: SignStorage.AUTOSAVE_KEY,
          indicator: document.getElementById('guidance-save'),
          serializeProject: serializeProject,
          exportProject: App.exportProject,
          delay: 500,
          restored: Boolean(restoredProject),
        });
        App.prefs = SignStorage.loadPrefs();

        SignInteract.init();
        SignClipboard.init();
        wireStaticButtons();
        SignPanel.buildPalette();
        App.renderAll();
        hideLoading();
        if (!fontsReady) {
          SignUI.toast('字体未能完全加载，文字度量可能不准，建议刷新重试', 'error');
        }

        // 字体全部就绪后再刷一帧，避免度量差异
        document.fonts.ready.then(function () { App.renderAll(); });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
