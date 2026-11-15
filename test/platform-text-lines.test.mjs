import { createStationProject } from './station-data.mjs';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
for (const file of ['core','icons','platform/reference','platform/vertical-reference','platform/state','platform/route','platform/hanging','platform/vertical','platform/render','platform/presets']) (0,eval)(readFileSync(new URL('../js/'+file+'.js',import.meta.url),'utf8'));
const S=PlatformState,R=PlatformRender;
const measure=(t,f,w,s)=>String(t).length*s*.9;
measure.ink=(t,f,w,s)=>({abl:0,abr:measure(t,f,w,s)});
measure.ascent=(t,f,w,s)=>s*.8;measure.descent=(t,f,w,s)=>s*.1;
test('纵向12及后续站号使用01–11的轮廓，包含本站与三位站号',()=>{
  for(const variant of ['left','right','double'])for(const current of [false,true])for(const code of ['12','20','99','120']) {
    let state=S.settings(createStationProject(S),{mode:'vertical',verticalVariant:variant});
    const id=current?state.currentId:state.stations[0].id;
    state=S.patchStation(state,id,{code});
    const ns=R.metrics(state,measure).nodes.filter(n=>n.attrs['data-station-id']===id&&n.attrs['data-role']===(current?'vertical-badge-code':'vertical-station-code'));
    assert.ok(ns.length>=code.length);assert.ok(ns.every(n=>n.tag==='path'));
    ns.forEach((n,i)=>assert.equal(n.attrs.d,PlatformVerticalReference.stationDigits[code[i%code.length]].d));
  }
});
test('文字换乘批量编辑、序列化和预设保留双语名称与颜色，旧数字格式保持兼容',()=>{
  const ts=S.parseTransfers('1,碧桐线~Bitong Line:#0057B8','chongqing');
  assert.equal(ts[1].type,'text');assert.equal(ts[1].nameZh,'碧桐线');assert.equal(ts[1].nameEn,'Bitong Line');
  assert.equal(ts[1].color,'#0057B8');assert.equal(ts[0].number,'1');
  let state=createStationProject(S);state=S.patchStation(state,state.currentId,{transfers:ts});
  assert.deepEqual(S.deserialize(S.serialize(state)),state);
  assert.deepEqual(S.parseTransfers(S.formatTransfers(ts),'chongqing'),ts);
  assert.equal(S.parseStations('01|测试站|Test|碧桐线~Bitong Line:#0057B8','chongqing')[0].transfers[0].nameEn,'Bitong Line');
});
test('文字换乘与数字换乘同高，MiSans Regular，三种纵向版式和全线吊板均绘制双语',()=>{
  let state=createStationProject(S),id=state.stations[0].id;
  state=S.patchStation(state,id,{transfers:[{type:'text',nameZh:'碧桐线',nameEn:'Bitong Line',color:'#0057B8'}]});
  for(const mode of ['route','vertical'])for(const variant of ['left','right','double']) {
    const scene=R.metrics(S.settings(state,{mode,verticalVariant:variant}),measure);
    const badge=scene.nodes.find(n=>n.attrs['data-station-id']===id&&n.attrs['data-role']===(mode==='route'?'transfer-text-badge':'vertical-transfer-text-badge'));
    assert.ok(badge);assert.ok(badge.attrs.rx>0);
    const names=scene.nodes.filter(n=>n.attrs['data-station-id']===id&&[mode==='route'?'transfer-text-zh':'vertical-transfer-text-zh',mode==='route'?'transfer-text-en':'vertical-transfer-text-en'].includes(n.attrs['data-role']));
    assert.equal(names.length,2);assert.ok(names.every(n=>n.attrs['font-family']===SignCore.FONT_ZH&&n.attrs['font-weight']===400));
    assert.ok(scene.usedFonts.zh400);
    const numeric=R.metrics(S.settings(S.patchStation(state,id,{transfers:[{number:'1',color:'#0057B8'}]}),{mode,verticalVariant:variant}),measure);
    const circle=numeric.nodes.find(n=>n.attrs['data-station-id']===id&&n.attrs['data-role']===(mode==='route'?'transfer-circle':'vertical-transfer-circle'));
    assert.ok(Math.abs(badge.attrs.height-2*circle.attrs.r)<1e-7);
  }
});
test('中国铁路图标在服务设施库中，边框无填充黑色1磅、圆角比例与其他图标一致',()=>{
  const ic=SignIcons.ALL.china_railway;assert.ok(ic);assert.equal(ic.name,'中国铁路');assert.equal(ic.cat,'service');assert.equal(ic.vb,'0 0 400 400');
  assert.match(ic.body,/<rect[^>]*rx="40"/);assert.match(ic.body,/fill="none"/);assert.match(ic.body,/stroke="#000000"/);assert.match(ic.body,/stroke-width="1pt"/);assert.match(ic.body,/<path/);
});
test('主线路名称使用MiSans Regular，文字换乘预设往返保留全部字段',()=>{
  let state=S.settings(createStationProject(S),{line:'机场线',lineName:'机场线'});
  state=S.patchStation(state,state.currentId,{transfers:S.parseTransfers('机场线~Airport Line:#0057B8')});
  const preset=PlatformPresets.create(state,'文字线路');
  assert.deepEqual(PlatformPresets.deserialize(PlatformPresets.serialize([preset]))[0].state,state);
  for(const mode of ['route','station','vertical']){
    const scene=R.metrics(S.settings(state,{mode}),measure),n=scene.nodes.find(n=>n.attrs['data-role']===(mode==='vertical'?'vertical-badge-line':'badge-line'));
    assert.equal(n.text,'机场线');assert.equal(n.attrs['font-family'],SignCore.FONT_ZH);assert.equal(n.attrs['font-weight'],400);
  }
});
test('吊板文字换乘复用数字的换乘/Transfer轮廓、角度与墨区间距，首末站不裁切',()=>{
  function projection(n,cx,cy){const b=n.bounds,m=n.matrix;return [[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]].map(([x,y])=>{const px=m[0]*x+m[2]*y+m[4],py=m[1]*x+m[3]*y+m[5];return {x:px,y:py,u:Math.SQRT1_2*(px-cx-py+cy)};});}
  for(const direction of [-1,1])for(const height of [192,256])for(const index of [0,2]){
    const stations=Array.from({length:3},(_,i)=>({id:'caption-'+i,code:String(i+1).padStart(2,'0'),zh:'站点',en:'Station',transfers:[]}));
    let state=S.settings(S.replaceStations(createStationProject(S),stations),{direction});state=S.setHangingHeight(state,height);const id=stations[index].id;
    const numeric=R.metrics(S.patchStation(state,id,{transfers:[{number:'4',color:'#008C95'}]}),measure),named=R.metrics(S.patchStation(state,id,{transfers:[{type:'text',nameZh:'机场线',nameEn:'Airport Line',color:'#008C95'}]}),measure);
    const nc=numeric.nodes.find(n=>n.attrs['data-role']==='transfer-circle').attrs,tc=named.nodes.find(n=>n.attrs['data-role']==='transfer-text-badge').attrs;
    const ns=numeric.nodes.filter(n=>n.attrs['data-role']==='transfer-caption'),ts=named.nodes.filter(n=>n.attrs['data-role']==='transfer-caption');
    assert.equal(ts.length,2);assert.deepEqual(ts.map(n=>n.label),['换乘','Transfer']);
    ts.forEach((n,i)=>{
      assert.equal(n.tag,'path');assert.equal(n.attrs.d,ns[i].attrs.d);assert.deepEqual(n.matrix.slice(0,4),ns[i].matrix.slice(0,4));
      const p=projection(n,tc.x+tc.width/2,tc.y+tc.height/2),q=projection(ns[i],nc.cx,nc.cy);
      assert.ok(Math.abs((-tc.width/2-Math.max(...p.map(p=>p.u)))-(-nc.r-Math.max(...q.map(p=>p.u))))<1e-7,'间距按墨区与标识边缘匹配');
      p.forEach(p=>assert.ok(p.x>=0&&p.x<=named.width&&p.y>=0&&p.y<=named.height,'说明文字不裁切'));
    });
  }
});
test('数字与文字换乘遵循相同的多换乘说明显示规则',()=>{
  const state=createStationProject(S),id=state.stations[2].id;
  for(const transfers of [[{number:'2'},{number:'4'}],[{type:'text',nameZh:'机场线'},{number:'4'}]]){
    const scene=R.metrics(S.patchStation(state,id,{transfers}),measure);
    assert.equal(scene.nodes.filter(n=>n.attrs['data-station-id']===id&&n.attrs['data-role']==='transfer-caption').length,0);
  }
});
