import { createStationProject } from './station-data.mjs';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
for (const file of ['core','platform/reference','platform/state','platform/route','platform/hanging','platform/render']) (0,eval)(readFileSync(new URL('../js/'+file+'.js',import.meta.url),'utf8'));
const S=PlatformState,R=PlatformRender;
const measure=(t,f,w,s)=>String(t).length*s*.9;
measure.ink=(t,f,w,s)=>({abl:-s*.05,abr:measure(t,f,w,s)-s*.05});
measure.ascent=(t,f,w,s)=>s*.8;measure.descent=(t,f,w,s)=>s*.1;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} ≠ ${b}`);

test('本站 SVG 留白回归：邻站靠两端，离开横线；双语与方向提示保留参考间距',()=>{
  for(const height of [192,256])for(const direction of [-1,1]) {
    const state=S.setHangingHeight(S.settings(createStationProject(S),{mode:'station',direction}),height),scene=R.metrics(state,measure),u=height/384;
    const title=scene.nodes.filter(n=>n.attrs['data-element-key']==='station:title');
    near(title[0].bounds.y,22.2812*u);
    assert.ok(title[1].bounds.y-title[0].bounds.y-title[0].bounds.height>=16.34*u);
    const bar=scene.nodes.find(n=>n.attrs['data-role']==='passed-line');
    for(const [key,center] of [['station:left',166.1623/1024],['station:right',883.9865/1024]]) {
      const nodes=scene.nodes.filter(n=>n.attrs['data-element-key']===key);
      near(nodes[0].bounds.y,bar.attrs.y+bar.attrs.height+17.055*u);
      nodes.forEach(n=>near(n.bounds.x+n.bounds.width/2,scene.width*center));
      assert.ok(nodes[1].bounds.y-nodes[0].bounds.y-nodes[0].bounds.height>=10.7*u);
    }
    const hint=scene.elements.find(e=>e.key==='station:direction');
    assert.ok(scene.height-hint.box.y-hint.box.height>=22.897*u-1e-6,'提示应有参考图约6%的底边留白');
    for(const key of ['station:left','station:right']) {
      const b=scene.elements.find(e=>e.key===key).box;
      assert.ok(b.x+b.width+height*.025<=hint.box.x+1e-6||hint.box.x+hint.box.width+height*.025<=b.x+1e-6,'邻站和中央提示应横向留出净空');
    }
  }
});
