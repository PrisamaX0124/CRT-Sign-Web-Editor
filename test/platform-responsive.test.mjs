import { createStationProject } from './station-data.mjs';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
for(const file of ['core','platform/reference','platform/state','platform/route','platform/hanging','platform/render']) (0,eval)(readFileSync(new URL('../js/'+file+'.js',import.meta.url),'utf8'));
const S=globalThis.PlatformState,R=globalThis.PlatformRender;
const measure=(t,f,w,s)=>String(t).length*s*.9;
measure.ink=(t,f,w,s)=>({abl:-s*.05,abr:measure(t,f,w,s)-s*.05});
measure.ascent=(t,f,w,s)=>s*.8;measure.descent=(t,f,w,s)=>s*.1;
const near=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-7,`${message}: ${a} ≠ ${b}`);
const points=n=>n.attrs.points.split(' ').map(p=>p.split(',').map(Number));
const markers=scene=>scene.nodes.filter(n=>['station-number','current-badge'].includes(n.attrs['data-role']));
function equalGaps(scene) {
  const list=markers(scene),gap=list.length>1?list[1].attrs.cx-list[0].attrs.cx:0;
  for(let i=2;i<list.length;i++)near(list[i].attrs.cx-list[i-1].attrs.cx,gap,'所有圆标（包括本站）应等距');
}
function screenshotCase() {
  const base=createStationProject(S);
  let state=S.settings(base,{direction:1,currentId:base.stations[0].id});
  state=S.replaceStations(state,[...['11','10','03'].map((code,i)=>({id:'prefix-'+i,code,zh:i===2?'松园':'新站点',en:i===2?'Pinefield':'New Station',transfers:[]})),...base.stations]);
  return {base,state};
}

test('截图回归：左端连续增站、右侧再插站，圆标间距始终统一',()=>{
  const {base,state}=screenshotCase();equalGaps(R.metrics(state,measure));
  const inserted=S.addStation(state,base.stations[4].id);
  equalGaps(R.metrics(inserted,measure));assert.equal(inserted.stations.length,12);
  assert.equal(state.stations.length,11);
  assert.deepEqual(state.sizes.route,inserted.sizes.route);assert.deepEqual(state.sizes.station,inserted.sizes.station);
  assert.equal(inserted.sizes.vertical.height,state.sizes.vertical.height,'纵向线路图在共享站点增长后仍保持固定高度');
});

test('密集线路回归：缺口、白色留边与换乘色支线共用斜切顶边，单双多线都不偏移',()=>{
  for(const count of [11,12,20,50,120])for(const height of [192,256])for(const direction of [-1,1]) {
    const base=createStationProject(S);
    const stations=Array.from({length:count},(_,i)=>({id:'dense-'+i,code:String(i+1).padStart(2,'0'),zh:'车站',en:'Station',transfers:Array.from({length:[1,2,6][i%3]},(_,j)=>({number:String(j+1),color:'#0057B7'}))}));
    const state=S.setHangingHeight(S.settings(S.replaceStations(base,stations),{direction,currentId:stations[Math.floor(count/2)].id}),height);
    const scene=R.metrics(state,measure);equalGaps(scene);
    for(const station of state.stations.filter(s=>s.id!==state.currentId)) {
      const nodes=scene.nodes.filter(n=>n.attrs['data-station-id']===station.id);
      const notch=points(nodes.find(n=>n.attrs['data-role']==='station-notch'));
      const white=points(nodes.find(n=>n.attrs['data-role']==='transfer-clearance'));
      const branch=points(nodes.find(n=>n.attrs['data-role']==='transfer-branch'));
      for(let i=0;i<2;i++)for(let axis=0;axis<2;axis++)near(notch[i][axis],white[i][axis],'缺口和换乘白边顶端重合');
      const left=branch[0][0]-white[0][0],right=white[1][0]-branch[1][0];
      near(left,right,'换乘色两侧白边等宽');assert.ok(left>0);
      near(branch[1][0]-branch[2][0],branch[2][1]-branch[1][1],'斜接边保持45度');
    }
  }
});
