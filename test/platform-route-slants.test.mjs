import { createStationProject } from './station-data.mjs';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
for(const file of ['core','platform/reference','platform/vertical-reference','platform/state','platform/route','platform/hanging','platform/vertical','platform/render'])(0,eval)(readFileSync(new URL('../js/'+file+'.js',import.meta.url),'utf8'));
const S=PlatformState,R=PlatformRender;
const measure=(t,f,w,s)=>String(t).length*s*.9;
measure.ink=(t,f,w,s)=>({abl:0,abr:measure(t,f,w,s)});measure.ascent=(t,f,w,s)=>s*.8;measure.descent=(t,f,w,s)=>s*.1;
const pts=n=>n.attrs.points.split(' ').map(p=>p.split(',').map(Number));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const boundary=(p,d)=>d===-1?p.slice(1,-1):[p[0],...p.slice(3).reverse()];
function section(points,y){const xs=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if(y>=Math.min(a[1],b[1])&&y<Math.max(a[1],b[1]))xs.push(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]));}return [Math.min(...xs),Math.max(...xs)];}

test('非换乘本站上半条不再露出尖角，下半条仍沿大圆切线斜切',()=>{
 for(const direction of [-1,1])for(const height of [192,256])for(const count of [1,10,40])for(const current of [0,Math.floor(count/2),count-1])for(const offset of [[0,0],[12,-8],[-8,8]]) {
  const stations=Array.from({length:count},(_,i)=>({id:'corner-'+i,code:String(i+1).padStart(2,'0'),zh:'站点',en:'Station',transfers:[]}));
  let state=S.settings(S.replaceStations(createStationProject(S),stations),{direction,currentId:stations[current].id});state=S.setHangingHeight(state,height);state=S.nudgeElement(state,'route:'+state.currentId,...offset);
  const scene=R.metrics(state,measure),geo=PlatformRoute.layout(state),p=pts(scene.nodes.find(n=>n.attrs['data-role']==='active-line-core')),c=scene.nodes.find(n=>n.attrs['data-role']==='current-badge').attrs;
  const cx=c.cx+offset[0],cy=c.cy+offset[1],radius=c.r+c['stroke-width']/2,touchY=cy+radius*Math.SQRT1_2;
  for(const f of [.02,.2,.45,.7,.98]) {
   const y=geo.y+geo.barH*f,edge=section(p,y)[direction===-1?1:0];
   if(y<touchY&&Math.abs(y-cy)<=radius*Math.SQRT1_2) {
    const circleEdge=cx-direction*Math.sqrt(radius*radius-(y-cy)*(y-cy));
    assert.ok(direction*(edge-circleEdge)>=-1e-7,'活动线路色不得超出可见圆边形成尖角');
   } else if(y>=touchY)near(edge,cx+direction*(y-cy-Math.SQRT2*radius));
  }
 }
});
test('非换乘本站的活动色条分界与圆标外缘相切，左右行斜切方向正确',()=>{
 for(const direction of [-1,1])for(const height of [192,256])for(const count of [1,10,40])for(const current of [0,Math.floor(count/2),count-1]) {
  const stations=Array.from({length:count},(_,i)=>({id:'station-'+i,code:String(i+1).padStart(2,'0'),zh:'站点',en:'Station',transfers:[]}));
  let state=S.settings(S.replaceStations(createStationProject(S),stations),{direction,currentId:stations[current].id});state=S.setHangingHeight(state,height);
  const scene=R.metrics(state,measure),core=scene.nodes.find(n=>n.attrs['data-role']==='active-line-core'),circle=scene.nodes.find(n=>n.attrs['data-role']==='current-badge');
  assert.equal(core.tag,'polygon','分界需斜切');const p=pts(core),[a,b]=boundary(p,direction).slice(-2);
  near(b[0]-a[0],direction*(b[1]-a[1]));
  const c=circle.attrs,dx=b[0]-a[0],dy=b[1]-a[1],distance=Math.abs(dy*c.cx-dx*c.cy+b[0]*a[1]-b[1]*a[0])/Math.hypot(dx,dy);
  near(distance,c.r+c['stroke-width']/2);
  assert.ok(direction*(a[0]-c.cx)<0,'切线在当前行车方向一侧');
 }
});
test('文字换乘色块与双语共享 -45° 旋转，墨区仍位于色块内部',()=>{
 for(const direction of [-1,1])for(const count of [1,2,3,6]) {
  let state=S.settings(createStationProject(S),{direction});const id=state.stations[3].id;
  state=S.patchStation(state,id,{transfers:Array.from({length:count},(_,i)=>i%2?{number:'2',color:'#009B77'}:{type:'text',nameZh:'机场线',nameEn:'Airport Line',color:'#0057B8'})});
  const scene=R.metrics(state,measure),cards=scene.nodes.filter(n=>n.attrs['data-station-id']===id&&n.attrs['data-role']==='transfer-text-badge');
  cards.forEach(card=>{
   assert.ok(card.matrix);const m=card.matrix;near(m[0],Math.SQRT1_2);near(m[1],-Math.SQRT1_2);near(m[2],Math.SQRT1_2);near(m[3],Math.SQRT1_2);
   const texts=scene.nodes.filter(n=>n.attrs['data-station-id']===id&&/transfer-text-(zh|en)$/.test(n.attrs['data-role'])&&JSON.stringify(n.matrix)===JSON.stringify(m));assert.equal(texts.length,2);
   for(const n of texts){const b=n.bounds,a=card.attrs;assert.ok(b.x>=a.x&&b.x+b.width<=a.x+a.width);assert.ok(b.y>=a.y&&b.y+b.height<=a.y+a.height);}
  });
 }
});
test('非换乘本站微调后，分界切线跟随可见圆标位置',()=>{
 for(const direction of [-1,1]) {
  let state=createStationProject(S);state=S.patchStation(state,state.currentId,{transfers:[]});state=S.nudgeElement(S.settings(state,{direction}),'route:'+state.currentId,12,-8);
  const scene=R.metrics(state,measure),core=scene.nodes.find(n=>n.attrs['data-role']==='active-line-core'),c=scene.nodes.find(n=>n.attrs['data-role']==='current-badge').attrs,p=pts(core),[a,b]=boundary(p,direction).slice(-2),dx=b[0]-a[0],dy=b[1]-a[1];
  near(Math.abs(dy*(c.cx+12)-dx*(c.cy-8)+b[0]*a[1]-b[1]*a[0])/Math.hypot(dx,dy),c.r+c['stroke-width']/2);
 }
});
function corners(n){const b=n.bounds||{x:n.attrs.x,y:n.attrs.y,width:n.attrs.width,height:n.attrs.height},m=n.matrix||[1,0,0,1,0,0];return [[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]);}
test('首末站、密集线路及混合六换乘的旋转色块不越界且彼此不重叠',()=>{
 for(const direction of [-1,1])for(const height of [192,256])for(const count of [2,10,40])for(const index of [0,count-1])for(const transfers of [1,2,3,6]) {
  const stations=Array.from({length:count},(_,i)=>({id:'stop-'+i,code:String(i+1).padStart(2,'0'),zh:'站点',en:'Station',transfers:[]}));
  let state=S.settings(S.replaceStations(createStationProject(S),stations),{direction});state=S.setHangingHeight(state,height);
  state=S.patchStation(state,stations[index].id,{transfers:Array.from({length:transfers},()=>({type:'text',nameZh:'机场线',nameEn:'Airport Line',color:'#0057B8'}))});
  const scene=R.metrics(state,measure),cards=scene.nodes.filter(n=>n.attrs['data-role']==='transfer-text-badge');
  for(const n of cards)for(const [x,y] of corners(n))assert.ok(x>=0&&x<=scene.width&&y>=0&&y<=scene.height,'rotated badge fits output');
  // Parallel rotated rectangles are disjoint when separated on either local axis.
  for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++){
   const a=cards[i].attrs,b=cards[j].attrs,dx=(a.x+a.width/2)-(b.x+b.width/2),dy=(a.y+a.height/2)-(b.y+b.height/2);
   assert.ok(Math.abs((dx-dy)*Math.SQRT1_2)>(a.width+b.width)/2||Math.abs((dx+dy)*Math.SQRT1_2)>(a.height+b.height)/2,'separate rotated cards');
  }
 }
});
