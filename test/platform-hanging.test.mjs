import { createStationProject } from './station-data.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const load = p => (0, eval)(readFileSync(new URL(p, import.meta.url), 'utf8'));
load('../js/core.js'); load('../js/platform/reference.js'); load('../js/platform/state.js'); load('../js/platform/route.js');
for (const p of ['../js/platform/hanging.js', '../js/platform/presets.js']) if (existsSync(new URL(p, import.meta.url))) load(p);
load('../js/platform/vertical-reference.js');
load('../js/platform/vertical.js');
load('../js/platform/render.js');
const S = globalThis.PlatformState, R = globalThis.PlatformRender;
const measure = (t, f, w, s) => String(t).length * s * .9;
measure.ink = (t, f, w, s) => ({ abl: -s * .05, abr: measure(t, f, w, s) - s * .05, adv: measure(t, f, w, s) });
measure.ascent = (t, f, w, s) => s * .8;
measure.descent = (t, f, w, s) => s * .1;

test('服务器吊板尺寸：线路图3格、本站2格，地铁短边0.75格', () => {
  const state = createStationProject(S);
  assert.deepEqual(state.sizes.route, { width: 768, height: 192 });
  assert.deepEqual(state.sizes.station, { width: 512, height: 192 });
});
test('格数与地铁/单轨快捷设置不可变，竖版尺寸保持原值', () => {
  const state = createStationProject(S), before = S.serialize(state);
  assert.equal(typeof S.setHangingLength, 'function');
  const next = S.setHangingHeight(S.setHangingLength(state, 4), 256);
  assert.deepEqual(next.sizes.route, { width: 1024, height: 256 });
  assert.deepEqual(next.sizes.station, { width: 512, height: 256 });
  assert.deepEqual(next.sizes.vertical, state.sizes.vertical);
  assert.equal(S.serialize(state), before);
});
test('单轨全线默认5格，地铁默认3格；手动长度保留，旧单轨默认尺寸迁移', () => {
  const state = createStationProject(S), monorail = S.setHangingHeight(state, 256);
  assert.deepEqual(monorail.sizes.route, { width: 1280, height: 256 });
  assert.deepEqual(monorail.sizes.station, { width: 512, height: 256 });
  assert.deepEqual(S.setHangingHeight(monorail, 192).sizes.route, state.sizes.route);
  const legacy = createStationProject(S); legacy.version = 2; legacy.sizes.route = { width: 768, height: 256 };
  assert.deepEqual(S.deserialize(JSON.stringify(legacy)).sizes.route, { width: 1280, height: 256 });
});
test('旧站台项目的底纹开关不生效', () => {
  const state = S.settings(createStationProject(S), { mode: 'vertical', texture: true });
  assert.equal(state.texture, false);
  assert.equal(R.metrics(state, measure).nodes.filter(n => n.attrs.opacity === .12).length, 0);
});
function quad(n) {
  const b = n.bounds; if(n.matrix) { const m=n.matrix; return [[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]); } const m = n.attrs.transform.match(/rotate\((-?[\d.]+) ([\d.-]+) ([\d.-]+)\)/), a = Number(m[1]) * Math.PI / 180, cx = Number(m[2]), cy = Number(m[3]);
  return [[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]].map(([x,y]) => [cx+(x-cx)*Math.cos(a)-(y-cy)*Math.sin(a),cy+(x-cx)*Math.sin(a)+(y-cy)*Math.cos(a)]);
}
function distanceToQuad(p, points) {
  const signs = points.map((a,i) => { const b = points[(i+1)%4]; return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]); });
  if (signs.every(s => s >= 0) || signs.every(s => s <= 0)) return 0;
  return Math.min(...points.map((a,i) => { const b = points[(i+1)%4], dx=b[0]-a[0], dy=b[1]-a[1], t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy || 1))); return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy); }));
}
test('截图回归：旋转后的中英文墨区与所有站点圆标均留出净空，普通站中文字号一致', () => {
  for (const height of [192,256]) for (const direction of [-1,1]) for (const fontScale of [1,1.4]) for (const index of [0,4,7]) {
    const base = createStationProject(S), state = S.setHangingHeight(S.settings(base, { direction,fontScale,currentId:base.stations[index].id }),height), scene=R.metrics(state,measure);
    const circles=scene.nodes.filter(n => ['station-number','current-badge'].includes(n.attrs['data-role']));
    const captions=scene.nodes.filter(n => n.bounds && ['name-zh','name-en'].includes(n.attrs['data-role']) && n.attrs['data-element-key'].startsWith('route:') && n.text!=='换乘' && n.text!=='Transfer');
    for (const n of captions) for (const c of circles) assert.ok(distanceToQuad([c.attrs.cx,c.attrs.cy],quad(n))-c.attrs.r >= height*.017, n.text+' 与站点圆标重叠或过近');
    const sizes=captions.filter(n => n.attrs['data-role']==='name-zh' && n.attrs['font-weight']===400).map(n => n.attrs['font-size']);
    assert.ok(Math.max(...sizes)-Math.min(...sizes)<.001, '长英文不应缩小整组中文');
  }
});
test('旧站台默认尺寸迁移；用户自定义尺寸与竖版保留', () => {
  const old = createStationProject(S); old.version = 1;
  old.sizes.route = { width: 3072, height: 768 }; old.sizes.station = { width: 1536, height: 768 };
  const migrated = S.deserialize(JSON.stringify(old));
  assert.deepEqual(migrated.sizes.route, { width: 768, height: 192 });
  old.sizes.route = { width: 1024, height: 256 };
  assert.deepEqual(S.deserialize(JSON.stringify(old)).sizes.route, old.sizes.route);
  assert.equal(S.setHangingHeight(S.deserialize(JSON.stringify(old)),192).sizes.route.width,1024,'旧自定义长度不会被误判成自动长度');
  assert.deepEqual(migrated.sizes.vertical, old.sizes.vertical);
});
test('吊板铺满指定尺寸，不用长线路自然宽度缩成一条小图', () => {
  for (const height of [192, 256]) for (const mode of ['route', 'station']) {
    const state = S.settings(createStationProject(S), { mode });
    state.sizes[mode].height = height;
    const scene = R.metrics(state, measure);
    assert.equal(scene.width, state.sizes[mode].width);
    assert.equal(scene.height, height);
    assert.equal(scene.frame.scale, 1); assert.equal(scene.frame.x, 0); assert.equal(scene.frame.y, 0);
  }
});
test('双语墨区间距与数字墨区中心：缩短中文也不让英文跳位', () => {
  const state = S.settings(createStationProject(S), { mode: 'station', fontScale: 1.4 });
  const scene = R.metrics(state, measure);
  assert.ok(scene.elements, '应提供与渲染一致的元素几何');
  const title = scene.nodes.filter(n => n.attrs['data-element-key'] === 'station:title' && n.tag === 'text');
  assert.equal(title.length, 2);
  assert.ok(title[1].bounds.y > title[0].bounds.y + title[0].bounds.height);
  const badge = scene.nodes.find(n => n.attrs['data-role'] === 'current-badge');
  const digits = scene.nodes.filter(n => n.attrs['data-element-key'] === 'station:badge' && n.tag === 'text');
  digits.forEach(n => assert.ok(Math.abs(n.bounds.x + n.bounds.width / 2 - badge.attrs.cx) < 1e-8));
  assert.ok(digits[0].bounds.y + digits[0].bounds.height < badge.attrs.cy);
  assert.ok(digits[1].bounds.y > badge.attrs.cy);
});
test('双线换乘：一条带白色留边的斜接线、两圆沿左下方向错开且不相叠', () => {
  const scene = R.metrics(createStationProject(S), measure);
  const circles = scene.nodes.filter(n => n.attrs['data-role'] === 'transfer-circle');
  assert.ok(circles.length);
  const pair = circles.filter(n => n.attrs['data-element-key'] === circles[1].attrs['data-element-key']);
  assert.equal(pair.length, 2);
  assert.ok(pair[1].attrs.cx < pair[0].attrs.cx && pair[1].attrs.cy > pair[0].attrs.cy);
  assert.ok(Math.hypot(pair[1].attrs.cx - pair[0].attrs.cx, pair[1].attrs.cy - pair[0].attrs.cy) > pair[0].attrs.r + pair[1].attrs.r);
  const nodes = scene.nodes.filter(n => n.attrs['data-element-key'] === pair[0].attrs['data-element-key']);
  assert.equal(nodes.filter(n => n.attrs['data-role'] === 'transfer-branch').length, 1);
  assert.equal(nodes.filter(n => n.attrs['data-role'] === 'transfer-clearance').length, 1);
});
test('本站吊板：邻站双语与方向提示之间保留明确墨区间距', () => {
  for (const height of [192, 256]) for (const fontScale of [1, 1.4]) for (const direction of [-1, 1]) {
    const state = S.setHangingHeight(S.settings(createStationProject(S), { mode: 'station', fontScale, direction }), height), scene = R.metrics(state, measure);
    const hint = scene.elements.find(e => e.key === 'station:direction');
    for (const key of ['station:left', 'station:right']) {
      const neighbor = scene.elements.find(e => e.key === key);
      const a=neighbor.box,b=hint.box;
      const gap=Math.max(b.x-a.x-a.width,a.x-b.x-b.width,b.y-a.y-a.height,a.y-b.y-b.height);
      assert.ok(gap >= height * .025-1e-7, '邻站与中央方向提示应保留净空；参考图允许同一高度的三列布局');
    }
  }
});
test('右行吊板右端斜切，左行吊板左端斜切；换乘本站保留参考接合', () => {
  for (const direction of [-1, 1]) {
    const state=createStationProject(S),scene = R.metrics(S.settings(S.patchStation(state,state.currentId,{transfers:[{number:'2',color:'#009B77'}]}), { direction }), measure);
    const active = scene.nodes.find(n => n.attrs['data-role'] === 'active-line');
    assert.equal(active.tag, 'polygon');
    assert.ok(active.attrs.points.includes(','));
    const passed = scene.nodes.find(n => n.attrs['data-role'] === 'passed-line'), badge = scene.nodes.find(n => n.attrs['data-role'] === 'current-badge');
    assert.equal(passed.attrs.x,(direction===-1?122:112)*scene.height/384,'保留参考里色条底层的灰色矩形，避免叠合边缘抗锯齿变色');
    const core=scene.nodes.find(n=>n.attrs['data-role']==='active-line-core');
    assert.ok(Math.abs((direction===-1?core.attrs.x+core.attrs.width:core.attrs.x)-(badge.attrs.cx-(direction===-1?25:26)*scene.height/384))<1e-8,'活动色条在本站圆标内按参考偏移接合');
  }
});
test('元素微调是不可变状态，几何与命中范围一起移动；竖版不受影响', () => {
  const state = createStationProject(S);
  assert.equal(typeof S.nudgeElement, 'function');
  const key = 'route:' + state.currentId, before = R.metrics(state, measure), next = S.nudgeElement(state, key, 3, -2), after = R.metrics(next, measure);
  const a = before.elements.find(e => e.key === key), b = after.elements.find(e => e.key === key);
  assert.equal(b.box.x - a.box.x, 3); assert.equal(b.box.y - a.box.y, -2);
  assert.deepEqual(state.adjustments, {});
  assert.deepEqual(S.resetElement(next, key).adjustments, {});
  assert.deepEqual(R.metrics(S.settings(state, { mode: 'vertical' }), measure), R.metrics(S.settings(next, { mode: 'vertical' }), measure));
});
test('预设保存完整项目快照、名称、版式、尺寸和微调，往返校验', () => {
  assert.ok(globalThis.PlatformPresets);
  const state = S.nudgeElement(createStationProject(S), 'station:title', 2, 1);
  const preset = PlatformPresets.create(state, '测试吊板', 'preset-test');
  const items = PlatformPresets.deserialize(PlatformPresets.serialize([preset]));
  assert.deepEqual(items[0], preset);
  assert.deepEqual(items[0].state, state);
  assert.notEqual(items[0].state, state);
});
