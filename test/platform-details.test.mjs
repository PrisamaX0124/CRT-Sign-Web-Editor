import { createStationProject } from './station-data.mjs';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
for (const file of ['core','platform/reference','platform/state','platform/route','platform/hanging','platform/render']) (0,eval)(readFileSync(new URL('../js/'+file+'.js',import.meta.url),'utf8'));
const S=PlatformState,R=PlatformRender;
const measure=(t,f,w,s)=>String(t).length*s*.9;
measure.ink=(t,f,w,s)=>({abl:-s*.05,abr:measure(t,f,w,s)-s*.05});
measure.ascent=(t,f,w,s)=>s*.8;measure.descent=(t,f,w,s)=>s*.1;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} ≠ ${b}`);

test('拖动排序按插入间隙移动，向前/向后/末尾正确，状态、本站和微调均保留',()=>{
  const state=S.nudgeElement(createStationProject(S),'station:title',2,3),before=S.serialize(state),ids=state.stations.map(s=>s.id);
  assert.equal(typeof S.reorderStation,'function');
  const last=S.reorderStation(state,ids[0],ids.length);
  assert.deepEqual(last.stations.map(s=>s.id),ids.slice(1).concat(ids[0]));
  const first=S.reorderStation(last,ids[0],0);assert.deepEqual(first.stations,state.stations);
  assert.equal(last.currentId,state.currentId);assert.deepEqual(last.adjustments,state.adjustments);
  assert.equal(S.reorderStation(state,ids[0],1),state);assert.equal(S.reorderStation(state,'missing',0),state);
  assert.equal(S.serialize(state),before);
});
test('一键倒序只改变站序，左右行设置独立；站号、本站、微调与往返保留',()=>{
  for(const direction of [-1,1]) {
    const state=S.nudgeElement(S.settings(createStationProject(S),{direction}),'station:direction',2,-3),before=S.serialize(state);
    const next=S.reverseStations(state);
    assert.deepEqual(next.stations,state.stations.slice().reverse());assert.equal(next.currentId,state.currentId);
    assert.equal(next.direction,direction);assert.deepEqual(next.adjustments,state.adjustments);
    assert.equal(S.neighbors(next).next.id,S.neighbors(state).previous.id);
    assert.deepEqual(S.reverseStations(next),state);assert.equal(S.serialize(state),before);
    const switched=S.settings(next,{direction:-direction});
    assert.deepEqual(switched.stations,next.stations);assert.equal(switched.currentId,state.currentId);
    assert.equal(S.deserialize(S.serialize(next)).direction,direction);
  }
});
test('全线本站中英均加粗，本站吊板站名均常规字重',()=>{
  for(const state of [createStationProject(S)]) {
    const route=R.metrics(state,measure);
    for(const role of ['name-zh','name-en']) {
      const n=route.nodes.find(n=>n.attrs['data-station-id']===state.currentId&&n.attrs['data-role']===role);
      assert.equal(n.attrs['font-weight'],600,role+' 全线本站加粗');
      if(n.tag==='path'&&role==='name-en')assert.ok(n.attrs.stroke,'原英文轮廓需实际增加笔画厚度');
    }
    const title=R.metrics(S.settings(state,{mode:'station'}),measure).nodes.filter(n=>n.attrs['data-element-key']==='station:title');
    assert.ok(title.every(n=>n.attrs['font-weight']===400));
  }
});
test('11/12/20/120站号沿用参考数字轮廓，不能切换成更细的后备字体',()=>{
  for(const code of ['11','12','20','120']) {
    const state=createStationProject(S),id=state.stations[0].id,scene=R.metrics(S.patchStation(state,id,{code}),measure);
    const numbers=scene.nodes.filter(n=>n.attrs['data-station-id']===id&&n.attrs['data-role']==='station-code');
    assert.equal(numbers.length,code.length);assert.ok(numbers.every(n=>n.tag==='path'));
    numbers.forEach((n,i)=>assert.equal(n.attrs.d,PlatformReference.numbers.stationDigits[code[i]].d));
  }
});
test('组合吊板横线高度与粗细共用布局，含密集线路、左右行与地铁/单轨',()=>{
  for(const count of [8,12,50])for(const height of [192,256])for(const direction of [-1,1]) {
    const base=createStationProject(S),stations=Array.from({length:count},(_,i)=>({...base.stations[i%8],id:'bar-'+i}));
    const state=S.setHangingHeight(S.settings(S.replaceStations(base,stations),{currentId:stations[0].id,direction}),height);
    const route=R.metrics(state,measure).nodes.find(n=>n.attrs['data-role']==='passed-line');
    const station=R.metrics(S.settings(state,{mode:'station'}),measure).nodes.find(n=>n.attrs['data-role']==='passed-line');
    near(route.attrs.y,station.attrs.y);near(route.attrs.height,station.attrs.height);
  }
});
test('本站吊板邻站按参考墨区拟合并留出空间；右行提示中英墨区右边缘对齐',()=>{
  for(const direction of [-1,1]) {
    const scene=R.metrics(S.settings(createStationProject(S),{mode:'station',direction}),measure);
    const neighbors=scene.nodes.filter(n=>['station:left','station:right'].includes(n.attrs['data-element-key'])&&n.attrs['data-role']==='name-zh');
    assert.ok(neighbors.every(n=>n.bounds.height>=scene.height*40/384&&n.bounds.height<=scene.height*44.355/384+1e-7));
    const labels=scene.nodes.filter(n=>n.attrs['data-element-key']==='station:direction'&&n.tag==='text');
    const edge=n=>n.bounds.x+(direction===1?n.bounds.width:0);near(edge(labels[0]),edge(labels[1]));
  }
});
