import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { isIP as addressVersion } from 'node:net';

const uploadTarget = 'https://freeimage.host/api/1/upload';
const maximumImageSize = 64 * 1024 * 1024;
const maximumFormSize = maximumImageSize + 16 * 1024;
const defaultLimits = {
  requestWindow: 60000,
  requestsPerWindow: 30,
  concurrentUploads: 4,
  quotaWindow: 3600000,
  bytesPerAddress: 256 * 1024 * 1024,
  totalBytesPerWindow: 1024 * 1024 * 1024,
  maximumAddresses: 10000,
};

function reply(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function readForm(request, response, receiveBytes) {
  const contentType = request.headers['content-type'];
  if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) {
    reply(response, 400, { message: '请发送图片表单。' });
    return;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maximumFormSize) {
      request.resume();
      reply(response, 413, { message: '图片表单过大。' });
      return;
    }
    if (!receiveBytes(chunk.length)) { request.resume(); return; }
    chunks.push(chunk);
  }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': contentType } }).formData();
  } catch {
    reply(response, 400, { message: '图片表单无法读取。' });
  }
}

function formError(form) {
  const key = form.get('key');
  const image = form.get('source');
  if (typeof key !== 'string' || !key.trim() || form.get('action') !== 'upload' || form.get('format') !== 'json' ||
      !(image instanceof File) || image.type !== 'image/png' || !image.size || [...form].length !== 4) {
    return 400;
  }
  if (image.size > maximumImageSize) return 413;
}

async function forwardUpload(form, response, fetchUpload, signal) {
  try {
    const upstream = await fetchUpload(uploadTarget, {
      method: 'POST',
      body: form,
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    });
    const result = upstream.ok ? await upstream.json() : null;
    const status = Number(result?.status_code ?? upstream.status);
    if (status >= 400 && status < 500) {
      reply(response, status, { message: '图床拒绝了上传。' });
      return;
    }
    const image = result?.image;
    const address = URL.parse(image?.url ?? '');
    if (!upstream.ok || status < 200 || status >= 300 || address?.origin !== 'https://iili.io' ||
        address.username || address.password || address.hash || !/\.png$/i.test(address.pathname) ||
        /\.(th|md)\.png$/i.test(address.pathname) || image.url === image.thumb?.url || image.url === image.medium?.url) {
      reply(response, 502, { message: '图床未返回可用的原图地址。' });
      return;
    }
    reply(response, 200, { image: { url: address.href } });
  } catch (error) {
    const timedOut = error.name === 'TimeoutError';
    reply(response, timedOut ? 504 : 502, { message: timedOut ? '连接图床超时。' : '图床上传失败。' });
  }
}

export function createRelay({ origin, fetchUpload = fetch, limits = {}, now = Date.now, trustedProxies = [] }) {
  if (!/^https?:\/\/[^/]+$/i.test(origin ?? '') || URL.parse(origin)?.origin !== origin) {
    throw new Error('请将 EDITOR_ORIGIN 设为编辑器网址中的协议、域名和端口。');
  }
  const settings = { ...defaultLimits, ...limits };
  function normalizedAddress(value) {
    return value?.startsWith('::ffff:') && addressVersion(value.slice(7)) === 4 ? value.slice(7) : value;
  }
  if (!Array.isArray(trustedProxies) || trustedProxies.some(address => !addressVersion(address))) {
    throw new Error('可信转发服务器必须填写有效的 IP 地址。');
  }
  const trustedAddresses = new Set(trustedProxies.map(normalizedAddress));
  function clientAddress(request) {
    let address = normalizedAddress(request.socket.remoteAddress);
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded !== 'string') return address;
    const chain = forwarded.split(',').map(value => value.trim());
    // 从最近的服务器往回检查，不能直接相信客户端填写的第一个地址。
    while (trustedAddresses.has(address) && chain.length) {
      const previous = chain.pop();
      if (!addressVersion(previous)) return normalizedAddress(request.socket.remoteAddress);
      address = normalizedAddress(previous);
    }
    return address;
  }
  for (const [name, value] of Object.entries(settings)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(name + ' 必须是正整数。');
  }
  const addresses = new Map();
  let activeUploads = 0;
  let totalBytes = 0;
  let totalReset = now() + settings.quotaWindow;

  function refreshTotal(time) {
    if (time >= totalReset) { totalBytes = 0; totalReset = time + settings.quotaWindow; }
  }

  function refuse(response, message, reset) {
    response.setHeader('Retry-After', String(Math.max(1, Math.ceil((reset - now()) / 1000))));
    reply(response, 429, { message });
  }

  return createServer({ requestTimeout: 80000 }, async (request, response) => {
    response.setHeader('Vary', 'Origin');
    if (request.url !== '/freeimage') return reply(response, 404, { message: '上传路径应为 /freeimage。' });
    if (request.headers.origin !== origin) return reply(response, 403, { message: '此网站未获准上传。' });
    response.setHeader('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      response.end();
      return;
    }
    if (request.method !== 'POST') return reply(response, 405, { message: '请使用 POST 上传图片。' });
    const time = now();
    refreshTotal(time);
    const address = clientAddress(request);
    let account = addresses.get(address);
    if (!account) {
      for (const [key, record] of addresses) {
        if (!record.active && time >= record.requestReset && time >= record.quotaReset) addresses.delete(key);
      }
      if (addresses.size >= settings.maximumAddresses) {
        return refuse(response, '当前上传人数过多，请稍后重试。', time + settings.requestWindow);
      }
      account = { requests: 0, bytes: 0, active: 0, requestReset: time + settings.requestWindow, quotaReset: time + settings.quotaWindow };
      addresses.set(address, account);
    }
    if (time >= account.requestReset) { account.requests = 0; account.requestReset = time + settings.requestWindow; }
    if (time >= account.quotaReset) { account.bytes = 0; account.quotaReset = time + settings.quotaWindow; }
    if (account.requests >= settings.requestsPerWindow) {
      return refuse(response, '上传过于频繁，请稍后重试。', account.requestReset);
    }
    account.requests += 1;
    if (activeUploads >= settings.concurrentUploads) {
      return refuse(response, '同时上传的图片过多，请稍后重试。', time + 1000);
    }
    if (account.bytes >= settings.bytesPerAddress || totalBytes >= settings.totalBytesPerWindow) {
      return refuse(response, '本时段上传量已达到上限，请稍后重试。',
        account.bytes >= settings.bytesPerAddress ? account.quotaReset : totalReset);
    }
    activeUploads += 1;
    account.active += 1;
    const controller = new AbortController();
    const cancel = () => { if (!response.writableFinished) controller.abort(); };
    response.on('close', cancel);
    try {
      const form = await readForm(request, response, size => {
        const time = now();
        refreshTotal(time);
        if (time >= account.quotaReset) { account.bytes = 0; account.quotaReset = time + settings.quotaWindow; }
        if (account.bytes + size > settings.bytesPerAddress || totalBytes + size > settings.totalBytesPerWindow) {
          refuse(response, '本时段上传量已达到上限，请稍后重试。',
            account.bytes + size > settings.bytesPerAddress ? account.quotaReset : totalReset);
          return false;
        }
        account.bytes += size;
        totalBytes += size;
        return true;
      });
      if (!form) return;
      const status = formError(form);
      if (status) {
        reply(response, status, { message: status === 413 ? '图片过大。' : '请填写密钥并提供 PNG 图片。' });
        return;
      }
      await forwardUpload(form, response, fetchUpload, controller.signal);
    } catch {
      if (!response.headersSent) reply(response, 400, { message: '未能接收图片。' });
    } finally {
      activeUploads -= 1;
      account.active -= 1;
      response.removeListener('close', cancel);
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const port = Number(process.env.IMAGE_RELAY_PORT || 8787);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('请填写有效的转发服务端口。');
    const environmentLimits = {
      requestWindow: 'IMAGE_RELAY_REQUEST_WINDOW', requestsPerWindow: 'IMAGE_RELAY_REQUEST_LIMIT',
      concurrentUploads: 'IMAGE_RELAY_CONCURRENT_LIMIT', quotaWindow: 'IMAGE_RELAY_QUOTA_WINDOW',
      bytesPerAddress: 'IMAGE_RELAY_ADDRESS_BYTES', totalBytesPerWindow: 'IMAGE_RELAY_TOTAL_BYTES',
    };
    const limits = {};
    for (const [name, variable] of Object.entries(environmentLimits)) {
      if (process.env[variable] !== undefined) limits[name] = Number(process.env[variable]);
    }
    const trustedProxies = (process.env.IMAGE_RELAY_TRUSTED_PROXIES || '').split(',').map(value => value.trim()).filter(Boolean);
    const server = createRelay({ origin: process.env.EDITOR_ORIGIN, limits, trustedProxies });
    server.on('error', error => {
      console.error('转发服务启动失败。' + error.message);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      console.log('图片上传转发服务已启动。http://127.0.0.1:' + port + '/freeimage');
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
