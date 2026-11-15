import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
for (const file of ['core','platform/reference','platform/state','platform/route','platform/hanging','platform/vertical-reference','platform/vertical','platform/render','platform/presets']) (0,eval)(readFileSync(new URL('../js/'+file+'.js',import.meta.url),'utf8'));
const S=PlatformState,R=PlatformRender,P=PlatformPresets;
const measure=(t,f,w,s)=>String(t).length*s*.9;
measure.ink=(t,f,w,s)=>({abl:-s*.05,abr:measure(t,f,w,s)-s*.05});
measure.ascent=(t,f,w,s)=>s*.8;measure.descent=(t,f,w,s)=>s*.1;

test('本站行车提示开关兼容旧项目，纯状态更新与项目、预设往返保留设置',()=>{
  const state=S.create(),before=S.serialize(state);
  assert.equal(state.showStationDirection,true);
  const hidden=S.settings(state,{showStationDirection:false});
  assert.equal(hidden.showStationDirection,false);
  assert.equal(S.serialize(state),before);
  assert.equal(S.deserialize(S.serialize(hidden)).showStationDirection,false);
  const preset=P.create(hidden,'隐藏行车提示');
  assert.equal(P.deserialize(P.serialize([preset]))[0].state.showStationDirection,false);
  const legacy=JSON.parse(before);delete legacy.showStationDirection;
  for(const version of [1,2,3]) assert.equal(S.deserialize(JSON.stringify({...legacy,version})).showStationDirection,true);
  for(const value of [null,'false',0]) assert.equal(S.settings(hidden,{showStationDirection:value}).showStationDirection,true);
});

test('隐藏本站提示只移除箭头和双语文字，其余元素位置、字号、颜色与微调完整保留',()=>{
  for(const height of [192,256]) for(const direction of [-1,1]) {
    let state=S.setHangingHeight(S.settings(S.create(),{mode:'station',direction}),height);
    state=S.nudgeElement(S.nudgeElement(state,'station:title',2,-3),'station:direction',-4,-2);
    const shown=R.metrics(state,measure),hiddenState=S.settings(state,{showStationDirection:false}),hidden=R.metrics(hiddenState,measure);
    assert.ok(shown.elements.some(e=>e.key==='station:direction'));
    assert.deepEqual(hidden,{...shown,
      nodes:shown.nodes.filter(n=>n.attrs['data-element-key']!=='station:direction'),
      elements:shown.elements.filter(e=>e.key!=='station:direction'),
    });
    assert.deepEqual(hiddenState.adjustments,state.adjustments);
    assert.deepEqual(R.metrics(S.settings(hiddenState,{showStationDirection:true}),measure),shown);
    for(const mode of ['route','vertical']) assert.deepEqual(R.metrics(S.settings(hiddenState,{mode}),measure),R.metrics(S.settings(state,{mode}),measure));
  }
});

test('行车箭头笔画厚实、紧凑留白并渐淡，右行与左行精确镜像',()=>{
  for(const height of [192,256]) {
    const base=S.setHangingHeight(S.settings(S.create(),{mode:'station'}),height);
    const arrows=direction=>R.metrics(S.settings(base,{direction}),measure).nodes.filter(n=>n.attrs['data-role']==='travel-chevron');
    const left=arrows(-1),right=arrows(1);
    assert.equal(left.length,6);assert.equal(right.length,6);
    const points=n=>n.attrs.points.split(' ').map(p=>p.split(',').map(Number));
    const bounds=n=>{const p=points(n);return {x:Math.min(...p.map(v=>v[0])),width:Math.max(...p.map(v=>v[0]))-Math.min(...p.map(v=>v[0]))};};
    const first=bounds(left[0]),pitch=bounds(left[1]).x-first.x;
    // Inspect actual filled slices: chevron bounding boxes may interleave without touching.
    function slice(n,fraction) {
      const p=points(n),ys=p.map(v=>v[1]),y=Math.min(...ys)+(Math.max(...ys)-Math.min(...ys))*fraction,xs=[];
      for(let j=0;j<p.length;j++) {
        const a=p[j],b=p[(j+1)%p.length];
        if((a[1]<=y&&b[1]>y)||(b[1]<=y&&a[1]>y))xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));
      }
      return [Math.min(...xs),Math.max(...xs)];
    }
    for(const fraction of [.1,.25,.5,.75,.9]) {
      const a=slice(left[0],fraction),b=slice(left[1],fraction),thickness=a[1]-a[0],gap=b[0]-a[1];
      assert.ok(thickness>=pitch*.6,'小尺寸下箭头笔画应足够厚实');
      assert.ok(gap>=thickness*.25&&gap<=thickness*.6,'留白应紧凑且不粘连');
    }
    for(let i=0;i<6;i++) {
      assert.ok(Math.abs(bounds(left[i]).width-first.width)<1e-7);
      assert.ok(Math.abs(bounds(left[i]).x-first.x-i*pitch)<1e-7);
      if(i)assert.ok(left[i-1].attrs.opacity>left[i].attrs.opacity,'朝箭尖方向逐级加深');
      const lp=points(left[i]),rp=points(right[i]),mirror=base.sizes.station.width;
      lp.forEach((p,j)=>{assert.ok(Math.abs(p[0]+rp[j][0]-mirror)<1e-7);assert.equal(p[1],rp[j][1]);});
      assert.equal(left[i].attrs.opacity,right[i].attrs.opacity);
    }
  }
});
