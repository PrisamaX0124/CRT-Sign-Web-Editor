import { readFileSync, statSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function createMemoryCache() {
  const store = new Map();
  return {
    store,
    caches: {
      async open() {
        return {
          async match(key) {
            const url = typeof key === 'string' ? key : key.url;
            const entry = store.get(url);
            return entry ? entry.clone() : undefined;
          },
          async put(key, response) {
            const url = typeof key === 'string' ? key : key.url;
            store.set(url, response.clone());
          },
          async keys() {
            return Array.from(store.keys(), url => ({ url }));
          },
          async delete(key) {
            const url = typeof key === 'string' ? key : key.url;
            return store.delete(url);
          },
        };
      },
      async delete() {
        store.clear();
        return true;
      },
    },
  };
}

function makeResponse(bytes, status = 200, contentType = 'font/woff2') {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => (name.toLowerCase() === 'content-type' ? contentType : null) },
    clone() { return makeResponse(data, status, contentType); },
    async arrayBuffer() { return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); },
    async blob() { return new Blob([data], { type: contentType }); },
  };
}

function harness(extras = {}) {
  const context = {
    Blob,
    Uint8Array,
    DataView,
    ArrayBuffer,
    TextDecoder,
    URL,
    setTimeout,
    clearTimeout,
    ...extras,
  };
  const files = [
    '../fonts-subsets/manifest.js',
    '../js/core.js',
    '../js/font-manager.js',
    '../js/state.js',
    '../js/render.js',
    '../js/exporters.js',
  ];
  for (const file of files) {
    runInNewContext(readFileSync(new URL(file, import.meta.url), 'utf8'), context);
  }
  return context;
}

test('fonts.css 使用 WOFF2 分片声明 MiSans，首屏核心分片小于 100KB', () => {
  const css = readFileSync(new URL('../fonts.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /fonts\/MiSans-.*\.ttf/, '网页预览不应再直接加载整包 MiSans TTF');
  assert.match(css, /fonts-subsets\/MiSans-Regular\/00\.woff2/, '应引用 MiSans WOFF2 分片');
  assert.match(css, /unicode-range:/, '分片声明应包含 unicode-range');

  for (const dir of ['MiSans-Regular', 'MiSans-Semibold', 'MiSans-Bold']) {
    const corePath = new URL(`../fonts-subsets/${dir}/00.woff2`, import.meta.url);
    const bytes = readFileSync(corePath);
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'wOF2', `${dir}/00.woff2 必须是真 WOFF2`);
    assert.ok(statSync(corePath).size < 100 * 1024, `${dir}/00.woff2 应小于 100KB`);
  }
});

test('分片清单按字符精准定位少量分片，默认站名只命中核心包，生僻字按需命中对应分片', () => {
  const { SignFontManager: M } = harness();
  const common = M.resolveChunks('MiSans-Regular.ttf', '人民广场 Station 0123456789 换乘');
  assert.equal(common.length, 1, '常见站名与英文应只命中 1 个核心分片');
  assert.equal(common[0].file, '00.woff2');

  const rare = M.resolveChunks('MiSans-Regular.ttf', '人民广场 龘');
  assert.equal(rare.length, 2, '加入生僻字应只多拉取 1 个对应分片');
  assert.equal(rare[0].file, '00.woff2');
  assert.notEqual(rare[1].file, '00.woff2');
});

test('按需预加载只请求当前项目用到的字重，不阻塞下载无关字重', () => {
  const { SignState: S, SignFontManager: M } = harness();
  let sign = S.createSign();
  sign = S.addElement(sign, sign.rows[0].id, S.createElement('bilingual-text', { textZh: '人民广场', textEn: 'Station', bold: false }));
  const regularSpecs = M.specsForUsedFonts({ zh400: true, num400: true });
  assert.deepEqual(Array.from(regularSpecs, s => s.key), ['zh400', 'num400']);

  const withBold = M.specsForUsedFonts({ zh400: true, zh700: true, num400: true });
  assert.deepEqual(Array.from(withBold, s => s.key), ['zh400', 'zh700', 'num400']);
});

test('导出按当前牌面字符只拉取命中的 WOFF2 分片，并写入 CacheStorage 避免重复请求', async () => {
  const requests = [];
  const mem = createMemoryCache();
  class Reader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(data => {
        this.result = 'data:' + blob.type + ';base64,' + Buffer.from(data).toString('base64');
        this.onload();
      });
    }
  }
  const c = harness({
    FileReader: Reader,
    caches: mem.caches,
    fetch: async url => {
      requests.push(url);
      return makeResponse('mock-font:' + url, 200, url.endsWith('.woff2') ? 'font/woff2' : 'font/ttf');
    },
  });
  const S = c.SignState, E = c.SignExporters;
  let sign = S.createSign();
  sign = S.addElement(sign, sign.rows[0].id, S.createElement('bilingual-text', { textZh: '人民广场', textEn: 'Station', bold: true }));
  sign = S.addElement(sign, sign.rows[0].id, S.createElement('exit', { code: 'C' }));

  const embed = await E.ensureFontData(sign);
  assert.ok(requests.every(url => !url.includes('fonts/MiSans-')), 'HTTP 导出不应再拉取 7.5MB 完整 MiSans TTF：' + requests.join(', '));
  assert.ok(requests.includes('fonts-subsets/MiSans-Regular/00.woff2'));
  assert.ok(requests.includes('fonts-subsets/MiSans-Bold/00.woff2'));
  assert.ok(requests.includes('fonts/Frutiger-Regular.ttf'));

  const css = E.buildFontCSS(E.collectUsedFonts(sign), embed);
  assert.match(css, /data:font\/woff2;base64,/);
  assert.match(css, /unicode-range:/);
  assert.match(css, /font-weight:700/);
  assert.match(css, /font-family:Frutiger/);

  // 第二个上下文共用同一持久缓存（模拟刷新页面后再次导出）：0 次网络请求
  const secondRequests = [];
  const c2 = harness({
    FileReader: Reader,
    caches: mem.caches,
    fetch: async url => {
      secondRequests.push(url);
      return makeResponse('should-not-fetch');
    },
  });
  const embed2 = await c2.SignExporters.ensureFontData(sign);
  assert.deepEqual(secondRequests, [], '命中持久缓存后不应再发起网络请求');
  assert.ok(embed2['MiSans-Bold.ttf']);
});

test('弱网抖动时字体请求自动重试；404 错误不盲目重试', async () => {
  const counts = {};
  const mem = createMemoryCache();
  const { SignFontManager: M } = harness({
    caches: mem.caches,
    fetch: async url => {
      counts[url] = (counts[url] || 0) + 1;
      if (url.includes('flaky') && counts[url] < 3) throw new TypeError('network reset');
      if (url.includes('missing')) return makeResponse('', 404);
      return makeResponse('ok-bytes', 200, 'font/woff2');
    },
  });

  const blob = await M.fetchFontBlob('fonts-subsets/MiSans-Regular/flaky.woff2', { retries: 3, retryDelayMs: 5 });
  assert.equal(counts['fonts-subsets/MiSans-Regular/flaky.woff2'], 3, '网络重置应重试直到成功');
  assert.equal(await blob.text(), 'ok-bytes');

  await assert.rejects(
    M.fetchFontBlob('fonts-subsets/MiSans-Regular/missing.woff2', { retries: 3, retryDelayMs: 5 }),
    /404|失败/,
  );
  assert.equal(counts['fonts-subsets/MiSans-Regular/missing.woff2'], 1, '404 不应重复重试');
});

test('离线本机字体校验与槽位识别：自动识别字重、拒绝损坏文件，导出优先使用离线字体且零请求', async () => {
  const regularBytes = readFileSync(new URL('../fonts/MiSans-Regular.ttf', import.meta.url));
  const boldBytes = readFileSync(new URL('../fonts/MiSans-Bold.ttf', import.meta.url));
  const frutigerBytes = readFileSync(new URL('../fonts/Frutiger-Regular.ttf', import.meta.url));
  const localStore = new Map();
  const requests = [];
  class Reader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(data => {
        this.result = 'data:' + blob.type + ';base64,' + Buffer.from(data).toString('base64');
        this.onload();
      });
    }
  }
  const c = harness({
    FileReader: Reader,
    fetch: async url => {
      requests.push(url);
      return makeResponse('net:' + url, 200, 'font/ttf');
    },
  });
  const M = c.SignFontManager;
  const E = c.SignExporters;
  const S = c.SignState;

  assert.equal(M.identifyFontSlot('MiSans-Regular.ttf', regularBytes), 'zh400');
  assert.equal(M.identifyFontSlot('任意名字.ttf', boldBytes), 'zh700');
  assert.equal(M.identifyFontSlot('Frutiger-Regular.ttf', frutigerBytes), 'num400');
  assert.equal(M.validateFontBuffer(Buffer.from('not-a-font-file')).valid, false);
  assert.equal(M.validateFontBuffer(regularBytes).mime, 'font/ttf');

  // 注入内存态离线存储，模拟已导入本机 MiSans 常规与粗体
  M.setMemoryLocalFont('zh400', { buffer: regularBytes, mime: 'font/ttf', format: 'truetype', name: 'MiSans-Regular.ttf' });
  M.setMemoryLocalFont('zh700', { buffer: boldBytes, mime: 'font/ttf', format: 'truetype', name: 'MiSans-Bold.ttf' });
  localStore.set('zh400', true);

  let sign = S.createSign();
  sign = S.addElement(sign, sign.rows[0].id, S.createElement('bilingual-text', { textZh: '人民广场', textEn: 'Station', bold: true }));
  const embed = await E.ensureFontData(sign);
  assert.deepEqual(requests, [], '本机已导入对应字体时，导出不应发起任何网络请求');
  const css = E.buildFontCSS(E.collectUsedFonts(sign), embed);
  assert.match(css, /data:font\/ttf;base64,/);
  assert.match(css, /font-weight:700/);
});
