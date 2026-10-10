import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ serial: 0, crypto: { randomUUID: () => 'station-' + (++context.serial) } });
for (const file of ['core', 'palettes', 'platform/reference', 'platform/vertical-reference', 'platform/state', 'platform/route', 'platform/hanging', 'platform/vertical', 'platform/render']) {
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
  assert.equal(JSON.stringify(Array.from(context.SignCore.PALETTE_CITY_ORDER)), JSON.stringify(['shanghai', 'chongqing', 'chengdu', 'beijing']));
});
test('editing and project round trips preserve immutable state', () => {
  const original = S.create(), before = S.serialize(original);
  const edited = S.patchStation(original, original.currentId, { zh: '站点 A', en: 'Station A' });
  assert.equal(S.serialize(original), before);
  assert.equal(edited.stations[0].zh, '站点 A');
  assert.equal(S.serialize(S.deserialize(S.serialize(edited))), S.serialize(edited));
});

test('terminal hanging signs have flat grey bars and no missing-neighbor captions; departures retain the next station', () => {
  let base = S.create();
  base = S.addStation(base, base.currentId);
  for (const height of [192, 256]) for (const direction of [-1, 1]) for (const arriving of [true, false]) {
    const index = (direction === -1) === arriving ? 0 : 1;
    const state = S.setHangingHeight(S.settings(base, { mode: 'station', direction, currentId: base.stations[index].id }), height);
    const scene = R.metrics(state, measure), next = S.neighbors(state).next;
    const active = scene.nodes.find(n => n.attrs['data-role'] === 'active-line');
    assert.equal(active.tag, arriving ? 'rect' : 'polygon');
    assert.equal(active.attrs.fill, arriving ? state.muted : state.color);
    for (const [key, neighbor] of [['station:left', direction === -1 ? next : S.neighbors(state).previous], ['station:right', direction === 1 ? next : S.neighbors(state).previous]]) {
      assert.equal(scene.elements.some(e => e.key === key), !!neighbor);
      assert.equal(scene.nodes.filter(n => n.attrs['data-element-key'] === key).map(n => n.text).join('|'), neighbor ? neighbor.zh + '|' + neighbor.en : '');
    }
  }
  const single = S.settings(S.create(), { mode: 'station' }), scene = R.metrics(single, measure);
  assert(!scene.elements.some(e => e.kind === 'neighbor'));
  assert.equal(scene.nodes.find(n => n.attrs['data-role'] === 'active-line').attrs.fill, single.muted);
});
test('station clipboard retains complete content and offsets, pasting independent copies in line order', () => {
  let state = S.create();
  state = S.addStation(state, state.currentId);
  const id = state.stations[1].id;
  state = S.patchStation(state, id, { zh: 'Station B', en: 'Copied Station', transfers: [{ number: '2', color: '#123456' }] });
  state = S.nudgeElements(state, ['route:' + id, 'vertical:left:' + id], 7, -3);
  const before = S.serialize(state), data = S.deserializeStations(S.serializeStations(state, [id]));
  const pasted = S.pasteStations(state, data, 1), copy = pasted.stations[1];
  assert.notEqual(copy.id, id);
  assert.equal(copy.en, 'Copied Station');
  assert.equal(copy.transfers[0].color, '#123456');
  assert.equal(pasted.adjustments['route:' + copy.id].x, 7);
  assert.equal(pasted.adjustments['vertical:left:' + copy.id].y, -3);
  copy.transfers[0].color = '#FFFFFF';
  assert.equal(S.serialize(state), before);
  assert.equal(data.stations[0].station.transfers[0].color, '#123456');
  assert.throws(() => S.deserializeStations({ kind: 'jr-sign-elements', version: 1 }), /剪贴板/);
});
test('batch station deletion and element reset stay immutable and keep one valid current station', () => {
  let state = S.create();
  for (let i = 0; i < 3; i++) state = S.addStation(state, state.stations[state.stations.length - 1].id);
  const keys = state.stations.map(s => 'route:' + s.id), before = S.serialize(state);
  const moved = S.nudgeElements(state, keys, 5, 2);
  keys.forEach(key => assert.equal(moved.adjustments[key].x, 5));
  assert.equal(Object.keys(S.resetElements(moved, keys).adjustments).length, 0);
  const removed = S.removeStations(moved, state.stations.map(s => s.id));
  assert.equal(removed.stations.length, 1);
  assert.equal(removed.currentId, removed.stations[0].id);
  assert.equal(S.serialize(state), before);
});
test('Beijing aliases and custom palettes survive selection, edits and JSON transfer',()=>{
  const C=context.SignCore,P=context.SignPalettes;
  assert.equal(C.citySwatches('beijing').length,23);
  assert.equal(C.lineColorFor('八通线','beijing').bg,'#A4343A');
  assert.equal(C.lineColorFor('昌平线','beijing').bg,'#D986BA');
  const p=P.save({name:'My palette',entries:[{name:'1号线',color:'#abc'},{name:'机场线',color:'#008c95'}]});
  assert.equal(C.lineColorFor('1',p.id).bg,'#AABBCC');
  assert.equal(S.deserialize(S.serialize(S.settings(S.create(),{city:p.id}))).city,p.id);
  assert.equal(P.mergeJSON(P.list(),P.serialize(P.list())).length,2);
  P.remove(p.id);assert.equal(C.isPalette(p.id),false);
});
test('named route badges keep actual ink inside the circle with divider clearance',()=>{
  for(const mode of ['route','station','vertical'])for(const name of ['机场线','较长的线路名称']) {
    const scene=R.metrics(S.settings(S.create(),{mode,line:name}),measure);
    const n=scene.nodes.find(n=>n.attrs['data-role']===(mode==='vertical'?'vertical-badge-line':'badge-line'));
    const circle=scene.nodes.find(n=>n.attrs['data-role']===(mode==='vertical'?'vertical-badge':'current-badge'));
    const b=n.bounds,a=circle.attrs;
    for(const x of [b.x,b.x+b.width])for(const y of [b.y,b.y+b.height])assert(Math.hypot(x-a.cx,y-a.cy)<a.r*.9);
    assert(b.y+b.height<a.cy-a.r*.1);
  }
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
test('non-transfer current-stop color boundaries are direction-matched outer-circle tangents',()=>{
  for(const direction of [-1,1]) {
    let state=S.create();state=S.addStation(S.addStation(state));
    const scene=R.metrics(S.settings(state,{direction}),measure),core=scene.nodes.find(n=>n.attrs['data-role']==='active-line-core'),circle=scene.nodes.find(n=>n.attrs['data-role']==='current-badge');
    assert.equal(core.tag,'polygon');const p=core.attrs.points.split(' ').map(p=>p.split(',').map(Number)),boundary=direction===-1?p.slice(1,-1):[p[0],...p.slice(3).reverse()],[a,b]=boundary.slice(-2),dx=b[0]-a[0],dy=b[1]-a[1],c=circle.attrs;
    assert(Math.abs(dx-direction*dy)<1e-7);
    assert(Math.abs(Math.abs(dy*c.cx-dx*c.cy+b[0]*a[1]-b[1]*a[0])/Math.hypot(dx,dy)-c.r-c['stroke-width']/2)<1e-7);
  }
});
test('non-transfer current-stop upper bar ends inside the circle without a colored corner',()=>{
  for(const direction of [-1,1]) {
    let state=S.create();state=S.addStation(S.addStation(state));state=S.settings(state,{direction});
    const scene=R.metrics(state,measure),c=scene.nodes.find(n=>n.attrs['data-role']==='current-badge').attrs;
    const p=scene.nodes.find(n=>n.attrs['data-role']==='active-line-core').attrs.points.split(' ').map(p=>p.split(',').map(Number));
    const top=direction===-1?p[1]:p[0],edge=c.cx-direction*Math.sqrt((c.r+c['stroke-width']/2)**2-(top[1]-c.cy)**2);
    assert(direction*(top[0]-edge)>0);
  }
});
test('text transfer badge and bilingual ink share the station captions rotation',()=>{
  let state=S.create();state=S.patchStation(state,state.currentId,{transfers:S.parseTransfers('机场线~Airport Line:#0057B8')});
  const scene=R.metrics(state,measure),card=scene.nodes.find(n=>n.attrs['data-role']==='transfer-text-badge'),names=scene.nodes.filter(n=>/transfer-text-(zh|en)$/.test(n.attrs['data-role']));
  assert(Math.abs(card.matrix[0]-Math.SQRT1_2)<1e-7);assert(Math.abs(card.matrix[1]+Math.SQRT1_2)<1e-7);assert.equal(names.length,2);
  names.forEach(n=>assert.equal(JSON.stringify(n.matrix),JSON.stringify(card.matrix)));
});
test('single named transfers use the numeric Transfer caption outlines, size and angle',()=>{
  const original=S.create(),id=original.currentId;
  const scenes=['4','机场线~Airport Line:#0057B8'].map(value=>R.metrics(S.patchStation(original,id,{transfers:S.parseTransfers(value)}),measure));
  const captions=scenes.map(scene=>scene.nodes.filter(n=>n.attrs['data-role']==='transfer-caption'));
  assert.equal(captions[1].length,2);
  captions[1].forEach((n,i)=>{
    assert.equal(n.label,i?'Transfer':'换乘');assert.equal(n.attrs.d,captions[0][i].attrs.d);
    assert.equal(JSON.stringify(n.matrix.slice(0,4)),JSON.stringify(captions[0][i].matrix.slice(0,4)));
  });
});

test('vertical origin strips are fully colored and terminal strips stay gray with flat ends',()=>{
  for(const count of [1,2,11,50])for(const verticalVariant of ['left','right','double'])for(const direction of [-1,1])for(const verticalSwapped of [false,true])for(const current of count===1?[0]:[0,count-1]) {
    const base=S.replaceStations(S.create(),Array.from({length:count},(_,i)=>({id:'endpoint-'+i,code:String(i+1),zh:'站点',en:'Station',transfers:[]})));
    const state=S.settings(base,{mode:'vertical',verticalVariant,direction,verticalSwapped,currentId:base.stations[current].id}),scene=R.metrics(state,measure);
    const bars=scene.nodes.filter(n=>n.attrs['data-role']==='vertical-bar');
    scene.columns.forEach((column,i)=>{
      const bar=bars[i].attrs,terminal=current===(column.direction===1?count-1:0);
      const active=scene.nodes.find(n=>n.attrs['data-role']==='vertical-active-bar'&&n.attrs.x===bar.x);
      const tail=scene.nodes.find(n=>n.attrs['data-role']==='vertical-tail'&&n.attrs['data-column-side']===column.side);
      assert.equal(bar.fill,state.muted);
      if(terminal) {
        assert.equal(active,undefined);assert.equal(tail,undefined);
        assert(Math.abs(bar.y-column.positions.at(-1)+40*column.unit)<1e-7);
        assert(Math.abs(bar.y+bar.height-column.positions[0]-40*column.unit)<1e-7);
      } else {
        assert(active&&tail);assert.equal(tail.attrs.fill,state.color);
        assert.equal(active.attrs.fill,state.color);assert.equal(active.attrs.y,bar.y);assert.equal(active.attrs.height,bar.height);
      }
    });
  }
});
