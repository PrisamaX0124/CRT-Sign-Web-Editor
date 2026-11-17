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
        <h2 id="image-upload-heading">上传图片</h2>
        <button type="button" class="icon-btn" aria-label="关闭图片上传">×</button>
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
      <div class="image-upload-results"></div>`;

    const find = selector => dialog.querySelector(selector);
    const providerChoice = find('#image-upload-provider');
    const settingsPanel = find('#image-upload-settings');
    const settingsMessage = find('.image-upload-settings-message');
    const relayAddress = find('#image-upload-relay');
    const startButton = find('#start-image-upload');
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

    function selectedProviders() {
      return providerChoice.value === 'both' ? providers : [providerChoice.value];
    }

    function providerSettings(provider) {
      return { key: settings.key(provider), relay: settings.relay };
    }

    function openMissingSettings() {
      for (const provider of selectedProviders()) {
        try { upload.checkSettings(provider, providerSettings(provider)); }
        catch { settingsPanel.open = true; return; }
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
          status.textContent = '已复制原图地址。';
        } catch {
          status.textContent = manual ? '请选中地址手动复制。' : '上传成功，请点「复制」。';
          if (manual) address.focus();
        }
      }
      copy.addEventListener('click', () => copyAddress(true));
      results.append(row);
      return { provider, status, progress, addressBox, address, retry, copyAddress, uploading: false };
    }

    async function uploadImage(batch, result) {
      if (result.uploading) return;
      const { provider, status, progress, addressBox, address, retry } = result;
      result.uploading = true;
      activeUploads += 1;
      startButton.disabled = providerChoice.disabled = true;
      retry.hidden = true;
      status.textContent = '正在生成图片…';
      try {
        const currentSettings = providerSettings(provider);
        upload.checkSettings(provider, currentSettings);
        if (!batch.image) {
          batch.image = Promise.resolve().then(batch.createImage).catch(error => {
            batch.image = null;
            throw error;
          });
        }
        const image = await batch.image;
        const request = upload.makeRequest(provider, currentSettings, image);
        status.textContent = '正在上传…';
        progress.removeAttribute('value');
        progress.hidden = false;
        address.value = await upload.sendUpload(provider, request, percent => {
          progress.value = percent;
          if (percent === 100) status.textContent = '等待图床返回地址…';
        });
        addressBox.hidden = false;
        status.textContent = '上传成功。';
        if (!batch.triedFirstCopy) {
          batch.triedFirstCopy = true;
          result.copyAddress(false);
        }
      } catch (error) {
        status.textContent = error.message || '上传失败，请重试。';
        retry.hidden = false;
      } finally {
        progress.hidden = true;
        result.uploading = false;
        activeUploads -= 1;
        startButton.disabled = providerChoice.disabled = activeUploads > 0;
      }
    }

    find('.image-upload-heading button').addEventListener('click', () => dialog.close());
    providerChoice.addEventListener('change', () => {
      settings.choice = providerChoice.value;
      openMissingSettings();
    });
    relayAddress.addEventListener('input', () => { settings.relay = relayAddress.value; });
    startButton.addEventListener('click', () => {
      if (activeUploads) return;
      const batch = { createImage, image: null, triedFirstCopy: false };
      results.replaceChildren();
      settingsPanel.open = false;
      openMissingSettings();
      const rows = selectedProviders().map(makeResult);
      for (const result of rows) {
        result.retry.addEventListener('click', () => uploadImage(batch, result));
        uploadImage(batch, result);
      }
    });

    document.body.append(dialog);
    return {
      open(generateImage) {
        if (dialog.open) return;
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

  function addButton(downloadButton, createImage) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.textContent = '上传图片';
    button.dataset.openImageUpload = '';
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => {
      if (!windowControls) windowControls = createDialog();
      windowControls.open(createImage);
    });
    downloadButton.after(button);
  }

  global.ImageUploadDialog = { addButton };
})(window);
