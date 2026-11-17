import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test, before, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRelay } from '../server/freeimage-relay.mjs';

const editorOrigin = 'https://editor.example.com';
const imageAddress = 'https://iili.io/example.png';
const upstreamRequests = [];
let upstreamResponse;
let server;
let relay;

before(async () => {
  server = createRelay({
    origin: editorOrigin,
    fetchUpload: async (address, options) => {
      upstreamRequests.push({ address, ...options });
      return upstreamResponse();
    },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  relay = 'http://127.0.0.1:' + server.address().port + '/freeimage';
});

after(async () => { await new Promise(resolve => server.close(resolve)); });

function makeForm() {
  const form = new FormData();
  form.append('key', '假密钥');
  form.append('action', 'upload');
  form.append('format', 'json');
  form.append('source', new Blob(['测试用图片内容'], { type: 'image/png' }), 'sign.png');
  return form;
}

function send(body = makeForm(), origin = editorOrigin) {
  return fetch(relay, { method: 'POST', headers: { Origin: origin }, body });
}

test('只允许指定的编辑器网站发起跨站上传', async () => {
  for (const origin of [undefined, 'file://', editorOrigin + '/', editorOrigin + '/project']) {
    assert.throws(() => createRelay({ origin }), /EDITOR_ORIGIN/);
  }
  const preflight = await fetch(relay, {
    method: 'OPTIONS',
    headers: { Origin: editorOrigin, 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), editorOrigin);
  assert.match(preflight.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.equal((await send(makeForm(), 'https://other.example.com')).status, 403);
  assert.equal((await fetch(relay, { method: 'POST', body: makeForm() })).status, 403);
  assert.equal((await fetch(relay, { headers: { Origin: editorOrigin } })).status, 405);
  assert.equal((await fetch(relay + '/unrelated', { headers: { Origin: editorOrigin } })).status, 404);
  assert.equal(upstreamRequests.length, 0);
});

test('转发只向 Freeimage.host 的固定地址发送图片表单，并返回原图地址', async () => {
  upstreamResponse = () => Response.json({ status_code: 200, image: { url: imageAddress, url_viewer: 'https://freeimage.host/image/example' } });
  const response = await send();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), editorOrigin);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { image: { url: imageAddress } });
  const { address, method, body, redirect, signal } = upstreamRequests.at(-1);
  assert.equal(address, 'https://freeimage.host/api/1/upload');
  assert.equal(method, 'POST');
  assert.equal(redirect, 'error');
  assert.ok(signal instanceof AbortSignal);
  assert.equal(body.get('key'), '假密钥');
  assert.equal(body.get('action'), 'upload');
  assert.equal(body.get('format'), 'json');
  assert.equal(body.get('source').name, 'sign.png');
  assert.equal(await body.get('source').text(), '测试用图片内容');
});

test('转发拒绝网址代替图片、非图片请求、缺失密钥、多余字段和超限请求', async () => {
  const before = upstreamRequests.length;
  const withAddress = makeForm();
  withAddress.set('source', 'https://example.com/sign.png');
  const withoutKey = makeForm();
  withoutKey.delete('key');
  const withTarget = makeForm();
  withTarget.set('target', 'https://example.com/');
  assert.equal((await send(withAddress)).status, 400);
  assert.equal((await send(withoutKey)).status, 400);
  assert.equal((await send(withTarget)).status, 400);
  assert.equal((await send('纯文本')).status, 400);
  const malformed = await fetch(relay, {
    method: 'POST', headers: { Origin: editorOrigin, 'Content-Type': 'multipart/form-data; boundary=missing' },
    body: '损坏的表单',
  });
  assert.equal(malformed.status, 400);
  const large = makeForm();
  const maximumSize = 64 * 1024 * 1024;
  const maximumImage = new Blob([new Uint8Array(maximumSize)], { type: 'image/png' });
  large.set('source', new Blob([maximumImage, ' '], { type: 'image/png' }), 'sign.png');
  assert.equal((await send(large)).status, 413);
  large.set('source', new Blob([maximumImage, ' '.repeat(16 * 1024)], { type: 'image/png' }), 'sign.png');
  assert.equal((await send(large)).status, 413);
  assert.equal(upstreamRequests.length, before);
});

test('图床返回失败、无效地址或超时时，转发响应中不包含密钥和图床的错误详情', async () => {
  for (const [reply, status] of [
    [() => Response.json({ error: '假密钥' }, { status: 401 }), 401],
    [() => Response.json({ status_code: 429, image: { url: imageAddress } }), 429],
    [() => Response.json({ error: '假密钥' }, { status: 503 }), 502],
    [() => Response.json({ image: { url: imageAddress, thumb: { url: imageAddress } } }), 502],
    [() => Response.json({ image: { url: 'https://freeimage.host/image/example' } }), 502],
    [() => new Response('假密钥'), 502],
    [() => { throw new DOMException('假密钥', 'TimeoutError'); }, 504],
    [() => { throw new TypeError('假密钥'); }, 502],
  ]) {
    upstreamResponse = reply;
    const response = await send();
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /假密钥/);
  }
});

test('启动命令会指出编辑器地址或端口的配置错误', () => {
  const script = fileURLToPath(new URL('../server/freeimage-relay.mjs', import.meta.url));
  for (const [origin, port, message] of [
    [editorOrigin + '/wrong', '8787', /EDITOR_ORIGIN/],
    [editorOrigin, '65536', /端口/],
  ]) {
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, EDITOR_ORIGIN: origin, IMAGE_RELAY_PORT: port },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
  }
});
