/** One shared palette manager for both editors. Edits stay in a draft until saved. */
(function(global){
  'use strict';
  var Core=global.SignCore,P=global.SignPalettes,dialog;
  function h(tag,attrs,children){var el=document.createElement(tag);Object.keys(attrs||{}).forEach(function(k){if(k==='text')el.textContent=attrs[k];else el.setAttribute(k,attrs[k]);});(children||[]).forEach(function(c){el.appendChild(c);});return el;}
  function button(text,cls,fn,label){var b=h('button',{type:'button',class:cls||'btn',text:text});if(label)b.setAttribute('aria-label',label);b.addEventListener('click',fn);return b;}
  function open(opts){
    if(dialog&&dialog.open)return;
    if(dialog)dialog.remove();
    var draft,dirty=false;
    dialog=h('dialog',{class:'pm-dialog','aria-labelledby':'pm-title'});
    dialog.addEventListener('keydown',function(event){event.stopPropagation();});
    var status=h('p',{class:'pm-status',role:'status','aria-live':'polite'});
    function message(value,error){status.textContent=value;status.classList.toggle('error',!!error);}
    var title=h('h2',{id:'pm-title',text:'自定义调色板'});
    var heading=h('div',{class:'pm-heading'},[h('div',{},[title,h('p',{text:'保存一套常用线路颜色，两个编辑器都能使用。'})]),button('×','pm-close',function(){dialog.close();},'关闭调色板管理')]);
    var list=h('div',{class:'pm-list','aria-label':'已保存的自定义色板'});
    var name=h('input',{id:'pm-name',type:'text',maxlength:'40',placeholder:'例如：我的线路配色',autocomplete:'off'});
    name.addEventListener('input',function(){draft.name=name.value;dirty=true;});
    var count=h('span',{class:'pm-count'}),rows=h('div',{class:'pm-rows'});
    var remove=button('删除色板','btn pm-delete',function(){
      if(!draft.id||!global.confirm('删除“'+draft.name+'”？已应用到标识牌的颜色会保留。'))return;
      try{P.remove(draft.id);newDraft();message('色板已删除');}catch(e){message('保存失败：'+e.message,true);}
    });
    function canSwitch(){return !dirty||global.confirm('当前修改尚未保存，放弃修改？');}
    function preview(p){return h('div',{class:'pm-preview'},p.entries.slice(0,7).map(function(c){return h('span',{style:'background:'+c.color});}));}
    function renderList(){
      list.replaceChildren();var palettes=P.list();
      if(!palettes.length)list.appendChild(h('p',{class:'pm-empty',text:'还没有自定义色板。新建一套，或复制当前配色开始编辑。'}));
      palettes.forEach(function(p){var b=button('','pm-card',function(){if(canSwitch())load(p);});b.classList.toggle('active',p.id===draft.id);b.setAttribute('aria-pressed',String(p.id===draft.id));b.append(h('strong',{text:p.name}),h('span',{text:p.entries.length+' 个颜色'}),preview(p));list.appendChild(b);});
    }
    function renderRows(){
      rows.replaceChildren();count.textContent=draft.entries.length+' / 64';
      draft.entries.forEach(function(c,i){
        var prefix='pm-entry-'+i;
        var color=h('input',{class:'pm-color',type:'color',value:Core.normalizeHex(c.color)||'#000000','aria-label':'颜色 '+(i+1)});
        var label=h('input',{id:prefix+'-name',type:'text',value:c.name,maxlength:'40',placeholder:'1号线 / 线路名',autocomplete:'off'});
        var hex=h('input',{id:prefix+'-hex',class:'pm-hex',type:'text',value:c.color,maxlength:'7',spellcheck:'false'});
        label.addEventListener('input',function(){c.name=label.value;dirty=true;});
        color.addEventListener('input',function(){c.color=Core.normalizeHex(color.value);hex.value=c.color;hex.classList.remove('invalid');dirty=true;});
        hex.addEventListener('input',function(){var raw=hex.value.trim();c.color=raw.charAt(0)==='#'?raw:'#'+raw;var valid=Core.normalizeHex(c.color);hex.classList.toggle('invalid',!valid);if(valid)color.value=valid;dirty=true;});
        hex.addEventListener('blur',function(){var valid=Core.normalizeHex(c.color);if(valid){c.color=valid;hex.value=valid;}});
        var up=button('↑','pm-row-btn',function(){var item=draft.entries.splice(i,1)[0];draft.entries.splice(i-1,0,item);dirty=true;renderRows();},'上移颜色 '+(i+1));up.disabled=i===0;
        var down=button('↓','pm-row-btn',function(){var item=draft.entries.splice(i,1)[0];draft.entries.splice(i+1,0,item);dirty=true;renderRows();},'下移颜色 '+(i+1));down.disabled=i===draft.entries.length-1;
        var del=button('×','pm-row-btn pm-row-delete',function(){draft.entries.splice(i,1);dirty=true;renderRows();},'删除颜色 '+(i+1));del.disabled=draft.entries.length===1;
        rows.appendChild(h('div',{class:'pm-row'},[color,h('div',{class:'pm-name-field'},[h('label',{for:prefix+'-name',text:'颜色名称'}),label]),h('div',{class:'pm-hex-field'},[h('label',{for:prefix+'-hex',text:'HEX'}),hex]),h('div',{class:'pm-row-actions'},[up,down,del])]));
      });
      add.disabled=draft.entries.length>=64;
    }
    function load(p){draft=Core.deepClone(p);dirty=false;name.value=draft.name;remove.hidden=!draft.id;renderList();renderRows();message('');}
    function newDraft(){load({name:'',entries:[{name:'1号线',color:'#2563EB'},{name:'2号线',color:'#009B77'},{name:'3号线',color:'#F2A900'}]});name.focus();}
    var add=button('＋ 添加颜色','btn pm-add',function(){draft.entries.push({name:'颜色 '+(draft.entries.length+1),color:'#424A52'});dirty=true;renderRows();rows.lastElementChild.querySelector('input[type=text]').focus();});
    var editor=h('section',{class:'pm-editor','aria-label':'编辑调色板'},[
      h('div',{class:'pm-title-field'},[h('label',{for:'pm-name',text:'色板名称'}),name]),
      h('div',{class:'pm-rows-heading'},[h('strong',{text:'颜色列表'}),count]),
      h('p',{class:'pm-help',text:'线路名称可用于自动配色；共线名称用 / 分隔。'}),rows,add,remove]);
    var create=button('＋ 新建色板','btn btn-primary',function(){if(canSwitch())newDraft();});
    var duplicate=button('复制当前色板','btn',function(){if(!canSwitch())return;var id=opts.getCity(),def=Core.paletteDefinition(id);load({name:(def?def.name:'当前配色')+' · 副本',entries:Core.citySwatches(id).map(function(c){return {name:c.name,color:c.bg};})});dirty=true;});
    var importFile=h('input',{type:'file',accept:'.json,application/json',hidden:'','aria-label':'导入自定义色板文件'});
    importFile.addEventListener('change',async function(){
      var file=importFile.files[0];if(!file)return;
      try{if(file.size>256*1024)throw new Error('色板文件过大');var previous=P.list().length,next=P.importJSON(await file.text());renderList();message('已导入 '+(next.length-previous)+' 套色板');}catch(e){message('导入失败：'+e.message,true);}finally{importFile.value='';}
    });
    var importBtn=button('导入 JSON','btn',function(){importFile.click();});
    var exportBtn=button('导出全部','btn',function(){
      var palettes=P.list();if(!palettes.length){message('请先保存一套色板',true);return;}
      var url=URL.createObjectURL(new Blob([P.serialize(palettes)],{type:'application/json'})),a=h('a',{href:url,download:'自定义调色板.json'});dialog.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);message('已导出 '+palettes.length+' 套已保存的色板');
    });
    function save(use){
      try{draft.name=name.value;var saved=P.save(draft);load(saved);message('已保存到本机，可在两个编辑器中使用');if(use){opts.onSelect(saved.id);dialog.close();}}
      catch(e){message('保存失败：'+e.message,true);}
    }
    var sidebar=h('aside',{class:'pm-sidebar'},[h('div',{class:'pm-sidebar-actions'},[create,duplicate]),h('h3',{text:'我的色板'}),list,h('div',{class:'pm-file-actions'},[importBtn,exportBtn,importFile])]);
    dialog.append(heading,h('div',{class:'pm-body'},[sidebar,editor]),h('div',{class:'pm-footer'},[status,h('div',{class:'pm-footer-actions'},[button('取消','btn',function(){dialog.close();}),button('保存','btn',function(){save(false);}),button('保存并使用','btn btn-primary',function(){save(true);})])]));
    document.body.appendChild(dialog);
    var existing=P.get(opts.getCity());if(existing)load(existing);else newDraft();
    dialog.showModal();name.focus();
  }
  global.SignPaletteManager={open:open};
})(typeof window!=='undefined'?window:globalThis);
