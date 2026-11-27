(function (global) {
  'use strict';

  const upload = global.ImageUpload;
  const providers = Object.keys(upload.providers);
  const settings = upload.createSettings();
  let windowControls;

  function createDialog() {
    const dialog = document.createElement('dialog');
    dialog.id = 'image-upload-dialog';
    dialog.setAttribute('aria-labelledby', 'image-upload-heading');
    dialog.innerHTML = `
      <header class="image-upload-heading">
        <h2 id="image-upload-heading">上传到图床</h2>
        <button type="button" class="dialog-close" data-control-icon="close" aria-label="关闭图片上传"></button>
      </header>
      <label class="image-upload-field">
        <span>上传到</span>
        <select id="image-upload-provider">
          <option value="imgbb">ImgBB</option>
          <option value="freeimage">Freeimage.host</option>
          <option value="both">两家同时上传</option>
        </select>
      </label>
      <details id="image-upload-settings">
        <summary>图床设置</summary>
        <div class="image-upload-settings-content">
          <p>密钥默认只在本次打开的页面里有效。</p>
          <div>
            <label class="image-upload-field">ImgBB 密钥
              <input id="image-upload-key-imgbb" type="password" autocomplete="off" spellcheck="false">
            </label>
            <p>先<a href="https://imgbb.com/login" target="_blank" rel="noreferrer">登录 ImgBB</a>，再到<a href="https://api.imgbb.com/" target="_blank" rel="noreferrer">官方接口页</a>点「Get API key」。</p>
            <div class="image-upload-key-actions">
              <label><input id="remember-image-upload-key-imgbb" type="checkbox">在此浏览器记住</label>
              <button id="clear-image-upload-key-imgbb" type="button" class="btn">清除</button>
            </div>
          </div>
          <div>
            <label class="image-upload-field">Freeimage.host 密钥
              <input id="image-upload-key-freeimage" type="password" autocomplete="off" spellcheck="false">
            </label>
            <p>从<a href="https://freeimage.host/api" target="_blank" rel="noreferrer">官方接口页</a>复制公开密钥。</p>
            <div class="image-upload-key-actions">
              <label><input id="remember-image-upload-key-freeimage" type="checkbox">在此浏览器记住</label>
              <button id="clear-image-upload-key-freeimage" type="button" class="btn">清除</button>
            </div>
          </div>
          <label class="image-upload-field">Freeimage.host 转发地址
            <input id="image-upload-relay" type="url" placeholder="https://你的转发域名/freeimage" autocomplete="off" spellcheck="false">
          </label>
          <p>请填写你信任的 HTTPS 地址，转发服务会收到图片和密钥。<a href="docs/image-upload.md" target="_blank" rel="noreferrer">搭建说明</a></p>
          <p role="status" class="image-upload-settings-message"></p>
        </div>
      </details>
      <button id="start-image-upload" type="button" class="btn btn-primary">上传并复制图片地址</button>
      <button id="cancel-image-upload" type="button" class="btn" hidden>取消上传</button>
      <div class="image-upload-results"></div>`;

    const find = selector => dialog.querySelector(selector);
    const providerChoice = find('#image-upload-provider');
    const settingsPanel = find('#image-upload-settings');
    const settingsMessage = find('.image-upload-settings-message');
    const relayAddress = find('#image-upload-relay');
    const startButton = find('#start-image-upload');
    const cancelButton = find('#cancel-image-upload');
    const results = find('.image-upload-results');
    const keyControls = providers.map(provider => {
      const input = find('#image-upload-key-' + provider);
      const remember = find('#remember-image-upload-key-' + provider);
      const clear = find('#clear-image-upload-key-' + provider);
      function saveKey() {
        const wasRemembered = settings.remembersKey(provider);
        const saved = settings.setKey(provider, input.value, remember.checked);
        settingsMessage.textContent = saved || (!remember.checked && !wasRemembered)
          ? '' : '浏览器存储不可用，请检查浏览器设置。';
      }
      input.addEventListener('input', saveKey);
      remember.addEventListener('change', saveKey);
      clear.addEventListener('click', () => {
        const saved = settings.setKey(provider, '', false);
        input.value = '';
        remember.checked = false;
        settingsMessage.textContent = saved ? '已清除 ' + upload.providers[provider].name + ' 密钥。'
          : '请在浏览器设置中清除此网站的数据。';
        input.focus();
      });
      return { provider, input, remember };
    });
    let createImage;
    let activeUploads = 0;
    let currentBatch;

    function cancelUploads() {
      const batch = currentBatch;
      currentBatch = null;
      batch?.controller.abort();
      if (batch) batch.image = null;
      for (const result of batch?.results || []) {
        result.retry.hidden = true;
        if (!result.uploading) continue;
        result.uploading = false;
        result.status.textContent = '上传已取消。';
        result.progress.hidden = true;
      }
      activeUploads = 0;
      startButton.disabled = providerChoice.disabled = false;
      cancelButton.hidden = true;
    }

    function closeDialog() {
      cancelUploads();
      dialog.close();
    }

    function selectedProviders() {
      return providerChoice.value === 'both' ? providers : [providerChoice.value];
    }

    function providerSettings(provider) {
      return { key: settings.key(provider), relay: settings.relay };
    }

    function setSettingsOpen(open) {
      if (settingsPanel.open === open) return;
      if (dialog.open && typeof settingsPanel.setOpenAnimated === 'function') {
        settingsPanel.setOpenAnimated(open);
      } else {
        settingsPanel.open = open;
      }
    }

    function openMissingSettings() {
      for (const provider of selectedProviders()) {
        try { upload.checkSettings(provider, providerSettings(provider)); }
        catch { setSettingsOpen(true); return; }
      }
    }

    function makeResult(provider) {
      const row = document.createElement('section');
      row.dataset.imageUploadResult = provider;
      row.innerHTML = `
        <h3></h3>
        <p role="status"></p>
        <progress max="100" hidden></progress>
        <div class="image-upload-address" hidden>
          <input type="text" readonly>
          <button type="button" class="btn" data-copy-image-address>复制</button>
        </div>
        <button type="button" class="btn" data-retry-image-upload hidden>重试</button>`;
      const name = upload.providers[provider].name;
      row.querySelector('h3').textContent = name;
      const status = row.querySelector('[role="status"]');
      const progress = row.querySelector('progress');
      progress.setAttribute('aria-label', name + ' 上传进度');
      const addressBox = row.querySelector('.image-upload-address');
      const address = addressBox.querySelector('input');
      address.setAttribute('aria-label', name + ' 原图地址');
      address.addEventListener('focus', () => address.select());
      const copy = addressBox.querySelector('button');
      const retry = row.querySelector('[data-retry-image-upload]');
      async function copyAddress(manual) {
        try {
          await navigator.clipboard.writeText(address.value);
          if (!dialog.open || !row.isConnected) return;
          global.EditorNotifications.show('已复制原图地址。', 'success');
        } catch {
          if (!dialog.open || !row.isConnected) return;
          status.textContent = manual ? '请选中地址手动复制。' : '上传成功，请点「复制」。';
          if (manual) {
            address.focus();
            global.EditorNotifications.show('请选中地址手动复制。', 'warning');
          }
        }
      }
      copy.addEventListener('click', () => copyAddress(true));
      results.append(row);
      return { provider, status, progress, addressBox, address, retry, copyAddress, uploading: false };
    }

    async function uploadImage(batch, result) {
      if (result.uploading || currentBatch !== batch || batch.controller.signal.aborted) return;
      const isCurrent = () => currentBatch === batch && !batch.controller.signal.aborted && dialog.open;
      const { provider, status, progress, addressBox, address, retry } = result;
      result.uploading = true;
      activeUploads += 1;
      startButton.disabled = providerChoice.disabled = true;
      cancelButton.hidden = false;
      retry.hidden = true;
      status.textContent = '正在生成图片…';
      try {
        const currentSettings = providerSettings(provider);
        upload.checkSettings(provider, currentSettings);
        if (!batch.image) {
          batch.image = Promise.resolve().then(() => {
            batch.controller.signal.throwIfAborted();
            return batch.createImage();
          }).catch(error => {
            batch.image = null;
            throw error;
          });
        }
        const image = await batch.image;
        if (!isCurrent()) return;
        const request = upload.makeRequest(provider, currentSettings, image);
        status.textContent = '正在上传…';
        progress.removeAttribute('value');
        progress.hidden = false;
        const uploadedAddress = await upload.sendUpload(provider, request, percent => {
          if (!isCurrent()) return;
          progress.value = percent;
          if (percent === 100) status.textContent = '等待图床返回地址…';
        }, undefined, batch.controller.signal);
        if (!isCurrent()) return;
        address.value = uploadedAddress;
        addressBox.hidden = false;
        status.textContent = '上传成功。';
        if (!batch.triedFirstCopy) {
          batch.triedFirstCopy = true;
          result.copyAddress(false);
        }
      } catch (error) {
        if (!isCurrent()) return;
        status.textContent = error.message || '上传失败，请重试。';
        retry.hidden = false;
      } finally {
        if (currentBatch === batch) {
          progress.hidden = true;
          result.uploading = false;
          activeUploads -= 1;
          startButton.disabled = providerChoice.disabled = activeUploads > 0;
          cancelButton.hidden = activeUploads === 0;
        }
      }
    }

    find('.image-upload-heading button').addEventListener('click', closeDialog);
    cancelButton.addEventListener('click', cancelUploads);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
    dialog.addEventListener('close', () => { if (!dialog.open) cancelUploads(); });
    global.addEventListener('pagehide', cancelUploads);
    providerChoice.addEventListener('change', () => {
      settings.choice = providerChoice.value;
      openMissingSettings();
    });
    relayAddress.addEventListener('input', () => { settings.relay = relayAddress.value; });
    startButton.addEventListener('click', () => {
      if (activeUploads) return;
      cancelUploads();
      const batch = currentBatch = { createImage, image: null, triedFirstCopy: false, controller: new AbortController() };
      results.replaceChildren();
      setSettingsOpen(false);
      openMissingSettings();
      const rows = selectedProviders().map(makeResult);
      batch.results = rows;
      for (const result of rows) {
        result.retry.addEventListener('click', () => uploadImage(batch, result));
        uploadImage(batch, result);
      }
    });

    document.body.append(dialog);
    global.EditorControls?.scan(dialog);
    return {
      open(generateImage) {
        if (dialog.open) return;
        cancelUploads();
        createImage = generateImage;
        providerChoice.value = settings.choice;
        relayAddress.value = settings.relay;
        for (const { provider, input, remember } of keyControls) {
          input.value = settings.key(provider);
          remember.checked = settings.remembersKey(provider);
        }
        openMissingSettings();
        dialog.showModal();
      },
    };
  }

  function addButton(anchor, createImage) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.dataset.controlIcon = 'upload';
    button.dataset.openImageUpload = '';
    button.title = '上传原尺寸 PNG 到图床';
    button.textContent = '上传图床';
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => {
      if (!windowControls) windowControls = createDialog();
      windowControls.open(createImage);
    });
    anchor.after(button);
  }

  global.ImageUploadDialog = { addButton };
})(window);
