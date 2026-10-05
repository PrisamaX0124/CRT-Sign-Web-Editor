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
    var left = document.getElementById('left-panel');
    var right = document.getElementById('right-panel');
    var leftExp = document.getElementById('left-expander');
    var rightExp = document.getElementById('right-expander');

    document.getElementById('left-collapse').addEventListener('click', function () {
      left.classList.add('collapsed');
      leftExp.hidden = false;
      App.panels.left = false;
    });
    leftExp.addEventListener('click', function () {
      left.classList.remove('collapsed');
      leftExp.hidden = true;
      App.panels.left = true;
    });
    document.getElementById('right-collapse').addEventListener('click', function () {
      // 移动端：兼作底部属性带折叠把手（48px 细条 ↔ 40vh 全高）
      if (App.isMobileView()) {
        right.classList.toggle('band-collapsed');
        App.syncMobileChrome();
        return;
      }
      right.classList.add('collapsed');
      rightExp.hidden = false;
      App.panels.right = false;
    });
    rightExp.addEventListener('click', function () {
      right.classList.remove('collapsed');
      rightExp.hidden = true;
      App.panels.right = true;
    });

    document.getElementById('close-element-btn').addEventListener('click', function () {
      if (App.presetPreviewId) App.previewPreset(null);
      else App.select(null);
    });

    // 画布尺寸变化（窗口缩放、面板收展）时重算编辑区显示尺寸
    if (window.ResizeObserver) {
      new ResizeObserver(function () { App.fitSignDisplay(); })
        .observe(document.getElementById('canvas-wrap'));
    }
    window.addEventListener('resize', function () { App.fitSignDisplay(); });
  }

  /** 空状态提示文案按断点切换（桌面拖放 / 移动点击） */
  function applyEmptyHintText() {
    document.getElementById('empty-hint').textContent = App.isMobileView()
      ? '从顶部卡片点击添加元素开始编辑'
      : '从左侧拖放元素到此处开始编辑';
  }

  /**
   * 移动端 toast 位置：底部属性带展开时由 CSS（40vh 上方）定位，
   * 折叠成 48px 细条时由这里收窄偏移；桌面清除内联样式交还原生定位。
   */
  function syncToastOffset() {
    var toasts = document.getElementById('toasts');
    if (App.isMobileView() &&
        document.getElementById('right-panel').classList.contains('band-collapsed')) {
      toasts.style.bottom = '60px';
    } else {
      toasts.style.bottom = '';
    }
  }
  App.syncMobileChrome = syncToastOffset;

  /**
   * 断点来回切换：重建选择区（palette 结构随断点不同）、恢复两端面板态、
   * 复位画布缩放——避免桌面收起态/移动折叠态跨断点残留。
   * 部分嵌入环境（如应用内浏览器的 iframe）视口变化不派发 resize/mq-change
   * 事件，另以 documentElement 的 ResizeObserver 按布局变化兜底；两路共用
   * 同一幂等检查（断点未真正跨越时零操作）。
   */
  function watchBreakpoint() {
    if (typeof window.matchMedia !== 'function') return;
    var mq = window.matchMedia('(max-width: 768px)');
    var wasMobile = App.isMobileView();
    function check() {
      if (App.isMobileView() === wasMobile) return;
      wasMobile = App.isMobileView();
      var left = document.getElementById('left-panel');
      var right = document.getElementById('right-panel');
      left.classList.remove('collapsed');
      right.classList.remove('collapsed', 'band-collapsed');
      document.getElementById('left-expander').hidden = true;
      document.getElementById('right-expander').hidden = true;
      App.panels.left = true;
      App.panels.right = true;
      if (global.SignInteract) SignInteract.setCanvasZoom(1);
      if (App.measure && global.SignPanel) SignPanel.buildPalette();
      applyEmptyHintText();
      App.renderAll(); // 含 overlay（移动端行条/桌面行带控件随之切换）与 fitSignDisplay
      syncToastOffset();
    }
    if (mq.addEventListener) mq.addEventListener('change', check);
    else if (mq.addListener) mq.addListener(check); // 旧 Safari
    window.addEventListener('resize', check);
    if (window.ResizeObserver) {
      new ResizeObserver(check).observe(document.documentElement);
    }
  }

  /** 页面关闭/切后台前立即落盘防抖中的最后一次变更（移动端不触发 beforeunload） */
  function flushAutosaveNow() {
    if (App.state && global.SignStorage) {
      try {
        localStorage.setItem(SignStorage.AUTOSAVE_KEY, SignState.serializeSign(App.state));
      } catch (e) { /* 忽略 */ }
    }
  }

  function flushAutosaveOnExit() {
    window.addEventListener('beforeunload', flushAutosaveNow);
    window.addEventListener('pagehide', flushAutosaveNow);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushAutosaveNow();
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
        App.state = SignStorage.loadAutosave() || SignState.createSign();
        App.prefs = SignStorage.loadPrefs();

        SignInteract.init();
        SignClipboard.init();
        wireStaticButtons();
        SignPanel.buildPalette();
        App.renderAll();
        hideLoading();
        applyEmptyHintText();
        watchBreakpoint();
        syncToastOffset();
        if (!fontsReady) {
          SignUI.toast('字体未能完全加载，文字度量可能不准，建议刷新重试', 'error');
        }

        // 字体全部就绪后再刷一帧，避免度量差异
        document.fonts.ready.then(function () { App.renderAll(); });
        flushAutosaveOnExit();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
