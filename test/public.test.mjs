import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ serial: 0, crypto: { randomUUID: () => 'station-' + (++context.serial) } });
for (const file of ['core', 'platform/reference', 'platform/vertical-reference', 'platform/state', 'platform/route', 'platform/hanging', 'platform/vertical', 'platform/render']) {
  vm.runInContext(readFileSync(new URL('../js/' + file + '.js', import.meta.url), 'utf8'), context);
}
const S = context.PlatformState, R = context.PlatformRender;
const measure = (text, family, weight, size) => String(text).length * size * .9;
measure.ink = (text, family, weight, size) => ({ abl: 0, abr: measure(text, family, weight, size), adv: measure(text, family, weight, size) });
measure.ascent = (text, family, weight, size) => size * .8;
measure.descent = (text, family, weight, size) => size * .2;

test('fresh projects start with one editable station and supported city palettes', () => {
  assert.equal(S.create().stations.length, 1);
  assert.equal(S.create().stations[0].zh, '新站点');
  assert.equal(JSON.stringify(Array.from(context.SignCore.PALETTE_CITY_ORDER)), JSON.stringify(['shanghai', 'chongqing', 'chengdu']));
});
test('editing and project round trips preserve immutable state', () => {
  const original = S.create(), before = S.serialize(original);
  const edited = S.patchStation(original, original.currentId, { zh: '站点 A', en: 'Station A' });
  assert.equal(S.serialize(original), before);
  assert.equal(edited.stations[0].zh, '站点 A');
  assert.equal(S.serialize(S.deserialize(S.serialize(edited))), S.serialize(edited));
});
test('route, station and all vertical variants retain finite preview and export geometry', () => {
  for (const count of [1, 2, 20]) {
    let state = S.create();
    for (let i = 1; i < count; i++) state = S.addStation(state);
    for (const mode of ['route', 'station', 'vertical']) {
      for (const variant of (mode === 'vertical' ? ['left', 'right', 'double'] : ['left'])) {
        const scene = R.metrics(S.settings(state, { mode, verticalVariant: variant }), measure);
        assert(scene.nodes.length);
        assert(Number.isFinite(scene.width) && Number.isFinite(scene.height));
        for (const element of scene.elements) for (const value of Object.values(element.box)) assert(Number.isFinite(value));
      }
    }
  }
});
