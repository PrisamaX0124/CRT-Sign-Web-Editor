import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../js/image-upload.js';

const upload = globalThis.ImageUpload;
const image = new Blob(['假图片'], { type: 'image/png' });
const relay = 'https://upload.example.com/freeimage';
const imgbbAddress = 'https://i.ibb.co/example/sign.png';
const freeimageAddress = 'https://iili.io/example.png';

function makeStorage() {
  const items = new Map();
  return {
    getItem: name => items.get(name) ?? null,
    setItem: (name, value) => items.set(name, value),
    removeItem: name => items.delete(name),
    items,
  };
}

test('图床默认选 ImgBB，之后记住图床和转发地址', () => {
  const storage = makeStorage();
  const settings = upload.createSettings(() => storage);
  assert.equal(settings.choice, 'imgbb');
  assert.equal(settings.relay, '');
  settings.choice = 'both';
  settings.relay = relay;
  const reopened = upload.createSettings(() => storage);
  assert.equal(reopened.choice, 'both');
  assert.equal(reopened.relay, relay);
});

test('两家密钥默认只在当前页面有效，可以分别记住、取消记住、清除', () => {
  const storage = makeStorage();
  const open = () => upload.createSettings(() => storage);
  const settings = open();
  assert.equal(settings.setKey('imgbb', ' 假密钥一 ', false), true);
  assert.equal(settings.setKey('freeimage', '假密钥二', true), true);
  assert.equal(settings.key('imgbb'), '假密钥一');
  assert.equal(settings.remembersKey('imgbb'), false);
  assert.equal(open().key('imgbb'), '');
  assert.equal(open().key('freeimage'), '假密钥二');
  assert.equal(open().remembersKey('freeimage'), true);
  assert.deepEqual([...storage.items.keys()], ['sign-image-upload-key-freeimage']);
  settings.setKey('freeimage', '假密钥二', false);
  assert.equal(settings.key('freeimage'), '假密钥二');
  assert.equal(open().key('freeimage'), '');
  settings.setKey('imgbb', '假密钥一', true);
  open().setKey('imgbb', '', false);
  assert.equal(settings.key('imgbb'), '');
});

test('浏览器存储不可用时，当前页面仍能设置图床和密钥', () => {
  const settings = upload.createSettings(() => { throw new Error('存储不可用'); });
  assert.equal(settings.choice, 'imgbb');
  settings.choice = 'freeimage';
  settings.relay = relay;
  assert.equal(settings.setKey('freeimage', '假密钥', true), false);
  assert.equal(settings.remembersKey('freeimage'), false);
  assert.equal(settings.key('freeimage'), '假密钥');
  assert.equal(settings.choice, 'freeimage');
  assert.equal(settings.relay, relay);
});

test('ImgBB 的请求地址带密钥，表单里只有原图，大小上限为 32 MB', async () => {
  const request = upload.makeRequest('imgbb', { key: '假&密钥' }, image);
  const address = new URL(request.address);
  assert.equal(address.origin + address.pathname, 'https://api.imgbb.com/1/upload');
  assert.deepEqual([...address.searchParams], [['key', '假&密钥']]);
  assert.deepEqual([...request.form.keys()], ['image']);
  const file = request.form.get('image');
  assert.equal(file.name, 'sign.png');
  assert.equal(file.type, 'image/png');
  assert.equal(await file.text(), await image.text());
  const limit = 32 * 1024 * 1024;
  const boundary = new Blob([new Uint8Array(limit)], { type: 'image/png' });
  assert.equal(upload.makeRequest('imgbb', { key: '假密钥' }, boundary).form.get('image').size, limit);
  assert.throws(() => upload.makeRequest('imgbb', { key: '假密钥' }, new Blob([boundary, ' '], { type: 'image/png' })), /32 MB/);
});

test('Freeimage.host 只向配置的安全地址发送四个表单字段', async () => {
  const request = upload.makeRequest('freeimage', { key: '假密钥', relay }, image);
  assert.equal(request.address, relay);
  assert.deepEqual([...request.form.keys()], ['key', 'action', 'format', 'source']);
  assert.equal(request.form.get('key'), '假密钥');
  assert.equal(request.form.get('action'), 'upload');
  assert.equal(request.form.get('format'), 'json');
  assert.equal(request.form.get('source').type, 'image/png');
  assert.equal(await request.form.get('source').text(), await image.text());
  for (const address of ['', '//example.com', 'http://example.com/', 'https://user:pass@example.com/']) {
    assert.throws(() => upload.makeRequest('freeimage', { key: '假密钥', relay: address }, image), /转发地址/);
  }
  assert.throws(() => upload.makeRequest('imgbb', { key: '' }, image), /密钥/);
});

test('只接受两家返回的原图字段与对应域名', () => {
  assert.equal(upload.getImageAddress('imgbb', { data: { url: imgbbAddress, display_url: 'https://i.ibb.co/small.png' } }), imgbbAddress);
  assert.equal(upload.getImageAddress('freeimage', { image: { url: freeimageAddress } }), freeimageAddress);
  for (const address of [
    'http://iili.io/example.png', 'https://iili.io.example.com/example.png',
    'https://freeimage.host/image/example', 'https://name@iili.io/example.png',
    'https://iili.io:8080/example.png', 'https://iili.io/example.md.png',
  ]) {
    assert.throws(() => upload.getImageAddress('freeimage', { image: { url: address } }), /原图地址/);
  }
  assert.throws(() => upload.getImageAddress('imgbb', { data: { display_url: imgbbAddress } }), /原图地址/);
  assert.throws(() => upload.getImageAddress('imgbb', { data: { url: imgbbAddress, thumb: { url: imgbbAddress } } }), /原图地址/);
  assert.throws(() => upload.getImageAddress('imgbb', null), /原图地址/);
  assert.throws(() => upload.getImageAddress('imgbb', { data: { url: 'https://[' } }), /原图地址/);
  assert.throws(() => upload.getImageAddress('imgbb', { success: false, data: { url: imgbbAddress } }), /上传失败/);
  assert.throws(() => upload.getImageAddress('freeimage', { status_code: 400, image: { url: freeimageAddress } }), /上传失败/);
  assert.throws(() => upload.getImageAddress('freeimage', { status_code: 403 }), /Freeimage.host 密钥/);
});

function sendWithResponse(event, status, response) {
  const progress = [];
  const request = {
    upload: {},
    open(method, address) { this.method = method; this.address = address; },
    send(form) {
      this.form = form;
      this.upload.onprogress({ lengthComputable: false });
      this.upload.onprogress({ lengthComputable: true, loaded: 1, total: 4 });
      this.upload.onload();
      this.status = status;
      this.response = response;
      this['on' + event]();
    },
  };
  const result = upload.sendUpload('imgbb', { address: 'https://example.com', form: image }, value => progress.push(value), () => request);
  return { result, request, progress };
}

test('上传报告发送进度，等待图床返回原图后结束', async () => {
  const { result, request, progress } = sendWithResponse('load', 200, { data: { url: imgbbAddress } });
  assert.equal(await result, imgbbAddress);
  assert.equal(request.method, 'POST');
  assert.equal(request.form, image);
  assert.equal(request.responseType, 'json');
  assert.ok(request.timeout > 0);
  assert.deepEqual(progress, [25, 100]);
});

test('超时、网络错误、密钥被拒、文件过大、限流和无效响应均返回可读提示', async () => {
  for (const [event, status, response, message] of [
    ['timeout', 0, null, /超时/],
    ['error', 0, null, /连接/],
    ['load', 401, null, /密钥/],
    ['load', 403, null, /密钥/],
    ['load', 413, null, /过大/],
    ['load', 429, null, /频繁/],
    ['load', 502, { error: '假密钥' }, /上传失败/],
    ['load', 200, null, /原图地址/],
  ]) {
    await assert.rejects(sendWithResponse(event, status, response).result, error => {
      assert.match(error.message, message);
      assert.doesNotMatch(error.message, /假密钥/);
      return true;
    });
  }
});

test('浏览器拒绝创建请求时，提示重试且不显示密钥', async () => {
  for (const createRequest of [
    () => ({ open() { throw new Error('假密钥'); } }),
    () => ({ open() {}, upload: {}, send() { throw new Error('假密钥'); } }),
  ]) {
    await assert.rejects(upload.sendUpload('imgbb', { address: imgbbAddress, form: image }, () => {}, createRequest), /无法开始上传/);
  }
});

test('网页入口使用浏览器存储和上传请求', async () => {
  const storage = makeStorage();
  storage.setItem('sign-image-upload-provider', '过时的选项');
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  globalThis.XMLHttpRequest = class {
    upload = {};
    open() {}
    send() { this.status = 200; this.response = { image: { url: freeimageAddress } }; this.onload(); }
  };
  try {
    assert.equal(upload.createSettings().choice, 'imgbb');
    assert.equal(await upload.sendUpload('freeimage', { address: relay, form: image }, () => {}), freeimageAddress);
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
    delete globalThis.XMLHttpRequest;
  }
});
