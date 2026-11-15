import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
for (const file of ['core','platform/vertical-reference','platform/state','platform/vertical']) (0,eval)(readFileSync(new URL('../js/'+file+'.js',import.meta.url),'utf8'));
const S=PlatformState,V=PlatformVertical,Ref=PlatformVerticalReference;
const measure=(s,f,w,size)=>String(s).length*size*.9;
measure.ink=(s,f,w,size)=>({abl:-size*.05,abr:measure(s,f,w,size)-size*.05});
measure.ascent=(s,f,w,size)=>size*.8;measure.descent=(s,f,w,size)=>size*.1;
function inkBox(n) {
  const b=n.bounds,m=n.matrix||[1,0,0,1,0,0];
  const pts=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>[x*m[0]+y*m[2]+m[4],x*m[1]+y*m[3]+m[5]]);
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
  return {left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};
}
test('纵向本站箭头复用顶栏国标路径，三版式、双列交换和行车方向只改变旋转与位置',()=>{
  for(const variant of ['left','right','double'])for(const direction of [-1,1])for(const swapped of [false,true]) {
    const state=S.settings(S.create(),{mode:'vertical',verticalVariant:variant,direction,verticalSwapped:swapped}),scene=V.metrics(state,measure);
    const arrows=scene.nodes.filter(n=>n.attrs['data-role']==='vertical-current-arrow');
    assert.equal(arrows.length,scene.columns.length);
    arrows.forEach((n,i)=>{
      const column=scene.columns[i],m=n.matrix,b=inkBox(n),centerY=(b.top+b.bottom)/2;
      assert.equal(n.tag,'path');assert.equal(n.attrs.d,Ref.header.arrow.d);
      assert.equal(n.attrs['data-direction'],column.direction);
      assert.equal(n.attrs['data-column-side'],column.side);
      assert.equal(n.attrs.fill,SignCore.contrastTextColor(state.color));
      const tipY=12*m[1]+40*m[3]+m[5];
      assert.ok((tipY-centerY)*-column.direction>0,'箭尖随列车方向向上或向下');
      assert.ok(Math.abs(b.right-b.left-32*column.unit)<1e-8);
      assert.ok(Math.abs(b.bottom-b.top-32*column.unit)<1e-8);
      assert.ok(b.left>=0&&b.right<=scene.width&&b.top>=72&&b.bottom<=scene.height);
    });
  }
});
test('纵向本站长站名为标准箭头留出墨区净空，密集线路仍随主体等比缩放',()=>{
  for(const count of [1,11,120])for(const variant of ['left','right','double']) {
    let state=S.replaceStations(S.create(),Array.from({length:count},(_,i)=>({id:'arrow-'+i,zh:'非常长的本站中文站名排版测试',en:'A Very Long Current Station Name with descenders gy'})));
    state=S.settings(state,{mode:'vertical',currentId:state.stations[Math.floor(count/2)].id,verticalVariant:variant,fontScale:1.4});
    const scene=V.metrics(state,measure),arrows=scene.nodes.filter(n=>n.attrs['data-role']==='vertical-current-arrow');
    assert.equal(arrows.length,scene.columns.length);
    arrows.forEach(n=>{
      const a=inkBox(n),key=n.attrs['data-element-key'];
      scene.nodes.filter(n=>n.attrs['data-element-key']===key&&/^vertical-station-(zh|en)$/.test(n.attrs['data-role'])).forEach(n=>{
        const b=inkBox(n);assert.ok(b.right<a.left||b.left>a.right,'完整双语墨区不碰箭头');
      });
    });
  }
});
