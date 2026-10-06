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
test('text transfers round trip and render MiSans Regular in hanging and vertical maps',()=>{
  let state=S.create();state=S.patchStation(state,state.currentId,{transfers:S.parseTransfers('机场线~Airport Line:#0057B8')});
  assert.equal(S.serialize(S.deserialize(S.serialize(state))),S.serialize(state));
  for(const mode of ['route','vertical'])for(const verticalVariant of ['left','right','double']) {
    const scene=R.metrics(S.settings(state,{mode,verticalVariant}),measure);
    assert(scene.nodes.some(n=>n.text==='Airport Line'&&n.attrs['font-family']===context.SignCore.FONT_ZH&&n.attrs['font-weight']===400));
    assert(scene.nodes.some(n=>n.tag==='rect'&&n.attrs['data-role'].endsWith('transfer-text-badge')));
  }
});
test('station codes after 11 retain the reference glyphs and railway icon is self contained',()=>{
  let state=S.create();state=S.addStation(state);state=S.patchStation(state,state.stations[1].id,{code:'12'});
  const scene=R.metrics(S.settings(state,{mode:'vertical'}),measure);
  const codes=scene.nodes.filter(n=>n.attrs['data-role']==='vertical-station-code');assert.equal(codes.length,2);assert(codes.every(n=>n.tag==='path'));
  vm.runInContext(readFileSync(new URL('../js/icons.js',import.meta.url),'utf8'),context);
  const icon=context.SignIcons.ALL.china_railway;assert.equal(icon.name,'中国铁路');assert.match(icon.body,/stroke-width="1pt"/);assert(!icon.body.includes('<image'));
});
