import { createStationProject } from './station-data.mjs';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
for (const file of ['core', 'platform/reference', 'platform/state', 'platform/route', 'platform/hanging', 'platform/render']) (0, eval)(readFileSync(new URL('../js/' + file + '.js', import.meta.url), 'utf8'));
const S = PlatformState, R = PlatformRender;
const measure = (t, f, w, s) => String(t).length * s * .9;
measure.ink = (t, f, w, s) => ({ abl: -s * .05, abr: measure(t, f, w, s) - s * .05 });
measure.ascent = (t, f, w, s) => s * .8;
measure.descent = (t, f, w, s) => s * .1;

test('到达首末站：两侧横条均为灰色直角矩形，前方无站名或终点占位文字', () => {
  for (const height of [192, 256]) for (const direction of [-1, 1]) {
    const base = createStationProject(S), current = direction === -1 ? base.stations[0] : base.stations.at(-1);
    const state = S.setHangingHeight(S.settings(base, { mode: 'station', direction, currentId: current.id }), height);
    const before = S.serialize(state), scene = R.metrics(state, measure);
    const bars = scene.nodes.filter(n => ['passed-line', 'active-line'].includes(n.attrs['data-role']));
    assert.equal(bars.length, 2);
    for (const bar of bars) { assert.equal(bar.tag, 'rect'); assert.equal(bar.attrs.fill, state.muted); }
    assert.equal(bars[0].attrs.y, bars[1].attrs.y);
    assert.equal(bars[0].attrs.height, bars[1].attrs.height);
    assert(Math.abs(bars[0].attrs.width + bars[1].attrs.width - (scene.width - height * .18)) < 1e-7);
    const nextKey = direction === -1 ? 'station:left' : 'station:right';
    assert(!scene.elements.some(e => e.key === nextKey), '前方无站时不应留下命中区');
    assert(!scene.nodes.some(n => n.attrs['data-element-key'] === nextKey), '前方无站时不应绘制文字');
    const previousKey = direction === -1 ? 'station:right' : 'station:left';
    const previous = S.neighbors(state).previous;
    assert.deepEqual(scene.nodes.filter(n => n.attrs['data-element-key'] === previousKey).map(n => n.text), [previous.zh, previous.en]);
    assert(scene.nodes.filter(n => n.attrs['data-element-key'] === previousKey).every(n => n.attrs.fill === state.muted));
    assert.equal(scene.nodes.find(n => n.attrs['data-role'] === 'current-badge').attrs.fill, state.color);
    assert.equal(S.serialize(state), before);
  }
});

test('从首末站出发：保留彩色斜切横条和下一站，缺少上一站时不补始发占位文字', () => {
  for (const direction of [-1, 1]) {
    const base = createStationProject(S), current = direction === -1 ? base.stations.at(-1) : base.stations[0];
    const state = S.settings(base, { mode: 'station', direction, currentId: current.id }), scene = R.metrics(state, measure);
    const active = scene.nodes.find(n => n.attrs['data-role'] === 'active-line');
    assert.equal(active.tag, 'polygon'); assert.equal(active.attrs.fill, state.color);
    const nextKey = direction === -1 ? 'station:left' : 'station:right', previousKey = direction === -1 ? 'station:right' : 'station:left';
    const next = S.neighbors(state).next;
    assert.deepEqual(scene.nodes.filter(n => n.attrs['data-element-key'] === nextKey).map(n => n.text), [next.zh, next.en]);
    assert(!scene.elements.some(e => e.key === previousKey));
    assert(!scene.nodes.some(n => n.attrs['data-element-key'] === previousKey));
  }
});

test('仅一站：两侧灰色直角横条，不生成邻站文字或命中区，提示开关不改变横条', () => {
  const base = createStationProject(S), one = S.replaceStations(base, [base.stations[0]]);
  for (const direction of [-1, 1]) for (const showStationDirection of [true, false]) {
    const state = S.settings(one, { mode: 'station', direction, showStationDirection }), scene = R.metrics(state, measure);
    assert(!scene.elements.some(e => e.kind === 'neighbor'));
    assert(!scene.nodes.some(n => ['station:left', 'station:right'].includes(n.attrs['data-element-key'])));
    for (const bar of scene.nodes.filter(n => ['passed-line', 'active-line'].includes(n.attrs['data-role']))) {
      assert.equal(bar.tag, 'rect'); assert.equal(bar.attrs.fill, state.muted);
    }
    assert.equal(scene.elements.some(e => e.key === 'station:direction'), showStationDirection);
  }
});
