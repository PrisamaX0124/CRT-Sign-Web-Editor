/* Modified by PrisamaX0124, 2026-10-06: text lines, custom and Beijing palettes, badge ink fitting, railway icon, station glyphs and public release data separation; see docs/fork-changes.md. */
/** Shared custom palettes: immutable data operations, local persistence and cross-tab updates. */
(function(global){
  'use strict';
  var Core=global.SignCore,KEY='public-sign-custom-palettes',data=[],revision=0;
  function copy(value){return Core.deepClone(value);}
  function clean(p) {
    if(!p||typeof p.name!=='string'||!p.name.trim()||p.name.trim().length>40)throw new Error('请输入 1–40 字的色板名称');
    if(!Array.isArray(p.entries)||!p.entries.length||p.entries.length>64)throw new Error('每套色板需包含 1–64 个颜色');
    return {id:typeof p.id==='string'&&/^custom-[\w-]{1,80}$/.test(p.id)?p.id:'custom-'+Core.uuid(),name:p.name.trim(),entries:p.entries.map(function(c){
      var color=c&&Core.normalizeHex(c.color);
      if(!c||typeof c.name!=='string'||!c.name.trim()||c.name.trim().length>40||!color)throw new Error('每个颜色需填写名称和有效的 HEX 色值');
      return {name:c.name.trim(),color:color};
    })};
  }
  function upsert(values,palette) {
    var next=copy(values),p=clean(palette),index=next.findIndex(function(v){return v.id===p.id;});
    if(index<0){if(next.length>=20)throw new Error('最多保存 20 套自定义色板');next.push(p);}else next[index]=p;
    return next;
  }
  function removeData(values,id){return copy(values.filter(function(p){return p.id!==id;}));}
  function serialize(values){return JSON.stringify({kind:'sign-palettes',version:1,palettes:copy(values)},null,2);}
  function parse(raw){
    var value=JSON.parse(raw);
    if(!value||value.kind!=='sign-palettes'||value.version!==1||!Array.isArray(value.palettes)||value.palettes.length>20)throw new Error('请选择有效的自定义色板 JSON 文件');
    var result=[];value.palettes.forEach(function(p){var c=clean(p);if(result.some(function(v){return v.id===c.id;}))throw new Error('色板 ID 重复');result.push(c);});return result;
  }
  function mergeJSON(values,raw){var next=copy(values);parse(raw).forEach(function(p){p.id='custom-'+Core.uuid();next=upsert(next,p);});return next;}
  function notify(){revision++;if(global.dispatchEvent)global.dispatchEvent(new global.Event('sign-palettes-change'));}
  function persist(next){
    // Write first: a quota/privacy error leaves the visible registry unchanged.
    if(global.localStorage)global.localStorage.setItem(KEY,serialize(next));
    data=next;notify();
  }
  function save(p){var next=upsert(data,p),id=next.find(function(v){return v.id===p.id;});if(!id)id=next[next.length-1];persist(next);return copy(id);}
  function remove(id){persist(removeData(data,id));}
  function importJSON(raw){var next=mergeJSON(data,raw);persist(next);return copy(next);}
  try{if(global.localStorage){var raw=global.localStorage.getItem(KEY);if(raw)data=parse(raw);}}catch(e){data=[];}
  if(global.addEventListener)global.addEventListener('storage',function(e){if(e.key!==KEY&&e.key!==null)return;try{data=e.newValue?parse(e.newValue):[];notify();}catch(ignore){/* Ignore malformed cross-tab writes. */}});
  global.SignPalettes={list:function(){return copy(data);},get:function(id){var p=data.find(function(p){return p.id===id;});return p?copy(p):null;},revision:function(){return revision;},upsert:upsert,removeData:removeData,serialize:serialize,mergeJSON:mergeJSON,save:save,remove:remove,importJSON:importJSON};
})(typeof window!=='undefined'?window:globalThis);
