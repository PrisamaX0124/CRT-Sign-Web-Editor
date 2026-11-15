import { createStationProject } from './station-data.mjs';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

function runtime() {
  const context = vm.createContext({});
  for (const path of ['core', 'platform/state']) vm.runInContext(readFileSync(new URL('../js/' + path + '.js', import.meta.url), 'utf8'), context);
  return context.PlatformState;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('站台多选删除：整组一次删除，本站选择相邻站，至少保留一站且不改旧状态', () => {
  const S = runtime(), state = createStationProject(S), before = JSON.stringify(state);
  const ids = state.stations.slice(3, 6).map(s => s.id);
  const next = S.removeStations(state, ids);
  assert.equal(next.stations.length, 5);
  assert.equal(next.currentId, state.stations[6].id);
  assert.equal(JSON.stringify(state), before);
  assert.equal(S.removeStations(state, ['missing']), state);
  const all = S.removeStations(state, state.stations.map(s => s.id));
  assert.equal(all.stations.length, 1);
  assert.equal(all.currentId, all.stations[0].id);
});

test('站台剪贴板：按站序复制完整内容，粘贴生成独立id与换乘副本，保留各版式微调', () => {
  const S = runtime();
  let state = createStationProject(S), ids = [state.stations[1].id, state.stations[3].id];
  state = S.setElementOffset(state, 'route:' + ids[0], { x: 7, y: -3 });
  state = S.setElementOffset(state, 'vertical:left:' + ids[0], { x: -5, y: 4 });
  const data = S.deserializeStations(S.serializeStations(state, ids.slice().reverse()));
  assert.equal(data.stations[0].station.zh, state.stations[1].zh);
  const before = JSON.stringify(state), next = S.pasteStations(state, data, 2);
  assert.equal(next.stations.length, 10);
  const added = next.stations.slice(2, 4);
  assert.equal(added[0].zh, state.stations[1].zh);
  assert.ok(added.every(s => !state.stations.some(old => old.id === s.id)));
  assert.deepEqual(plain(next.adjustments['route:' + added[0].id]), { x: 7, y: -3 });
  assert.deepEqual(plain(next.adjustments['vertical:left:' + added[0].id]), { x: -5, y: 4 });
  assert.equal(next.currentId, state.currentId);
  added[0].transfers[0].color = '#000000';
  assert.equal(JSON.stringify(state), before);
  assert.notEqual(data.stations[0].station.transfers[0].color, '#000000');
  const twice = S.pasteStations(next, data, 4);
  assert.notEqual(twice.stations[2].id, twice.stations[4].id);
});

test('站台剪贴板：拒绝其他格式、空数组、超限内容，校验外来颜色/微调/站名', () => {
  const S = runtime();
  for (const data of ['text', '{}', { kind: 'jr-sign-elements', version: 1 },
    { kind: 'platform-sign-stations', version: 2, stations: [{}] },
    { kind: 'platform-sign-stations', version: 1, stations: [] },
    { kind: 'platform-sign-stations', version: 1, stations: Array(121).fill({}) }]) {
    assert.throws(() => S.deserializeStations(data));
  }
  const data = S.deserializeStations({ kind: 'platform-sign-stations', version: 1, stations: [
    { station: { zh: 'Test', transfers: [{ number: '2', color: 'invalid' }] }, offsets: { route: { x: 999, y: 'x' }, invalid: { x: 10 } } }
  ] });
  assert.match(data.stations[0].station.transfers[0].color, /^#[\dA-F]{6}$/);
  assert.deepEqual(plain(data.stations[0].offsets), { route: { x: 128, y: 0 } });
  const state = createStationProject(S), full = S.replaceStations(state, Array.from({ length: 120 }, (_, i) => ({ id: 's' + i, zh: 'Test' })));
  assert.throws(() => S.pasteStations(full, data, 0), /120/);
});

test('站台多元素微调与复位均为一次纯更新，忽略无效元素并限制偏移', () => {
  const S = runtime(), state = createStationProject(S), id = state.currentId, keys = ['route:' + id, 'station:direction'];
  const moved = S.nudgeElements(state, keys.concat('invalid'), 10, -4);
  keys.forEach(key => assert.deepEqual(plain(moved.adjustments[key]), { x: 10, y: -4 }));
  assert.equal(moved.adjustments.invalid, undefined);
  assert.deepEqual(plain(state.adjustments), {});
  const capped = S.nudgeElements(moved, keys, 200, -200);
  keys.forEach(key => assert.deepEqual(plain(capped.adjustments[key]), { x: 128, y: -128 }));
  assert.deepEqual(plain(S.resetElements(capped, keys).adjustments), {});
});
