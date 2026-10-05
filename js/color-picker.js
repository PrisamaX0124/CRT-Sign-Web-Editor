/** Shared editor colour control. Call sync() after immutable state or city changes. */
(function(global) {
  'use strict';
  var Core=global.SignCore,serial=0;
  function h(tag,attrs,children) {
    var el=document.createElement(tag);
    Object.keys(attrs||{}).forEach(function(key){if(key==='text')el.textContent=attrs[key];else if(attrs[key]!==undefined)el.setAttribute(key,attrs[key]);});
    (children||[]).forEach(function(child){if(child)el.appendChild(child);});return el;
  }
  function create(opts) {
    var value=opts.value||null,city=opts.getCity(),scope=opts.scope||'颜色',nullable=!!opts.nullable,swatchBtns=[];
    var current=h('button',{type:'button',class:'cp-current','aria-label':scope+'：展开色板'});
    var hex=h('input',{id:opts.hexId,class:'hex-input',type:'text',spellcheck:'false',placeholder:'#RRGGBB',maxlength:'7','aria-label':scope+'十六进制值'});
    var native=h('input',{id:opts.nativeId,class:'cp-native',type:'color',title:'自定义'+scope,'aria-label':'自定义'+scope});
    var nullBtn=nullable?h('button',{type:'button',class:'cp-null-btn',text:'透明',title:'清除'+scope+'（透明）','aria-label':scope+'设为透明'}):null;
    function paint() {
      var idle=document.activeElement!==hex;
      current.classList.toggle('nullable-null',value===null);
      if(value===null){current.removeAttribute('style');if(idle)hex.value='';}
      else{current.style.background=value;if(idle)hex.value=value;native.value=value;}
      if(nullBtn)nullBtn.classList.toggle('active',value===null);
      swatchBtns.forEach(function(b){var active=b.dataset.color===value;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    }
    function commit(v){value=v;paint();if(opts.onChange)opts.onChange(v);}
    hex.addEventListener('input',function(){
      var raw=hex.value.trim(),v=raw&&raw.charAt(0)!=='#'?'#'+raw:raw;
      if(Core.isHexColor(v)){hex.classList.remove('invalid');commit(Core.normalizeHex(v));}
      else hex.classList.toggle('invalid',raw.length>0);
    });
    hex.addEventListener('blur',paint);
    native.addEventListener('input',function(){commit(Core.normalizeHex(native.value));});
    if(nullBtn)nullBtn.addEventListener('click',function(){commit(null);});
    var citySelect=h('select',{class:'cp-city-select',title:'按城市调整选色板线路配色','aria-label':scope+'色板城市'});
    Core.PALETTE_CITY_ORDER.forEach(function(key){citySelect.appendChild(h('option',{value:key,text:Core.CITY_PALETTES[key].name+'线路配色'}));});
    citySelect.addEventListener('change',function(){opts.onCityChange(citySelect.value);});
    var swatches=h('div',{id:opts.swatchesId,class:'cp-swatches','aria-label':scope+'快捷色板'});
    function renderSwatches(){
      swatchBtns=[];swatches.replaceChildren();citySelect.value=city;
      Core.citySwatches(city).forEach(function(c){
        var b=h('button',{type:'button',class:'cp-swatch',title:c.name,'aria-label':c.name,'data-color':c.bg,style:'background:'+c.bg});
        b.addEventListener('click',function(){commit(c.bg);});swatches.appendChild(b);swatchBtns.push(b);
      });paint();
    }
    var detailsId='color-options-'+(++serial),details=h('details',{class:'cp-options',id:detailsId},[h('summary',{text:'展开色板'}),citySelect,swatches]);
    current.setAttribute('aria-controls',detailsId);current.setAttribute('aria-expanded','false');
    function paintToggle(){current.title=scope+(details.open?'：收起色板':'：展开色板');current.setAttribute('aria-label',current.title);current.setAttribute('aria-expanded',String(details.open));}
    details.addEventListener('toggle',paintToggle);current.addEventListener('click',function(){details.open=!details.open;paintToggle();});
    var row=h('div',{class:'cp-row'},[current,hex,native,nullBtn]),root=h('div',{class:'color-picker'+(opts.mini?' mini':''),'data-scope':scope},[row,details]);
    root.sync=function(){
      var nextCity=opts.getCity();if(nextCity!==city){city=nextCity;renderSwatches();}
      if(opts.getValue){var next=opts.getValue()||null;if(next!==value){value=next;paint();}}
    };
    renderSwatches();paintToggle();return root;
  }
  global.SignColorPicker={create:create};
})(typeof window!=='undefined'?window:globalThis);
