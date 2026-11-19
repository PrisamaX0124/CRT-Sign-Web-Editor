import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRelay } from '../server/freeimage-relay.mjs';

const origin = 'https://editor.example.com';

function makeForm() {
  const form = new FormData();
  form.set('key', '测试密钥');
  form.set('action', 'upload');
  form.set('format', 'json');
  form.set('source', new Blob(['图片'], { type: 'image/png' }), 'sign.png');
  return form;
}

async function withRelay(options, check) {
  let forwards = 0;
  const { fetchUpload, ...settings } = options;
  const server = createRelay({ origin, fetchUpload: async (...argumentsList) => {
    forwards += 1;
    return fetchUpload ? fetchUpload(...argumentsList)
      : Response.json({ image: { url: 'https://iili.io/test.png' } });
  }, ...settings });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = 'http://127.0.0.1:' + server.address().port + '/freeimage';
  const send = (extraHeaders = {}, body = makeForm(), signal = AbortSignal.timeout(5000)) => fetch(address, {
    method: 'POST', headers: { Origin: origin, ...extraHeaders }, body, signal,
  });
  try { await check(send, () => forwards); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('同一地址超出频率后返回 429 和重试时间，伪造转发地址不能绕过', async () => {
  let time = 1000;
  await withRelay({ limits: { requestsPerWindow: 1, requestWindow: 1000 }, now: () => time }, async (send, forwards) => {
    assert.equal((await send()).status, 200);
    const refused = await send({ 'X-Forwarded-For': '198.51.100.2' });
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get('Retry-After'), '1');
    assert.equal(forwards(), 1);
    time += 1000;
    assert.equal((await send()).status, 200);
  });
});

test('访问者取消请求后，中止向图床的转发并释放上传名额', async () => {
  let begin;
  let canceled;
  let count = 0;
  const started = new Promise(resolve => { begin = resolve; });
  const aborted = new Promise(resolve => { canceled = resolve; });
  await withRelay({ limits: { concurrentUploads: 1 }, fetchUpload: async (address, { signal }) => {
    if (count++) return Response.json({ image: { url: 'https://iili.io/test.png' } });
    begin();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
      canceled();
      reject(signal.reason);
    }, { once: true }));
  } }, async send => {
    const controller = new AbortController();
    const first = send({}, makeForm(), controller.signal);
    await started;
    controller.abort();
    await assert.rejects(first, { name: 'AbortError' });
    await aborted;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await send()).status, 200);
  });
});

test('同时上传达到上限时拒绝新请求，成功和失败后都会释放名额', async () => {
  const completions = [];
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  await withRelay({ limits: { concurrentUploads: 1 }, fetchUpload: () => {
    started();
    return new Promise(resolve => { completions.push(resolve); });
  } }, async send => {
    const first = send();
    await waiting;
    try { assert.equal((await send()).status, 429); }
    finally { for (const finish of completions) finish(new Response('', { status: 503 })); }
    assert.equal((await first).status, 502);
    const next = send();
    await new Promise(resolve => setTimeout(resolve, 20));
    completions.at(-1)(Response.json({ image: { url: 'https://iili.io/test.png' } }));
    assert.equal((await next).status, 200);
  });
});

test('单个地址和全服务的上传量配额分别生效，到期后恢复', async () => {
  for (const quota of ['bytesPerAddress', 'totalBytesPerWindow']) {
    let time = 0;
    const body = await new Response(makeForm()).arrayBuffer();
    await withRelay({ limits: { [quota]: body.byteLength, quotaWindow: 1000 }, now: () => time }, async send => {
      assert.equal((await send()).status, 200);
      const refused = await send();
      assert.equal(refused.status, 429);
      assert.match((await refused.json()).message, /上传量/);
      time = 1000;
      assert.equal((await send()).status, 200);
    });
  }
});

test('接收中的表单超过上传量配额时立即拒绝，不向图床转发', async () => {
  await withRelay({ limits: { bytesPerAddress: 10 } }, async (send, forwards) => {
    assert.equal((await send()).status, 429);
    assert.equal(forwards(), 0);
  });
});

test('只相信指定的转发服务器，从右往左识别访问者，分别限制不同地址', async () => {
  await withRelay({ trustedProxies: ['127.0.0.1'], limits: { requestsPerWindow: 1 } }, async send => {
    assert.equal((await send({ 'X-Forwarded-For': '198.51.100.9, 198.51.100.1' })).status, 200);
    assert.equal((await send({ 'X-Forwarded-For': '198.51.100.8, 198.51.100.1' })).status, 429);
    assert.equal((await send({ 'X-Forwarded-For': '198.51.100.2' })).status, 200);
    assert.equal((await send({ 'X-Forwarded-For': 'invalid-address' })).status, 200);
    assert.equal((await send({ 'X-Forwarded-For': 'another-invalid-address' })).status, 429);
  });
  assert.throws(() => createRelay({ origin, trustedProxies: ['不正确的地址'] }), /IP/);
});

test('地址记录达到上限时拒绝新地址，过期记录清理后可以继续上传', async () => {
  let time = 0;
  await withRelay({ trustedProxies: ['127.0.0.1'], now: () => time,
    limits: { maximumAddresses: 1, requestWindow: 1000, quotaWindow: 1000 } }, async send => {
    assert.equal((await send({ 'X-Forwarded-For': '198.51.100.1' })).status, 200);
    assert.equal((await send({ 'X-Forwarded-For': '198.51.100.2' })).status, 429);
    time = 1000;
    assert.equal((await send({ 'X-Forwarded-For': '198.51.100.2' })).status, 200);
  });
});

test('无效表单同样计入请求次数，配置必须是正整数', async () => {
  await withRelay({ limits: { requestsPerWindow: 1 } }, async send => {
    assert.equal((await send({}, '错误表单')).status, 400);
    assert.equal((await send()).status, 429);
  });
  for (const value of [0, -1, 1.5, NaN]) {
    assert.throws(() => createRelay({ origin, limits: { concurrentUploads: value } }), /正整数/);
  }
});
