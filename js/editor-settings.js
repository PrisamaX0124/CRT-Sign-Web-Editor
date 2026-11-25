(function (window) {
  'use strict';

  const document = window.document;
  const preferences = window.EditorPreferences;
  const trigger = document.querySelector('[data-editor-settings]');
  const dialog = document.createElement('dialog');
  dialog.id = 'editor-settings';
  dialog.className = 'editor-settings-dialog';
  dialog.setAttribute('aria-labelledby', 'editor-settings-heading');
  dialog.innerHTML = `
    <header class="project-dialog-heading">
      <div>
        <h2 id="editor-settings-heading">编辑器设置</h2>
        <p class="project-dialog-intro">设置自动保存，三个编辑器共用。</p>
      </div>
      <button type="button" class="dialog-close" data-control-icon="close" aria-label="关闭设置" autofocus></button>
    </header>
    <form id="editor-settings-form" aria-label="编辑器设置">
      <section class="settings-section" aria-labelledby="settings-appearance">
        <h3 id="settings-appearance">界面与画布</h3>
        <fieldset class="settings-field">
          <legend>界面主题</legend>
          <div class="settings-choices">
            <label><input type="radio" name="theme" value="system" checked><span><span class="settings-sample theme-system" aria-hidden="true"></span>跟随系统</span></label>
            <label><input type="radio" name="theme" value="light"><span><span class="settings-sample theme-light" aria-hidden="true"></span>浅色</span></label>
            <label><input type="radio" name="theme" value="dark"><span><span class="settings-sample theme-dark" aria-hidden="true"></span>深色</span></label>
          </div>
        </fieldset>
        <fieldset class="settings-field">
          <legend>画布背景</legend>
          <div class="settings-choices">
            <label><input type="radio" name="canvas" value="dots" checked><span><span class="settings-sample canvas-dots" aria-hidden="true"></span>点阵</span></label>
            <label><input type="radio" name="canvas" value="grid"><span><span class="settings-sample canvas-grid" aria-hidden="true"></span>方格</span></label>
            <label><input type="radio" name="canvas" value="plain"><span><span class="settings-sample canvas-plain" aria-hidden="true"></span>纯色</span></label>
          </div>
        </fieldset>
      </section>
      <section class="settings-section" aria-labelledby="settings-interaction">
        <h3 id="settings-interaction">操作与帮助</h3>
        <label class="settings-option">
          <span><strong>减少动态效果</strong><small>打开后，直接切换面板、版式和缩放。关闭时跟随系统设置。</small></span>
          <input class="settings-switch" type="checkbox" name="motion" role="switch">
        </label>
        <label class="settings-option">
          <span><strong>首次打开时显示教程</strong><small>每个编辑器各提示一次。也可以从编辑器顶部随时重看。</small></span>
          <input class="settings-switch" type="checkbox" name="showTutorial" role="switch" checked>
        </label>
      </section>
      <div class="settings-footer">
        <p id="settings-status" role="status"></p>
        <button type="button" class="btn" id="settings-reset">恢复默认设置</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const status = dialog.querySelector('#settings-status');

  trigger.addEventListener('click', () => dialog.showModal());
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => trigger.focus({ preventScroll: true }));

  function refresh() {
    const saved = preferences.read();
    form.elements.theme.value = saved.theme;
    form.elements.canvas.value = saved.canvas;
    form.elements.motion.checked = saved.motion === 'reduced';
    form.elements.showTutorial.checked = saved.showTutorial;
  }

  function showStatus(saved, message) {
    status.textContent = saved ? message : '浏览器未能保存设置。更改仅在此页面生效。';
  }

  form.addEventListener('change', () => {
    const saved = preferences.save({
      theme: form.elements.theme.value,
      canvas: form.elements.canvas.value,
      motion: form.elements.motion.checked ? 'reduced' : 'system',
      showTutorial: form.elements.showTutorial.checked,
    });
    showStatus(saved, '设置已保存');
  });
  dialog.querySelector('#settings-reset').addEventListener('click', () => {
    showStatus(preferences.reset(), '已恢复默认设置');
  });
  preferences.subscribe(refresh);
  refresh();
})(window);
