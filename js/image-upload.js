(function (global) {
  'use strict';

  const storagePrefix = 'sign-image-upload-';
  const providers = {
    imgbb: { name: 'ImgBB', hostname: 'i.ibb.co' },
    freeimage: { name: 'Freeimage.host', hostname: 'iili.io' },
  };
  const maximumImgbbSize = 32 * 1024 * 1024;
  const uploadTimeout = 90000;

  function createSettings(getStorage = () => global.localStorage) {
    function read(name) {
      try { return getStorage().getItem(storagePrefix + name) || ''; }
      catch { return ''; }
    }

    function write(name, value) {
      try {
        if (value) getStorage().setItem(storagePrefix + name, value);
        else getStorage().removeItem(storagePrefix + name);
        return true;
      } catch {
        return false;
      }
    }

    const pageKeys = new Map();
    const lastChoice = read('provider');
    let choice = ['imgbb', 'freeimage', 'both'].includes(lastChoice) ? lastChoice : 'imgbb';
    let relay = read('relay');
    return {
      get choice() { return choice; },
      set choice(value) { choice = value; write('provider', value); },
      get relay() { return relay; },
      set relay(value) { relay = value.trim(); write('relay', relay); },
      key(provider) { return pageKeys.get(provider) ?? read('key-' + provider); },
      remembersKey(provider) { return !pageKeys.has(provider) && Boolean(read('key-' + provider)); },
      setKey(provider, value, remember) {
        const key = value.trim();
        const saved = write('key-' + provider, remember ? key : '');
        if (remember && saved) pageKeys.delete(provider);
        else pageKeys.set(provider, key);
        return saved;
      },
    };
  }

  function secureAddress(value) {
    if (typeof value !== 'string' || !/^https:\/\//i.test(value)) return null;
    try {
      const address = new URL(value);
      if (!address.username && !address.password && !address.hash) return address;
    } catch {
      return null;
    }
    return null;
  }

  function checkSettings(provider, { key, relay }) {
    if (!key) throw new Error('请在图床设置中填写密钥。');
    if (provider === 'freeimage' && !secureAddress(relay)) {
      throw new Error('请在图床设置中填写有效的 HTTPS 转发地址。');
    }
  }

  function makeRequest(provider, settings, image) {
    checkSettings(provider, settings);
    const form = new FormData();
    if (provider === 'imgbb') {
      if (image.size > maximumImgbbSize) throw new Error('图片超过 ImgBB 的 32 MB 上限。');
      const address = new URL('https://api.imgbb.com/1/upload');
      address.searchParams.set('key', settings.key);
      form.append('image', image, 'sign.png');
      return { address: address.href, form };
    }
    form.append('key', settings.key);
    form.append('action', 'upload');
    form.append('format', 'json');
    form.append('source', image, 'sign.png');
    return { address: secureAddress(settings.relay).href, form };
  }

  function getImageAddress(provider, response) {
    const status = Number(response?.status_code ?? response?.status ?? 200);
    if (response?.success === false || status < 200 || status >= 300) {
      throw new Error(uploadError(provider, status));
    }
    const picture = provider === 'imgbb' ? response?.data : response?.image;
    const address = secureAddress(picture?.url);
    if (!address || address.hostname !== providers[provider].hostname || address.port ||
        !/\.png$/i.test(address.pathname) || /\.(th|md)\.png$/i.test(address.pathname) ||
        picture.url === picture.thumb?.url || picture.url === picture.medium?.url) {
      throw new Error('图床未返回可用的原图地址。');
    }
    return address.href;
  }

  function uploadError(provider, status) {
    if (status === 401 || status === 403) {
      return provider === 'imgbb'
        ? '上传被拒绝，请检查 ImgBB 密钥。'
        : '上传被拒绝，请检查 Freeimage.host 密钥和转发服务设置。';
    }
    if (status === 413) return '图片过大，图床或转发服务无法接收。';
    if (status === 429) return '上传过于频繁，请稍后重试。';
    if (status === 408 || status === 504) return '上传超时，请重试。';
    return '上传失败，请检查图床设置后重试。';
  }

  function sendUpload(provider, { address, form }, showProgress, createRequest = () => new global.XMLHttpRequest(), signal) {
    return new Promise((resolve, reject) => {
      let request;
      let finished = false;
      function finish(error, address) {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve(address);
      }
      function cancel() {
        finish(new DOMException('上传已取消。', 'AbortError'));
        request?.abort();
      }
      if (signal?.aborted) { cancel(); return; }
      try {
        request = createRequest();
        request.open('POST', address);
        request.responseType = 'json';
        request.timeout = uploadTimeout;
        request.upload.onprogress = event => {
          if (!finished && event.lengthComputable && event.total > 0) showProgress(Math.round(event.loaded * 100 / event.total));
        };
        request.upload.onload = () => { if (!finished) showProgress(100); };
        request.ontimeout = () => finish(new Error(uploadError(provider, 408)));
        request.onerror = () => finish(new Error('无法连接，请检查网络后重试。'));
        request.onabort = () => finish(new DOMException('上传已取消。', 'AbortError'));
        request.onload = () => {
          if (finished) return;
          try {
            if (request.status < 200 || request.status >= 300) throw new Error(uploadError(provider, request.status));
            finish(null, getImageAddress(provider, request.response));
          } catch (error) {
            finish(error);
          }
        };
        signal?.addEventListener('abort', cancel, { once: true });
        request.send(form);
      } catch {
        finish(new Error('无法开始上传，请检查图床设置后重试。'));
      }
    });
  }

  global.ImageUpload = { providers, createSettings, checkSettings, makeRequest, getImageAddress, sendUpload };
})(typeof window !== 'undefined' ? window : globalThis);
