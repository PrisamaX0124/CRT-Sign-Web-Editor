(function (window) {
  'use strict';

  const document = window.document;
  const preferences = window.EditorPreferences;
  const fontManager = window.SignFontManager;
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
      <section class="settings-section settings-fonts-section" aria-labelledby="settings-fonts" ${fontManager ? '' : 'hidden'}>
        <h3 id="settings-fonts">字体与离线缓存</h3>
        <p class="settings-fonts-intro">网页按实际字符分片加载并缓存 MiSans 字体。弱网或离线环境下，可直接导入本机字体文件（仅存于本机浏览器，三个编辑器共用）。</p>
        <ul class="settings-font-list" id="settings-font-list" aria-label="本机离线字体"></ul>
        <div class="settings-font-actions">
          <button type="button" class="btn" id="settings-font-import-batch">批量导入本机字体</button>
          <button type="button" class="btn" id="settings-font-clear-cache">清除在线缓存</button>
        </div>
        <p class="settings-font-cache-meta" id="settings-font-cache-meta"></p>
        <input type="file" id="settings-font-file-input" accept=".ttf,.otf,.woff2,.woff" hidden>
        <input type="file" id="settings-font-batch-input" accept=".ttf,.otf,.woff2,.woff" multiple hidden>
      </section>
      <div class="settings-footer">
        <p id="settings-status" role="status"></p>
        <button type="button" class="btn" id="settings-reset">恢复默认设置</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const status = dialog.querySelector('#settings-status');
  const fontList = dialog.querySelector('#settings-font-list');
  const cacheMeta = dialog.querySelector('#settings-font-cache-meta');
  const singleFileInput = dialog.querySelector('#settings-font-file-input');
  const batchFileInput = dialog.querySelector('#settings-font-batch-input');
  const batchImportButton = dialog.querySelector('#settings-font-import-batch');
  const clearCacheButton = dialog.querySelector('#settings-font-clear-cache');
  let pendingSlotKey = null;

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  async function refreshFontSection() {
    if (!fontManager || !fontList) return;
    await fontManager.restoreLocalFonts().catch(() => {});
    const slots = fontManager.listLocalFonts();
    fontList.replaceChildren(...slots.map(slot => {
      const item = document.createElement('li');
      item.className = 'settings-font-item';
      item.dataset.fontSlot = slot.key;

      const info = document.createElement('div');
      info.className = 'settings-font-info';
      const title = document.createElement('strong');
      title.textContent = slot.label;
      const detail = document.createElement('small');
      detail.textContent = slot.imported
        ? '本机已导入：' + slot.name + (slot.size ? '（' + formatSize(slot.size) + '）' : '')
        : (slot.key === 'num400' ? '使用在线字体（约 56 KB）' : '使用在线 WOFF2 按需分片');
      info.append(title, detail);

      const controls = document.createElement('div');
      controls.className = 'settings-font-controls';
      const importBtn = document.createElement('button');
      importBtn.type = 'button';
      importBtn.className = 'btn settings-font-btn';
      importBtn.dataset.importFontSlot = slot.key;
      importBtn.textContent = slot.imported ? '替换' : '导入';
      controls.append(importBtn);

      if (slot.imported) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn settings-font-btn';
        removeBtn.dataset.removeFontSlot = slot.key;
        removeBtn.textContent = '移除';
        controls.append(removeBtn);
      }

      item.append(info, controls);
      return item;
    }));

    const stats = await fontManager.getCacheStats();
    if (cacheMeta) {
      cacheMeta.textContent = stats.chunkCount > 0
        ? '浏览器已持久缓存 ' + stats.chunkCount + ' 个在线字体分片，再次打开无需重新下载。'
        : '在线字体分片会在浏览或导出后自动缓存到本地。';
    }
  }

  trigger.addEventListener('click', () => {
    dialog.showModal();
    refreshFontSection();
  });
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

  form.addEventListener('change', event => {
    if (event.target && event.target.type === 'file') return;
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

  if (fontManager && fontList) {
    fontList.addEventListener('click', async event => {
      const importBtn = event.target.closest('[data-import-font-slot]');
      if (importBtn) {
        pendingSlotKey = importBtn.dataset.importFontSlot;
        singleFileInput.value = '';
        singleFileInput.click();
        return;
      }
      const removeBtn = event.target.closest('[data-remove-font-slot]');
      if (removeBtn) {
        const key = removeBtn.dataset.removeFontSlot;
        await fontManager.removeLocalFont(key);
        await refreshFontSection();
        showStatus(true, '已移除本机字体，恢复使用在线分片');
      }
    });

    singleFileInput.addEventListener('change', async () => {
      const file = singleFileInput.files && singleFileInput.files[0];
      const slotKey = pendingSlotKey;
      pendingSlotKey = null;
      if (!file || !slotKey) return;
      try {
        await fontManager.importLocalFont(slotKey, file);
        await refreshFontSection();
        showStatus(true, '已导入本机字体：' + file.name);
      } catch (error) {
        showStatus(true, '导入失败：' + (error.message || '请检查字体文件'));
      }
    });

    batchImportButton.addEventListener('click', () => {
      batchFileInput.value = '';
      batchFileInput.click();
    });

    batchFileInput.addEventListener('change', async () => {
      const files = Array.from(batchFileInput.files || []);
      if (!files.length) return;
      let imported = 0;
      const skipped = [];
      for (const file of files) {
        try {
          const buffer = await file.arrayBuffer();
          const check = fontManager.validateFontBuffer(buffer);
          if (!check.valid) { skipped.push(file.name + '（格式无效）'); continue; }
          const slotKey = fontManager.identifyFontSlot(file.name, buffer);
          if (!slotKey) { skipped.push(file.name + '（未能识别字重，请点对应项单独导入）'); continue; }
          await fontManager.importLocalFont(slotKey, file, buffer);
          imported += 1;
        } catch {
          skipped.push(file.name + '（读取失败）');
        }
      }
      await refreshFontSection();
      if (imported && !skipped.length) {
        showStatus(true, '已导入 ' + imported + ' 个本机字体文件');
      } else if (imported) {
        showStatus(true, '已导入 ' + imported + ' 个字体，跳过：' + skipped.join('、'));
      } else {
        showStatus(true, '未能导入：' + skipped.join('、'));
      }
    });

    clearCacheButton.addEventListener('click', async () => {
      await fontManager.clearOnlineCache();
      await refreshFontSection();
      showStatus(true, '已清除在线字体缓存');
    });

    window.addEventListener('sign-fonts-updated', () => {
      if (dialog.open) refreshFontSection();
    });
  }

  preferences.subscribe(refresh);
  refresh();
})(window);
