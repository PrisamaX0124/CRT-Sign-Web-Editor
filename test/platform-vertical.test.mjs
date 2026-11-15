import { createStationProject, createVerticalProject } from './station-data.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
for (const file of ['core', 'platform/reference', 'platform/vertical-reference', 'platform/state', 'platform/route', 'platform/hanging', 'platform/vertical', 'platform/render']) {
  const url = new URL('../js/' + file + '.js', import.meta.url);
  if (existsSync(url)) (0, eval)(readFileSync(url, 'utf8'));
}
const S = globalThis.PlatformState, R = globalThis.PlatformRender;
const measure = (s, f, w, size) => s.length * size * .9;
measure.ink = (s, f, w, size) => ({ abl: -size * .05, abr: measure(s, f, w, size) - size * .05 });
measure.ascent = (s, f, w, size) => size * .8;
measure.descent = (s, f, w, size) => size * .1;
const role = (scene, name) => scene.nodes.filter(n => n.attrs['data-role'] === name);
const inkX = n => n.matrix ? n.bounds.x * n.matrix[0] + n.matrix[4] : n.bounds.x;
const inkBox = n => {
  if(!n.matrix)return n.bounds;
  const b=n.bounds,m=n.matrix,points=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]];
  const xs=points.map(([x,y])=>x*m[0]+y*m[2]+m[4]),ys=points.map(([x,y])=>x*m[1]+y*m[3]+m[5]);
  return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
};

test('MC纵向默认固定3格高：单列384×768、双列640×768，增删站不改变高度', () => {
  assert.deepEqual(createStationProject(S).sizes.vertical,{width:384,height:768});
  let state=createVerticalProject(S);
  for(const variant of ['left','right','double']) {
    const legacy=JSON.parse(S.serialize(state));legacy.verticalVariant=variant;legacy.verticalWidthAuto=false;legacy.verticalHeightAuto=true;legacy.sizes.vertical={width:768,height:2048};
    state=S.deserialize(JSON.stringify(legacy));
    assert.deepEqual(state.sizes.vertical,{width:variant==='double'?640:384,height:768});
    assert.equal(state.verticalHeightAuto,false);
    const added=S.addStation(state,state.currentId);
    assert.equal(added.sizes.vertical.height,768);
    assert.equal(S.removeStation(added,added.stations.find(s=>!state.stations.some(old=>old.id===s.id)).id).sizes.vertical.height,768);
    const edited=S.settings(added,{sizes:{...added.sizes,vertical:{width:512,height:999}},verticalHeightAuto:false});
    assert.equal(edited.sizes.vertical.height,999,'可手动指定另一个固定高度');
    assert.equal(S.addStation(edited,edited.currentId).sizes.vertical.height,999);
    assert.equal(edited.sizes.vertical.width,state.sizes.vertical.width);
    assert.deepEqual(S.deserialize(S.serialize(edited)).sizes.vertical,edited.sizes.vertical);
  }
});

test('右版换乘仍从左到右读作换乘X号线，多线路顺序保持输入顺序', () => {
  const state=S.setVerticalVariant(createVerticalProject(S),'right'),scene=R.metrics(state,measure);
  const s=state.stations[0], same=scene.nodes.filter(n=>n.attrs['data-station-id']===s.id);
  const label=same.find(n=>n.attrs['data-role']==='vertical-transfer-zh');
  const number=same.find(n=>n.attrs['data-role']==='vertical-transfer-circle');
  const suffix=same.find(n=>n.label==='号线');
  assert.ok(inkX(label)+inkBox(label).width<number.attrs.cx-number.attrs.r);
  assert.ok(number.attrs.cx+number.attrs.r<inkX(suffix));
  const multi=scene.nodes.filter(n=>n.attrs['data-station-id']===state.stations[3].id&&n.attrs['data-role']==='vertical-transfer-circle');
  assert.ok(multi[0].attrs.cx<multi[1].attrs.cx,'5、6号线应正向排列');
});

test('纵向顶栏箭头固定左←/右→；主体首站在下、末站在上，方向与交换保持联动', () => {
  const ref=createVerticalProject(S),ids=ref.stations.map(s=>s.id);
  for(const variant of ['left','right','double'])for(const direction of [-1,1])for(const verticalSwapped of [false,true]) {
    const state=S.settings(S.setVerticalVariant(ref,variant),{direction,verticalSwapped}),scene=R.metrics(state,measure);
    assert.deepEqual(scene.stationIds,ids);
    scene.columns.forEach((c,i)=>{
      const nodes=scene.nodes.filter(n=>n.attrs['data-element-key']==='vertical:direction:'+c.side);
      const arrow=nodes.find(n=>n.attrs['data-role']==='vertical-direction-arrow'),m=arrow.matrix;
      const tipX=12*m[0]+40*m[2]+m[4],backX=44*m[0]+40*m[2]+m[4];
      const tipY=12*m[1]+40*m[3]+m[5],backY=44*m[1]+40*m[3]+m[5];
      const verticalDirection=-c.direction;
      assert.ok((tipX-backX)*(c.side==='right'?1:-1)>0,'顶栏左版/左侧固定←，右版/右侧固定→，交换和行车方向不得改变箭头朝向');
      assert.equal(tipY,backY,'顶栏箭头须水平');
      assert.ok(c.positions[0]>c.positions.at(-1),'列表首站应在下、末站应在上');
      const b=inkBox(arrow);assert.ok(Math.abs(b.y+b.height/2-36)<.001,'水平箭头仍应墨区居中');
      const terminal=ref.stations[c.direction===1?ref.stations.length-1:0];
      assert.equal(nodes.find(n=>n.attrs['data-role']==='vertical-direction-zh').label||nodes.find(n=>n.attrs['data-role']==='vertical-direction-zh').text,terminal.zh+'方向');
      const tail=role(scene,'vertical-tail')[i],ys=tail.attrs.points.split(' ').map(p=>Number(p.split(',')[1]));
      assert.equal(tail.attrs.fill,state.color);
      assert.ok(verticalDirection===1?Math.min(...ys)>c.positions[6]:Math.max(...ys)<c.positions[6],'活动色端头须位于前进方向一端');
      assert.ok((c.positions[6+c.direction]-c.positions[6])*verticalDirection>0,'吊板下一站应位于纵向箭头指向的一侧');
      ref.stations.forEach((s,index)=>{if(index===6)return;const ring=scene.nodes.find(n=>n.attrs['data-element-key']==='vertical:'+c.side+':'+s.id&&n.attrs['data-role']==='vertical-station-ring');assert.equal(ring.attrs.stroke===state.color,(index-6)*c.direction>=0,'未驶过区段须与箭头指向一致');});
    });
  }
});

test('纵向斜切端头：矩形与端头合并后的边界保持一条斜边，没有水平折线或空隙', () => {
  for(const count of [1,11,50,120])for(const variant of ['left','right','double'])for(const direction of [-1,1]) {
    const base=S.replaceStations(createStationProject(S),Array.from({length:count},(_,i)=>({id:'cap'+i,code:String(i+1),zh:'站点',en:'Station',transfers:[]})));
    const state=S.settings(S.setVerticalVariant(base,variant),{mode:'vertical',direction,currentId:base.stations[Math.floor(count/2)].id}),scene=R.metrics(state,measure);
    scene.columns.forEach((c,i)=>{
      if(count===1) {
        assert.equal(role(scene,'vertical-tail').length,0,'单站无前方区段，不应生成斜切端头');
        assert.equal(role(scene,'vertical-active-bar').length,0,'单站不应生成活动线路色竖带');
        return;
      }
      const rect=role(scene,'vertical-bar')[i].attrs,active=role(scene,'vertical-active-bar')[i].attrs;
      const pts=role(scene,'vertical-tail')[i].attrs.points.split(' ').map(p=>p.split(',').map(Number));
      const outer=pts.slice(2),inner=pts.slice(0,2);
      if(c.direction===1) {
        const min=Math.max(...outer.map(p=>p[1])),max=Math.min(...inner.map(p=>p[1]));
        assert.ok(rect.y>=min-1e-6,'向上矩形不得遮住斜边产生水平折线');
        assert.ok(rect.y<=max+1e-6,'向上矩形须与端头重叠，避免空隙');
        assert.equal(active.y,rect.y);
      } else {
        const min=Math.max(...inner.map(p=>p[1])),max=Math.min(...outer.map(p=>p[1]));
        assert.ok(rect.y+rect.height<=max+1e-6,'向下矩形不得越过斜边');
        assert.ok(rect.y+rect.height>=min-1e-6,'向下矩形须与端头重叠');
      }
    });
  }
});

test('纵向上下留白和竖带延伸：首末站外延40单位，两个方向及双列交换的顶底完全对齐', () => {
  for(const count of [1,11,50,120])for(const height of [128,768,1500])for(const variant of ['left','right','double']) {
    const base=S.replaceStations(createStationProject(S),Array.from({length:count},(_,i)=>({id:'extent'+i,code:String(i+1),zh:'站点',en:'Station',transfers:[]})));
    let expected;
    for(const direction of [-1,1])for(const verticalSwapped of [false,true]) {
      const state=S.settings(S.setVerticalVariant(base,variant),{mode:'vertical',direction,verticalSwapped,currentId:base.stations[Math.floor(count/2)].id,sizes:{...base.sizes,vertical:{width:384,height}}}),scene=R.metrics(state,measure);
      scene.columns.forEach((c,i)=>{
        const r=role(scene,'vertical-bar')[i].attrs,tail=role(scene,'vertical-tail').find(n=>n.attrs['data-column-side']===c.side);
        const ys=tail?tail.attrs.points.split(' ').map(p=>Number(p.split(',')[1])):[];
        const top=Math.min(r.y,...ys),bottom=Math.max(r.y+r.height,...ys),stationTop=c.positions.at(-1),stationBottom=c.positions[0];
        assert.ok(Math.abs(stationTop-top-40*c.unit)<.001,'顶部竖带须伸出40个主体单位');
        assert.ok(Math.abs(bottom-stationBottom-40*c.unit)<.001,'底部竖带须越过末个圆标再延伸40个主体单位');
        assert.ok(Math.abs((top-72)-(scene.height-bottom))<.001,'顶栏以下主体的上下留白须均衡');
        const extent=[top,bottom];if(!expected)expected=extent;else extent.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<.001,'切换方向或交换后竖带顶底须完全对齐'));
        assert.deepEqual(scene.output,{width:variant==='double'?640:384,height});
      });
    }
  }
});

test('双列换乘只绘制中央一组，交换不复制或移动换乘，两侧文字和圆标保持原大小', () => {
  const state=S.setVerticalVariant(createVerticalProject(S),'double'),scene=R.metrics(state,measure);
  assert.equal(scene.output.width,640);assert.equal(scene.output.height,768);
  assert.equal(scene.frame.scale,.75);
  assert.equal(role(scene,'vertical-transfer-circle').length,state.stations.reduce((n,s)=>n+s.transfers.length,0));
  const shared=scene.elements.filter(e=>e.kind==='vertical-transfer');
  assert.equal(shared.length,state.stations.filter(s=>s.transfers.length).length);
  shared.forEach(e=>assert.ok(e.box.x>scene.columns[0].markerX+22&&e.box.x+e.box.width<scene.columns[1].markerX-22));
  const swapped=R.metrics(S.swapVerticalColumns(state),measure);
  assert.deepEqual(role(swapped,'vertical-transfer-circle'),role(scene,'vertical-transfer-circle'));
  assert.deepEqual(swapped.elements.filter(e=>e.kind==='vertical-transfer'),shared);
  const key='vertical:transfer:'+state.currentId;
  assert.deepEqual(S.setElementOffset(state,key,{x:2,y:1}).adjustments[key],{x:2,y:1});
});

test('换乘整组缩小25%，文字和编号弱于站名，三版式保持正向阅读与垂直对齐', () => {
  const ref=createVerticalProject(S),source=globalThis.PlatformVerticalReference;
  for(const variant of ['left','right','double']) {
    const scene=R.metrics(S.setVerticalVariant(ref,variant),measure);
    const same=scene.nodes.filter(n=>n.attrs['data-station-id']===ref.stations[0].id);
    const label=same.find(n=>n.attrs['data-role']==='vertical-transfer-zh');
    const number=same.find(n=>n.attrs['data-role']==='vertical-transfer-number');
    const circle=same.find(n=>n.attrs['data-role']==='vertical-transfer-circle');
    const station=same.find(n=>n.attrs['data-role']==='vertical-station-zh');
    assert.ok(Math.abs(inkBox(label).height-source.transfer.zh.bounds.height*.75)<.001,'换乘标签应整体缩小25%');
    assert.ok(inkBox(label).height<inkBox(station).height*.8,'换乘文字须为次级信息');
    assert.equal(circle.attrs.r,15,'圆标应和文字同比缩小');
    assert.ok(inkBox(number).height<18,'换乘编号应小于普通站编号');
    assert.equal(circle.attrs.cy,scene.columns[0].positions[0]);
    const multi=scene.nodes.filter(n=>n.attrs['data-station-id']===ref.stations[3].id&&n.attrs['data-role']==='vertical-transfer-circle');
    assert.equal(multi[1].attrs.cx-multi[0].attrs.cx,36,'组内间距也应同比缩小');
    same.filter(n=>n.attrs['data-role'].startsWith('vertical-transfer')&&n.matrix).forEach(n=>assert.ok(n.matrix[0]>0));
  }
});

test('方向标题适度缩小，短长标题的中英文整体墨区均在72px顶栏上下居中', () => {
  const project = createVerticalProject(S);
  const ref = S.patchStation(project, project.stations.at(-1).id, { zh: '港口', en: 'Harbor' });
  const normal = R.metrics(ref, measure);
  assert.ok(Math.abs(inkBox(role(normal,'vertical-direction-zh')[0]).height-22)<.03);
  assert.ok(Math.abs(inkBox(role(normal,'vertical-direction-en')[0]).height-14)<.03);
  const long=S.patchStation(ref,ref.stations.at(-1).id,{zh:'这是一个很长很长的终点站名称',en:'A very long terminal name with descenders gy'});
  for(const state of [ref,long])for(const variant of ['left','right','double'])for(const fontScale of [.7,1,1.4]) {
    const scene=R.metrics(S.settings(S.setVerticalVariant(state,variant),{fontScale}),measure);
    for(const side of scene.columns.map(c=>c.side)) {
      const same=scene.nodes.filter(n=>n.attrs['data-element-key']==='vertical:direction:'+side);
      const zh=inkBox(same.find(n=>n.attrs['data-role']==='vertical-direction-zh'));
      const en=inkBox(same.find(n=>n.attrs['data-role']==='vertical-direction-en'));
      assert.ok(Math.abs(zh.y+en.y+en.height-72)<.001,'顶部与底部实际墨区留白应相等');
      assert.ok(Math.abs(en.y-zh.y-zh.height-8)<.001,'中英墨区保持8px净空');
      assert.ok(zh.height<=22+.001&&en.height<=14+.001);
      assert.ok(zh.x>=0&&zh.x+zh.width<=scene.width+.01&&en.x>=0&&en.x+en.width<=scene.width+.01);
      if(state===long&&same.find(n=>(n.text||n.label||'').startsWith('这是')))assert.ok(zh.height<22);
    }
  }
});



test('单列右版：布局镜像、文字正向，方向与本站顶栏互换', () => {
  const left = createVerticalProject(S), a = R.metrics(left, measure);
  const b = R.metrics(S.setVerticalVariant(left, 'right'), measure);
  assert.equal(b.columns[0].markerX, 512 - a.columns[0].markerX);
  assert.ok(inkX(role(b, 'vertical-title-zh')[0]) < 256);
  assert.ok(inkX(role(b, 'vertical-direction-zh')[0]) > 256);
  b.nodes.filter(n => n.matrix && !['vertical-direction-arrow','vertical-current-arrow'].includes(n.attrs['data-role'])).forEach(n => assert.ok(n.matrix[0] > 0, '文字不得反转'));
  assert.deepEqual(b.stationIds, a.stationIds);
});

test('双列交换：两个方向、中央本站、交换不倒转站序或改变吊板方向', () => {
  const single = createVerticalProject(S), state = S.setVerticalVariant(single, 'double'), before = S.serialize(state);
  const a = R.metrics(state, measure), next = S.swapVerticalColumns(state), b = R.metrics(next, measure);
  assert.equal(a.width, 640/.75); assert.equal(a.output.width, 640);
  assert.deepEqual(a.columns.map(c => c.direction), [1,-1]);
  assert.deepEqual(b.columns.map(c => c.direction), [-1,1]);
  assert.equal(S.serialize(state), before);
  assert.equal(next.direction, state.direction);
  assert.deepEqual(next.stations, state.stations);
  assert.deepEqual(S.swapVerticalColumns(next), state);
  assert.equal(role(a, 'vertical-title-zh').length, 1);
  assert.ok(inkX(role(a, 'vertical-title-zh')[0]) > a.width/3);
  assert.equal(a.elements.filter(e => e.stationId === state.currentId).length, 4);
  assert.equal(S.deserialize(S.serialize(next)).verticalSwapped, true);
  const edited = S.patchStation(next, next.currentId, { zh: '联动站名', en: 'Linked Station' });
  for (const mode of ['route','station','vertical']) assert.ok(R.metrics(S.settings(edited,{mode}),measure).nodes.some(n => n.text === '联动站名'));
});

test('纵向密集与长站名：1/11/50/120站、六换乘、两方向、三版式墨区有界', () => {
  for (const count of [1,11,50,120]) for (const variant of ['left','right','double']) for (const direction of [-1,1]) {
    let state = S.replaceStations(createStationProject(S), Array.from({length:count},(_,i)=>({id:'v'+i,code:String(i+1),zh:'超长中文站名测试',en:'Long name with descenders gy',transfers:Array.from({length:6},(_,j)=>({number:String(j+1),color:'#0057B7'}))})));
    state = S.settings(S.setVerticalVariant(state,variant), {mode:'vertical',direction,fontScale:1.4,currentId:state.stations[Math.floor(count/2)].id});
    const scene = R.metrics(state,measure);
    assert.equal(scene.output.height,768,'密集站点也须在固定3格高度内排版');
    assert.ok(!JSON.stringify(scene).includes('NaN'));
    scene.nodes.filter(n=>n.bounds).forEach(n=> {
      const b=inkBox(n);
      assert.ok(b.x>=0 && b.x+b.width<=scene.width+.01 && b.y>=0 && b.y+b.height<=scene.height+.01, n.text||n.label);
    });
    scene.columns.forEach(c=>{
      assert.equal(c.positions.length,count);
      const stops=scene.elements.filter(e=>e.kind==='vertical-station'&&e.key.startsWith('vertical:'+c.side+':')).sort((a,b)=>a.box.y-b.box.y);
      stops.forEach((e,i)=>{
        assert.ok(e.box.y>=72&&e.box.y+e.box.height<=scene.height+.01,'站点主体须避开顶栏并在固定高度内');
        if(i)assert.ok(stops[i-1].box.y+stops[i-1].box.height<=e.box.y+.01,'固定高度下相邻站点不得重叠');
      });
    });
  }
});

test('旧自动高度迁移至3格，自定义固定高度、选项和偏移保持往返', () => {
  const old = createStationProject(S); delete old.verticalVariant; delete old.verticalSwapped;
  old.sizes.vertical = {width:768,height:2048};old.verticalHeightAuto=true;
  const restored = S.deserialize(S.serialize(old));
  assert.equal(restored.verticalVariant,'left'); assert.equal(restored.verticalSwapped,false);
  assert.deepEqual(restored.sizes.vertical,{width:384,height:768});
  assert.equal(S.settings(restored,{verticalVariant:'invalid'}).verticalVariant,'left');
  const ref=createVerticalProject(S), key='vertical:left:'+ref.currentId;
  const moved=S.setElementOffset(ref,key,{x:3,y:-2});
  assert.deepEqual(S.deserialize(S.serialize(moved)).adjustments[key],{x:3,y:-2});
  assert.equal(S.addStation(ref,ref.currentId).verticalLayout,'responsive');
  assert.equal(S.addStation(ref,ref.currentId).sizes.vertical.height,768,'增站保持固定输出高度');
  const custom=S.settings(ref,{sizes:{...ref.sizes,vertical:{width:600,height:1500}},verticalWidthAuto:false});
  assert.equal(custom.verticalHeightAuto,false);
  assert.equal(S.addStation(custom,custom.currentId).sizes.vertical.height,1500,'手动固定高度在编辑后保留');
  assert.deepEqual(S.deserialize(S.serialize(custom)).sizes.vertical,{width:384,height:1500});
  assert.deepEqual(S.settings(custom,{verticalHeightAuto:true}).sizes.vertical,{width:384,height:768});
});
