import {readFileSync,existsSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const context=vm.createContext({crypto:{randomUUID:()=>Math.random().toString(36).slice(2)}});
for(const f of ['core','palettes','platform/reference','platform/vertical-reference','platform/state','platform/route','platform/hanging','platform/vertical','platform/render']) {
  const p=new URL('../js/'+f+'.js',import.meta.url);if(existsSync(p))vm.runInContext(readFileSync(p,'utf8'),context);
}
const C=context.SignCore,S=context.PlatformState,R=context.PlatformRender;
const measure=(t,f,w,s)=>String(t).length*s*.9;
measure.ink=(t,f,w,s)=>({abl:s*.03,abr:measure(t,f,w,s)});
measure.ascent=(t,f,w,s)=>s*.8;measure.descent=(t,f,w,s)=>s*.1;
test('北京色卡的19项HEX与数字、命名线路别名一致',()=>{
 const expected=['#A4343A','#004B87','#008C95','#AA0061','#B58500','#FFC56E','#009B77','#97D700','#0092BC','#F4DA40','#CA9A8E','#653279','#6BA539','#D986BA','#D86018','#A192B2','#D22630','#D0006F','#A45A2A'];
 assert.ok(C.CITY_PALETTES.beijing);assert.deepEqual(Array.from(C.citySwatches('beijing').slice(0,19),c=>c.bg),expected);
 for(const [name,color] of [['1','#A4343A'],['八通线','#A4343A'],['大兴线','#008C95'],['燕房线','#D86018'],['昌平线','#D986BA'],['S1线','#A45A2A']])assert.equal(C.lineColorFor(name,'beijing').bg,color);
 assert.equal(S.parseTransfers('昌平线~Changping Line','beijing')[0].color,'#D986BA');
});
test('自定义色板不可变增删、严格校验，导入生成独立ID，项目保留选择',()=>{
 const P=context.SignPalettes;assert.ok(P);
 const empty=[],data=P.upsert(empty,{name:'我的线路',entries:[{name:'1号线',color:'#abc'},{name:'机场线',color:'#008c95'}]});
 assert.equal(empty.length,0);assert.equal(data[0].entries[0].color,'#AABBCC');
 const snapshot=JSON.stringify(data),edited=P.upsert(data,{...data[0],name:'新名称'});
 assert.equal(JSON.stringify(data),snapshot);assert.equal(edited[0].id,data[0].id);
 assert.equal(P.removeData(edited,edited[0].id).length,0);
 assert.throws(()=>P.upsert(data,{name:'',entries:data[0].entries}));
 assert.throws(()=>P.upsert(data,{name:'错误',entries:[{name:'颜色',color:'red'}]}));
 assert.throws(()=>P.upsert(data,{name:'空白',entries:[]}));
 const imported=P.mergeJSON(data,P.serialize(data));assert.equal(imported.length,2);assert.notEqual(imported[0].id,imported[1].id);
 const saved=P.save(data[0]);assert.equal(C.lineColorFor('1',saved.id).bg,'#AABBCC');assert.equal(C.lineColorFor('机场线',saved.id).bg,'#008C95');
 assert.equal(C.citySwatches(saved.id)[0].name,'1号线');assert.ok(C.paletteOptions().some(p=>p.id===saved.id));
 const state=S.settings(S.create(),{city:saved.id});assert.equal(S.deserialize(S.serialize(state)).city,saved.id);
 P.remove(saved.id);assert.equal(C.isPalette(saved.id),false);
});
test('命名线路墨区与圆边、分隔线留白：全部圆标版式、长名称和尺寸',()=>{
 for(const name of ['龙狗','机场线','四字线路','很长的文字线路名称'])for(const mode of ['route','station','vertical'])for(const variant of (mode==='vertical'?['left','right','double']:['left']))for(const scale of [.5,1,2]) {
  let state=S.settings(S.create(),{line:name,mode,verticalVariant:variant});
  state=S.settings(state,{sizes:{...state.sizes,[mode]:{width:state.sizes[mode].width*scale,height:state.sizes[mode].height*scale}}});
  const scene=R.metrics(state,measure),n=scene.nodes.find(n=>n.attrs['data-role']===(mode==='vertical'?'vertical-badge-line':'badge-line'));
  const circle=scene.nodes.find(n=>n.attrs['data-role']===(mode==='vertical'?'vertical-badge':'current-badge'));
  assert.ok(circle,mode);let b=n.bounds;
  if(n.matrix){const m=n.matrix;b={x:b.x*m[0]+m[4],y:b.y*m[3]+m[5],width:b.width*m[0],height:b.height*m[3]};}
  const a=circle.attrs,r=a.r;
  for(const x of [b.x,b.x+b.width])for(const y of [b.y,b.y+b.height])assert.ok(Math.hypot(x-a.cx,y-a.cy)<=r*.9+1e-6,name+' '+mode+' circular clearance');
  assert.ok(b.y+b.height<=a.cy-r*.1+1e-6,name+' '+mode+' divider gap');
  assert.equal(n.attrs['font-family'],C.FONT_ZH);assert.equal(n.attrs['font-weight'],400);
 }
});
