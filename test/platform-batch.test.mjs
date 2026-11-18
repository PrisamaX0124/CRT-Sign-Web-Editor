import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const context = vm.createContext({ Blob, TextEncoder, setTimeout, structuredClone, crypto });
const sources = [
  'js/core.js', 'js/palettes.js', 'assets/platform-patterns.js', 'js/platform/patterns.js',
  'js/platform/reference.js', 'js/platform/vertical-reference.js', 'js/platform/state.js',
  'js/platform/route.js', 'js/platform/hanging.js', 'js/platform/vertical.js', 'js/platform/render.js',
  'js/platform/batch.js',
];
for (const source of sources) {
  const filename = fileURLToPath(new URL('../' + source, import.meta.url));
  vm.runInContext(readFileSync(filename, 'utf8'), context, { filename });
}
context.zip = require('../vendor/zip.min.js');
const stateTools = context.PlatformState;
const render = context.PlatformRender;
const batch = context.PlatformBatch;
const measure = (text, family, weight, size) => String(text).length * size * .9;
measure.ink = (text, family, weight, size) => ({ abl: 0, abr: measure(text, family, weight, size) });
measure.ascent = (text, family, weight, size) => size * .8;
measure.descent = (text, family, weight, size) => size * .2;

function project() {
  const state = stateTools.replaceStations(stateTools.create(), [
    { id: 'first', code: '01', zh: '首站', en: 'First' },
    { id: 'middle', code: '05', zh: '上云岭', en: 'Shangyunling', transfers: [{ number: '2', color: '#123456' }] },
    { id: 'last', code: '12', zh: '末站', en: 'Last' },
  ]);
  return stateTools.settings(state, {
    line: '10', lineName: '10号线', direction: -1, currentId: 'middle',
    verticalVariant: 'double', verticalSwapped: true, fontScale: 1.2,
    sizes: { ...state.sizes, station: { width: 650, height: 256 }, vertical: { height: 900 } },
    color: '#123456', background: '#FFEEDA', muted: '#757575',
    linePattern: { enabled: true, source: 'line-10', size: 125, opacity: 65 },
    adjustments: { 'station:title': { x: 12, y: -3 }, 'vertical:left:middle': { x: 2, y: 5 } },
  });
}

test('纵向双列每站只生成一张，逐站反向交换左右列并保留基准方向', () => {
  const state = project();
  const plan = batch.createPlan(state, ['middle', 'last'], 'vertical', 'both');
  assert.equal(plan.results.length, 2);
  const [middle, last] = plan.results;
  const reverse = batch.oppositeResult(plan, middle);
  assert.equal(batch.oppositeResult(plan, last).station.id, last.station.id);
  const sign = batch.stateForResult(plan, reverse);
  assert.equal(sign.direction, state.direction);
  assert.equal(sign.verticalSwapped, !state.verticalSwapped);
  assert.equal(batch.stateForResult(plan, last).verticalSwapped, state.verticalSwapped);
  const columns = result => Array.from(render.metrics(batch.stateForResult(plan, result), measure).columns, column => column.direction);
  assert.deepEqual(columns(reverse), columns(middle).reverse());
  assert.notEqual(reverse.filename, middle.filename);
  assert.match(reverse.filename, /双列/);
});

test('吊板和单列可逐站反向，保留原版式，反向后的同名文件仍可区分', () => {
  const state = { ...project(), verticalVariant: 'right', stations: [
    { id: 'one', code: 'X', zh: '同名' }, { id: 'two', code: 'X', zh: '同名' },
  ] };
  for (const mode of ['station', 'route', 'vertical']) {
    const plan = batch.createPlan(state, ['one', 'two'], mode, 'current');
    const reversed = Array.from(plan.results, result => batch.oppositeResult(plan, result));
    assert.equal(new Set(reversed.map(result => result.filename)).size, 2);
    for (const result of reversed) {
      const sign = batch.stateForResult(plan, result);
      assert.equal(sign.mode, mode);
      assert.equal(sign.direction, -state.direction);
      assert.equal(sign.verticalVariant, 'right');
    }
    const both = batch.createPlan(state, ['one'], mode, 'both');
    assert.equal(batch.oppositeResult(both, both.results[0]), undefined);
  }
});

test('所选站点按原站序排列，当前方向和反向的数量正确', () => {
  const state = project();
  for (const [choice, directions] of [['current', [-1]], ['reverse', [1]], ['both', [-1, 1]]]) {
    const plan = batch.createPlan(state, ['last', 'first', 'last', 'missing'], 'station', choice);
    assert.deepEqual(Array.from(plan.results, result => [result.station.id, result.direction]),
      ['first', 'last'].flatMap(station => directions.map(direction => [station, direction])));
    assert.deepEqual(Array.from(plan.project.stations, station => station.id), ['first', 'middle', 'last']);
  }
  assert.equal(batch.createPlan(state, [], 'station', 'both').results.length, 0);
});

test('三种版式的排版与逐张编辑一致，快照保留首末站、换乘、颜色、底纹、字号及微调', () => {
  const state = project();
  for (const mode of ['route', 'station', 'vertical']) {
    const plan = batch.createPlan(state, state.stations.map(station => station.id), mode, 'both');
    assert.equal(plan.results.length, mode === 'vertical' ? 3 : 6);
    for (const result of plan.results) {
      const sign = batch.stateForResult(plan, result);
      const ordinary = stateTools.settings(state, { mode, currentId: result.station.id, direction: result.direction });
      assert.deepEqual(JSON.parse(JSON.stringify(sign)), JSON.parse(JSON.stringify(ordinary)));
      const scene = render.metrics(sign, measure);
      assert.equal(JSON.stringify(scene), JSON.stringify(render.metrics(ordinary, measure)));
      assert.equal(scene.background, '#FFEEDA');
      if (scene.patterns) assert.equal(scene.patterns.design.name, '10号线');
      if (mode === 'vertical' || result.station.id === 'middle') assert.ok(scene.patterns);
      const neighbors = stateTools.neighbors(sign);
      const stationIndex = state.stations.findIndex(station => station.id === result.station.id);
      assert.equal(neighbors.next?.id, state.stations[stationIndex + result.direction]?.id);
      assert.equal(neighbors.previous?.id, state.stations[stationIndex - result.direction]?.id);
      if (mode === 'vertical') assert.deepEqual(Array.from(scene.columns, column => column.direction), [-result.direction, result.direction]);
    }
  }
  const plan = batch.createPlan(state, ['middle'], 'route', 'current');
  state.stations[1].transfers[0].color = '#000000';
  assert.equal(plan.results[0].station.transfers[0].color, '#123456');
  assert.equal(state.currentId, 'middle');
  assert.equal(state.direction, -1);
  assert.equal(state.mode, 'route');
});

test('只有一个站点时两种方向均可生成，纵向单列保留左右版式', () => {
  const state = stateTools.create();
  for (const verticalVariant of ['left', 'right']) {
    const plannedState = stateTools.settings(state, { verticalVariant });
    for (const mode of ['route', 'station', 'vertical']) {
      const plan = batch.createPlan(plannedState, [state.currentId], mode, 'both');
      assert.equal(plan.results.length, 2);
      for (const result of plan.results) {
        const sign = batch.stateForResult(plan, result);
        assert.equal(stateTools.neighbors(sign).next, null);
        assert.equal(stateTools.neighbors(sign).previous, null);
        const scene = render.metrics(sign, measure);
        assert.ok(scene.nodes.length);
        if (mode === 'vertical') assert.equal(scene.columns[0].side, verticalVariant);
      }
    }
  }
});

test('文件名包含线路和站点资料，处理非法字符、空名称、长名称和重名', () => {
  const standard = batch.createPlan(project(), ['middle'], 'station', 'both');
  assert.deepEqual(Array.from(standard.results, result => result.filename),
    ['10号线_05_上云岭_本站吊板_反向', '10号线_05_上云岭_本站吊板_正向']);
  const state = { ...project(), line: 'CON.机场/线', stations: [
    { id: 'one', code: '...', zh: '同/名' },
    { id: 'two', code: ' ', zh: '同\\名' },
    { id: 'three', code: '123', zh: '🌐'.repeat(40) },
    { id: 'four', code: '456', zh: '', en: 'Airport' },
    { id: 'five', code: '789', zh: '' },
  ] };
  const plan = batch.createPlan(state, state.stations.map(station => station.id), 'vertical', 'current');
  const names = Array.from(plan.results, result => result.filename);
  assert.deepEqual(names.slice(0, 2), [
    '_CON.机场_线_无编号_同_名_纵向线路图_双列_左往末站_右往首站',
    '_CON.机场_线_无编号_同_名_纵向线路图_双列_左往末站_右往首站_2',
  ]);
  assert.match(names[2], /^_CON\.机场_线_123_🌐+.*_纵向线路图_双列_左往末站_右往首站$/u);
  assert.ok(Buffer.byteLength(names[2] + '.svg') <= 255);
  assert.match(names[3], /Airport/);
  assert.match(names[4], /未命名站点/);
  assert.equal(new Set(names).size, 5);
  assert.match(batch.createPlan({ ...state, line: '', lineName: '机场线' }, [], 'route', 'current').filename, /^机场线_/);
  assert.match(batch.createPlan({ ...state, line: '', lineName: '' }, [], 'route', 'current').filename, /^未命名线路_/);
});

async function readArchive(archive) {
  const bytes = Buffer.from(await archive.arrayBuffer());
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, '缺少压缩包目录');
  const files = new Map();
  let record = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    assert.equal(bytes.readUInt32LE(record), 0x02014b50);
    const nameLength = bytes.readUInt16LE(record + 28);
    const name = bytes.toString('utf8', record + 46, record + 46 + nameLength);
    const file = bytes.readUInt32LE(record + 42);
    assert.equal(bytes.readUInt32LE(file), 0x04034b50);
    const start = file + 30 + bytes.readUInt16LE(file + 26) + bytes.readUInt16LE(file + 28);
    const data = bytes.subarray(start, start + bytes.readUInt32LE(record + 20));
    const method = bytes.readUInt16LE(record + 10);
    files.set(name, method === 8 ? inflateRawSync(data).toString() : data.toString());
    record += 46 + nameLength + bytes.readUInt16LE(record + 30) + bytes.readUInt16LE(record + 32);
  }
  return files;
}

test('本地打包支持单格式和双格式，只处理所选结果并传入正确图片倍率', async () => {
  const plan = batch.createPlan(project(), ['middle'], 'station', 'both');
  const result = plan.results[1];
  for (const formats of [{ svg: true }, { png: true, scale: 2 }, { svg: true, png: true, scale: 4 }]) {
    const calls = [];
    context.PlatformExport = {
      async prepare(state) {
        calls.push(state.direction);
        return { source: '<svg>上云岭</svg>', drawing: '<svg>上云岭</svg>', size: state.sizes.station };
      },
      async pngBlob(drawing, size, scale) {
        assert.equal(size.width, 650);
        assert.equal(scale, formats.scale);
        return new Blob([drawing, scale]);
      },
    };
    const progress = [];
    const archive = await batch.buildArchive(plan, [result], formats, new AbortController().signal,
      (done, total) => progress.push([done, total]));
    assert.equal(archive.type, 'application/zip');
    const files = await readArchive(archive);
    const expected = [];
    if (formats.svg) expected.push([result.filename + '.svg', '<svg>上云岭</svg>']);
    if (formats.png) expected.push([result.filename + '.png', '<svg>上云岭</svg>' + formats.scale]);
    assert.deepEqual([...files].sort(), expected.sort());
    assert.deepEqual(calls, [1]);
    assert.deepEqual(progress, [[0, expected.length], ...expected.map((entry, index) => [index + 1, expected.length])]);
  }
});

test('打包取消后停止处理后续标识牌，导出失败后可再次打包', async () => {
  const plan = batch.createPlan(project(), ['first', 'last'], 'station', 'both');
  const abort = new AbortController();
  let prepared = 0;
  context.PlatformExport = {
    async prepare() {
      prepared++;
      abort.abort();
      return { source: '<svg/>' };
    },
  };
  await assert.rejects(batch.buildArchive(plan, plan.results, { svg: true }, abort.signal, () => {}), { name: 'AbortError' });
  assert.equal(prepared, 1);
  context.PlatformExport.prepare = async () => { throw new Error('字体读取失败'); };
  await assert.rejects(batch.buildArchive(plan, plan.results, { svg: true }, new AbortController().signal, () => {}), /字体读取失败/);
  context.PlatformExport.prepare = async () => ({ source: '<svg/>' });
  assert.equal((await readArchive(await batch.buildArchive(plan, plan.results, { svg: true },
    new AbortController().signal, () => {}))).size, 4);
});
