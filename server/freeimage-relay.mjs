import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const uploadTarget = 'https://freeimage.host/api/1/upload';
const maximumImageSize = 64 * 1024 * 1024;
const maximumFormSize = maximumImageSize + 16 * 1024;

function reply(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function readForm(request, response) {
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

async function forwardUpload(form, response, fetchUpload) {
  try {
    const upstream = await fetchUpload(uploadTarget, {
      method: 'POST',
      body: form,
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
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

export function createRelay({ origin, fetchUpload = fetch }) {
  if (!/^https?:\/\/[^/]+$/i.test(origin ?? '') || URL.parse(origin)?.origin !== origin) {
    throw new Error('请将 EDITOR_ORIGIN 设为编辑器网址中的协议、域名和端口。');
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
    try {
      const form = await readForm(request, response);
      if (!form) return;
      const status = formError(form);
      if (status) {
        reply(response, status, { message: status === 413 ? '图片过大。' : '请填写密钥并提供 PNG 图片。' });
        return;
      }
      await forwardUpload(form, response, fetchUpload);
    } catch {
      if (!response.headersSent) reply(response, 400, { message: '未能接收图片。' });
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const port = Number(process.env.IMAGE_RELAY_PORT || 8787);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('请填写有效的转发服务端口。');
    const server = createRelay({ origin: process.env.EDITOR_ORIGIN });
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
