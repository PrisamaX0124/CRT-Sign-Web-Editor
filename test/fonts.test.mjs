import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function harness(extras = {}) {
  const context = { ...extras };
  ['core', 'state', 'render', 'exporters'].forEach(name => runInNewContext(
    readFileSync(new URL('../js/' + name + '.js', import.meta.url), 'utf8'), context));
  return context;
}

test('PNG 拒绝非法倍率及过大像素面，分配资源前报告错误', async () => {
  const E = harness().SignExporters;
  for (const [size, scale] of [
    [{ width: 768, height: 192 }, 3], [{ width: 0, height: 192 }, 1],
    [{ width: NaN, height: 192 }, 1], [{ width: 9000, height: 192 }, 4],
    [{ width: 8192, height: 8192 }, 2],
  ]) await assert.rejects(E.rasterizePNG('<svg/>', size, scale), /PNG 尺寸超出支持范围/);
});

test('普通中英文默认MiSans，编号保留Frutiger，预加载MiSans三个真实字重', () => {
  const { SignCore: C } = harness();
  assert.ok(C.FONT_ZH.startsWith("'MiSans'"));
  assert.ok(C.FONT_EN.startsWith("'MiSans'"));
  assert.ok(C.FONT_NUM.startsWith("'Frutiger'"));
  assert.deepEqual(Array.from(C.FONT_LOAD_SPECS.filter(face => face.css.includes('MiSans')), face => Number(face.css.split(' ')[0])), [400, 600, 700]);
  assert.deepEqual(Array.from(C.FONT_LOAD_SPECS, face => face.key), ['zh400', 'zh600', 'zh700', 'num400']);
  for (const [file, weight] of [['Regular', 400], ['Semibold', 600], ['Bold', 700]]) {
    const font = readFileSync(new URL('../fonts/MiSans-' + file + '.ttf', import.meta.url));
    const count = font.readUInt16BE(4);
    let offset;
    for (let i = 0; i < count; i++) {
      const table = 12 + i * 16;
      if (font.toString('ascii', table, table + 4) === 'OS/2') offset = font.readUInt32BE(table + 8);
    }
    assert.ok(offset, file + ' has an OS/2 table');
    assert.equal(font.readUInt16BE(offset + 4), weight);
  }
});

test('大文本导出内嵌Frutiger，混排保留MiSans回退字体', () => {
  const { SignState: S, SignExporters: E } = harness();
  function fonts(text) {
    const sign = S.createSign();
    return E.collectUsedFonts(S.addElement(sign, sign.rows[0].id, S.createElement('big-number', { text })));
  }
  assert.equal(fonts('A12/3').num400, true);
  assert.equal(fonts('A12/3').zh400, undefined, 'ASCII文本只需Frutiger');
  assert.equal(fonts('站A12').num400, true);
  assert.equal(fonts('站A12').zh400, true, '非ASCII字符保留字体回退');
  assert.deepEqual(Object.keys(fonts('')), []);
});

test('MiSans排版按当前文字实际墨区算基线，字体切换不造成顶端或双语间距漂移', () => {
  const { SignCore: C, SignRender: R } = harness();
  const m = text => text.length * 10;
  m.ink = text => ({ abl: 0, abr: text.length * 9, adv: text.length * 10 });
  m.ascent = (text, family, weight, size) => size * (text === '站' ? 0.78 : 0.71);
  m.descent = (text, family, weight, size) => size * (text === '站' ? 0.06 : 0.19);
  const bi = R.bilingualMetrics('站', 'Ag', 100, m, true);
  assert.ok(Math.abs(bi.zhBase - m.ascent('站', C.FONT_ZH, 700, bi.zhSize) - 100 * R.INK_TOP_LEADING) < 1e-9);
  assert.ok(Math.abs(bi.enBase - m.ascent('Ag', C.FONT_EN, 700, bi.enSize) -
    (bi.zhBase + m.descent('站', C.FONT_ZH, 700, bi.zhSize)) - 100 * R.ZH_EN_GAP) < 1e-9);
});

test('导出从fonts目录按需内嵌MiSans与编号字体，同一文件只请求一次，失败可重试', async () => {
  const requests = [];
  let failOnce = false;
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
      if (failOnce) { failOnce = false; return { ok: false, status: 404 }; }
      return { ok: true, blob: async () => new Blob([url], { type: 'application/octet-stream' }) };
    },
  });
  const S = c.SignState, E = c.SignExporters;
  let sign = S.createSign();
  sign = S.addElement(sign, sign.rows[0].id, S.createElement('bilingual-text', { textZh: '站名', textEn: 'Station', bold: true }));
  const embed = await E.ensureFontData(sign);
  assert.deepEqual(requests, ['fonts/MiSans-Bold.ttf']);
  assert.ok(embed['MiSans-Bold.ttf'].startsWith('data:font/ttf;base64,'));
  const css = E.buildFontCSS(E.collectUsedFonts(sign), embed);
  assert.ok(css.includes("font-family:'MiSans'"));
  assert.ok(css.includes('font-weight:700'));
  assert.equal((css.match(/@font-face/g) || []).length, 1);
  await E.ensureFontData(sign);
  assert.equal(requests.length, 1);
  sign = S.addElement(sign, sign.rows[0].id, S.createElement('exit', { code: 'C' }));
  failOnce = true;
  await assert.rejects(E.ensureFontData(sign));
  await E.ensureFontData(sign);
  assert.equal(requests.filter(url => url === 'fonts/Frutiger-Regular.ttf').length, 2);
  assert.ok(requests.includes('fonts/MiSans-Regular.ttf'));
});

function scriptFontHarness(protocol, failFirst = false) {
  const scripts = [], removed = [], requests = [];
  let context;
  const document = {
    createElement: () => ({ remove() { removed.push(this.src); } }),
    head: {
      appendChild(script) {
        scripts.push(script.src);
        queueMicrotask(() => {
          if (failFirst) { failFirst = false; script.onerror(); return; }
          const file = script.src.split('/').pop().replace(/\.js$/, '');
          context.SignExportFontData = context.SignExportFontData || {};
          context.SignExportFontData[file] = 'data:font/ttf;base64,' + Buffer.from(file).toString('base64');
          script.onload();
        });
      },
    },
  };
  context = harness({
    document, location: { protocol },
    fetch: async url => { requests.push(url); throw new TypeError('Failed to fetch'); },
  });
  const S = context.SignState;
  let sign = S.createSign();
  sign = S.addElement(sign, sign.rows[0].id, S.createElement('bilingual-text', { bold: true }));
  sign = S.addElement(sign, sign.rows[0].id, S.createElement('exit', { code: 'C' }));
  return { context, sign, scripts, removed, requests };
}

test('双击本地index.html时SVG/PNG共用的字体准备不调用file:// fetch，仍内嵌原字体', async () => {
  const { context: c, sign, scripts, removed, requests } = scriptFontHarness('file:');
  const [first, second] = await Promise.all([c.SignExporters.ensureFontData(sign), c.SignExporters.ensureFontData(sign)]);
  assert.deepEqual(requests, [], '本地文件不能走fetch');
  assert.equal(scripts.length, 3, 'MiSans两种字重与Frutiger各只加载一次');
  assert.deepEqual(removed, scripts, '加载完成清理脚本节点');
  for (const file of ['MiSans-Regular.ttf', 'MiSans-Bold.ttf', 'Frutiger-Regular.ttf']) {
    assert.equal(first[file], 'data:font/ttf;base64,' + Buffer.from(file).toString('base64'));
    assert.equal(second[file], first[file]);
  }
  const css = c.SignExporters.buildFontCSS(c.SignExporters.collectUsedFonts(sign), first);
  assert.equal((css.match(/@font-face/g) || []).length, 3);
});

test('字体fetch被拦截时使用脚本内嵌数据，加载失败清理缓存后允许重试', async () => {
  const { context: c, sign, scripts, removed, requests } = scriptFontHarness('https:', true);
  await assert.rejects(c.SignExporters.ensureFontData(sign), /字体加载失败.*MiSans-Bold/);
  const embed = await c.SignExporters.ensureFontData(sign);
  assert.ok(embed['MiSans-Bold.ttf']);
  assert.equal(scripts.filter(src => src.endsWith('MiSans-Bold.ttf.js')).length, 2);
  assert.equal(requests.filter(src => src.endsWith('MiSans-Bold.ttf')).length, 2);
  assert.equal(removed.length, scripts.length);
});

test('本地导出的生成字体数据与MiSans/Frutiger原始TTF逐字节一致', () => {
  const source = new URL('../fonts/', import.meta.url);
  for (const file of readdirSync(source).filter(file => /^(MiSans|Frutiger).*\.ttf$/.test(file))) {
    const context = {};
    runInNewContext(readFileSync(new URL('../fonts-export/' + file + '.js', import.meta.url), 'utf8'), context);
    const data = context.SignExportFontData[file];
    assert.ok(data.startsWith('data:font/ttf;base64,'));
    assert.deepEqual(Buffer.from(data.split(',')[1], 'base64'), readFileSync(new URL(file, source)), file);
  }
});
