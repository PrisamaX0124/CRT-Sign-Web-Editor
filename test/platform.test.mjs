import { createStationProject } from './station-data.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = (path) => (0, eval)(readFileSync(new URL(path, import.meta.url), 'utf8'));
load('../js/core.js');
for (const path of ['../js/platform/reference.js', '../js/platform/state.js', '../js/platform/route.js', '../js/platform/hanging.js', '../js/platform/vertical-reference.js', '../js/platform/vertical.js', '../js/platform/render.js']) {
  if (existsSync(new URL(path, import.meta.url))) load(path);
}
const measure = (text, family, weight, size) => String(text).length * size * 0.9;
measure.ascent = (text, family, weight, size) => size * 0.8;
measure.descent = (text, family, weight, size) => size * 0.1;
measure.ink = (text, family, weight, size) => ({ abl: -size * 0.05, abr: measure(text, family, weight, size) - size * 0.05, adv: measure(text, family, weight, size) });

test('站台页：同一份站点数据生成三种版式，本站与换乘均保留', () => {
  assert.ok(globalThis.PlatformState, '独立站台状态模块应存在');
  const state = createStationProject(PlatformState);
  for (const mode of ['route', 'station', 'vertical']) {
    const next = PlatformState.settings(state, { mode });
    const scene = PlatformRender.metrics(next, measure);
    assert.ok(scene.width > 0 && scene.height > 0);
    assert.ok(scene.nodes.some(n => n.text === state.stations[4].zh), mode + ' 显示本站');
    assert.ok(scene.nodes.some(n => n.text === '10' || n.label === '10'), mode + ' 显示线路号');
    if (mode !== 'station') assert.equal(scene.stationIds.length, state.stations.length);
  }
});

test('站台导出只收集当前版式实际使用的字体，编号中文保留回退字体', () => {
  const state = createStationProject(PlatformState);
  const route = PlatformRender.metrics(state, measure);
  assert.deepEqual(route.usedFonts, { num400: true, zh400: true, zh600: true });
  const station = PlatformRender.metrics(PlatformState.settings(state, { mode: 'station' }), measure);
  assert.ok(station.usedFonts.zh400 && !station.usedFonts.zh600 && !station.usedFonts.zh700);
  const vertical = PlatformRender.metrics(PlatformState.settings(state, { mode: 'vertical' }), measure);
  assert.ok(vertical.usedFonts.zh600 && !vertical.usedFonts.zh700);
});

test('站台状态：编辑、调序、删除不可变，本站按 id 跟随站点', () => {
  const S = globalThis.PlatformState;
  assert.ok(S);
  const state = createStationProject(S), before = JSON.stringify(state), id = state.currentId;
  const changed = S.patchStation(state, id, { zh: '新站名' });
  assert.equal(JSON.stringify(state), before);
  const moved = S.moveStation(changed, id, -1);
  assert.equal(moved.currentId, id);
  assert.equal(moved.stations[3].zh, '新站名');
  const removed = S.removeStation(moved, id);
  assert.ok(removed.stations.some(s => s.id === removed.currentId));
  let one = removed;
  while (one.stations.length > 1) one = S.removeStation(one, one.stations[0].id);
  assert.equal(S.removeStation(one, one.stations[0].id), one, '至少保留一站');
});

test('行车方向：两端终点不产生不存在的邻站，反向准确交换前后站', () => {
  const S = globalThis.PlatformState;
  assert.ok(S);
  const state = createStationProject(S);
  const a = S.neighbors(S.settings(state, { direction: 1 }));
  const b = S.neighbors(S.settings(state, { direction: -1 }));
  assert.equal(a.next.id, b.previous.id);
  assert.equal(a.previous.id, b.next.id);
  const end = S.settings(state, { currentId: state.stations[0].id, direction: -1 });
  assert.equal(S.neighbors(end).next, null);
  const scene = PlatformRender.metrics(S.settings(end, { mode: 'station' }), measure);
  assert.ok(!scene.nodes.some(n => n.attrs['data-element-key'] === 'station:left'));
});

test('项目导入：校验外部数据、重复 id、尺寸、换乘；往返不丢信息', () => {
  const S = globalThis.PlatformState;
  assert.ok(S);
  const state = createStationProject(S);
  assert.deepEqual(S.deserialize(S.serialize(state)), state);
  assert.throws(() => S.deserialize('{"stations":[]}'));
  assert.throws(() => S.deserialize('{"kind":"other","stations":[{}]}'));
  const malformed = JSON.parse(S.serialize(state));
  malformed.color = 'url(https://evil.invalid)';
  malformed.sizes.route.width = -1;
  malformed.stations[1].id = malformed.stations[0].id;
  malformed.stations[0].transfers = [{ number: '99', color: 'no' }, null];
  const result = S.deserialize(JSON.stringify(malformed));
  assert.match(result.color, /^#[0-9A-F]{6}$/);
  assert.ok(result.sizes.route.width >= 128);
  assert.equal(new Set(result.stations.map(s => s.id)).size, result.stations.length);
  assert.equal(result.stations[0].transfers.length, 1);
});

test('批量站点：支持编号与自定义换乘色，空白/非法记录明确报错', () => {
  const S = globalThis.PlatformState;
  assert.ok(S);
  const list = S.parseStations('01|江南站|South River|1,5:#123456\n02|滨江站|Riverside|6', 'chongqing');
  assert.equal(list[0].transfers[1].color, '#123456');
  assert.equal(list[1].transfers[0].color, SignCore.lineColorFor('6', 'chongqing').bg);
  assert.throws(() => S.parseStations('  ', 'chongqing'));
  assert.throws(() => S.parseStations('01||Empty', 'chongqing'));
});

test('横向长线路/竖版多换乘：文字按墨区拟合，布局尺寸有界且无 NaN', () => {
  const S = globalThis.PlatformState;
  assert.ok(S);
  let state = createStationProject(S);
  const stations = Array.from({ length: 50 }, (_, i) => ({ id: 's' + i, code: String(i + 1).padStart(2, '0'), zh: '超长站名测试重庆轨道交通', en: 'Very long station name for the platform map', transfers: Array.from({ length: 6 }, (_, j) => ({ number: String(j + 1), color: '#123456' })) }));
  state = S.replaceStations(state, stations);
  for (const mode of ['route', 'station', 'vertical']) {
    const scene = PlatformRender.metrics(S.settings(state, { mode }), measure);
    assert.ok(!JSON.stringify(scene).includes('NaN'));
    scene.nodes.filter(n => n.tag === 'text').forEach(n => {
      assert.ok(n.attrs['font-size'] > 0);
      assert.ok(n.bounds.width <= n.bounds.maxWidth + 0.001, n.text);
    });
  }
});
