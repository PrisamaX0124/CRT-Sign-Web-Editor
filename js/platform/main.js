/* Modified by PrisamaX0124, 2026-10-06: text lines, custom and Beijing palettes, badge ink fitting, railway icon, station glyphs and public release data separation; see docs/fork-changes.md. */
(function (global) {
  'use strict';
  var S = global.PlatformState, R = global.PlatformRender, Core = global.SignCore, P = global.PlatformPresets;
  var KEY = 'public-platform-sign-project-v1', undo = [], redo = [], groupKey = null, groupTime = 0;
  var HISTORY_LIMIT = 20;
  var PRESET_KEY = 'public-platform-sign-presets-v1', presets = [], presetSignature = '', library = 'stations';
  var saveTimer, noticeTimer, listSignature = '', transferSignature = '', layoutMode = '', busy = false;
  var basePickers=[],transferPickers=[],paletteRevision=-1;
  var names = { route: '全线吊板', station: '本站吊板', vertical: '纵向线路图' };
  function $(id) { return document.getElementById(id); }
  function notice(message) {
    $('platform-notice').textContent = message; $('platform-notice').hidden = false;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(function () { $('platform-notice').hidden = true; }, 4200);
  }
  var initial;
  try { var saved = localStorage.getItem(KEY); initial = saved ? S.deserialize(saved) : S.create(); }
  catch (err) { initial = S.create(); notice('未能恢复本地项目：' + err.message); }
  try { presets = P.deserialize(localStorage.getItem(PRESET_KEY) || '[]'); }
  catch (err) { notice('未能恢复预设：' + err.message); }
  var App = global.App = {
    state: initial, selectedId: initial.currentId, selectedKey: null, selectionKeys: [], anchorKey: null, hoverKey: null, panelView: 'sign', measure: Core.createCanvasMeasurer(), scene: null,
    update: function (fn, key, options) {
      var next = fn(App.state);
      if (JSON.stringify(next) === JSON.stringify(App.state)) return;
      var now = Date.now();
      if (!(key && key === groupKey && now - groupTime < 800)) {
        undo.push(snapshot()); if (undo.length > HISTORY_LIMIT) undo.shift();
      }
      groupKey = key || null; groupTime = now; redo = [];
      var previous = App.state; App.state = next;
      if (!live()) App.selectedId = next.currentId;
      if (options && options.selectNew) {
        App.selectionKeys = next.stations.filter(function (s) { return !previous.stations.some(function (old) { return old.id === s.id; }); }).map(function (s) { return stationKey(s.id, next); });
        App.selectedKey = App.selectionKeys[App.selectionKeys.length - 1] || null; App.anchorKey = App.selectionKeys[0] || null; App.panelView = 'station';
      }
      if (options && options.clearSelection) { App.selectionKeys = []; App.selectedKey = App.anchorKey = null; App.panelView = 'sign'; }
      render(); scheduleSave();
    },
    select: function (id, modifiers) {
      if (!App.state.stations.some(function (s) { return s.id === id; })) return;
      var options = Object.assign({}, modifiers, { order: App.state.stations.map(function (s) { return stationKey(s.id); }) });
      App.selectElement(stationKey(id), options);
    },
    selectElement: function (key, modifiers) {
      if (!S.validElementKey(key, App.state.stations)) return;
      var options = modifiers || {}, keys = App.selectedKeys(), anchor = App.anchorKey;
      if (options.range && anchor) {
        var order = options.order || App.elementOrder(), a = order.indexOf(anchor), b = order.indexOf(key);
        if (a >= 0 && b >= 0) { var range = order.slice(Math.min(a, b), Math.max(a, b) + 1); App.selectMany(options.toggle ? keys.concat(range) : range, key, anchor); return; }
      }
      if (options.toggle) {
        var index = keys.indexOf(key); if (index >= 0) keys.splice(index, 1); else keys.push(key);
        App.selectMany(keys, index >= 0 ? keys[keys.length - 1] : key);
      } else App.selectMany([key], key);
    },
    selectedKeys: function () { return App.selectionKeys.filter(function (key, i, keys) { return keys.indexOf(key) === i && S.validElementKey(key, App.state.stations) && (findElement(key) || (App.state.mode === 'station' && key === 'route:' + stationIdFromKey(key))); }); },
    selectedStationIds: function () {
      var keys = App.selectedKeys();
      return App.state.stations.filter(function (s) { return keys.some(function (key) {
        if (['route:', 'vertical:left:', 'vertical:right:', 'vertical:transfer:'].some(function (prefix) { return key === prefix + s.id; })) return true;
        var item = findElement(key); return item && item.stationId === s.id && ['station-name', 'neighbor'].indexOf(item.kind) >= 0;
      }); }).map(function (s) { return s.id; });
    },
    selectMany: function (keys, primary, anchor) {
      App.selectionKeys = keys.filter(function (key, i) { return keys.indexOf(key) === i && S.validElementKey(key, App.state.stations); });
      App.selectionKeys = App.selectedKeys();
      App.selectedKey = App.selectionKeys.indexOf(primary) >= 0 ? primary : App.selectionKeys[App.selectionKeys.length - 1] || null;
      App.anchorKey = anchor || App.selectedKey;
      var item = findElement(App.selectedKey), id = item && item.stationId || stationIdFromKey(App.selectedKey);
      if (id) App.selectedId = id;
      App.panelView = App.selectedKey ? 'station' : 'sign'; App.hoverKey = null;
      groupKey = null; sync(); paintInteraction();
    },
    elementOrder: function () { return App.scene.elements.map(function (item) { return item.key; }); },
    selectAll: function () { App.selectMany(App.elementOrder(), App.selectedKey); },
    selectAllStations: function () { App.selectMany(App.state.stations.map(function (s) { return stationKey(s.id); }), App.selectedKey); },
    deselect: function () { App.selectMany([]); },
    deleteSelection: function () {
      var ids = App.selectedStationIds(); if (!ids.length) return;
      if (App.state.stations.length <= 1) { notice('至少保留一个站点'); return; }
      var all = ids.length === App.state.stations.length;
      App.update(function (state) { return S.removeStations(state, ids); }, null, { clearSelection: true });
      if (all) notice('已删除选中站点，并保留本站');
    },
    undo: function () { history(undo, redo); }, redo: function () { history(redo, undo); },
    download: function (blob, filename) {
      var url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 15000);
    },
    render: render,
  };
  function live() { return App.state.stations.find(function (s) { return s.id === App.selectedId; }); }
  function snapshot() { return { state: App.state, selectedId: App.selectedId, selectedKey: App.selectedKey, selectionKeys: App.selectedKeys(), anchorKey: App.anchorKey, panelView: App.panelView }; }
  function findElement(key) { return App.scene && (App.scene.elements || []).find(function (item) { return item.key === key; }); }
  function stationIdFromKey(key) { var s = App.state.stations.find(function (s) { return key === 'route:' + s.id || key === 'vertical:left:' + s.id || key === 'vertical:right:' + s.id || key === 'vertical:transfer:' + s.id; }); return s ? s.id : null; }
  function stationKey(id, state) {
    state = state || App.state;
    if (state.mode === 'route') return 'route:' + id;
    if (state.mode === 'vertical') return 'vertical:' + (state.verticalVariant === 'right' ? 'right:' : 'left:') + id;
    if (id === state.currentId) return 'station:title';
    var near = S.neighbors(state), left = state.direction === -1 ? near.next : near.previous, right = state.direction === 1 ? near.next : near.previous;
    return left && left.id === id ? 'station:left' : right && right.id === id ? 'station:right' : 'route:' + id;
  }
  function history(from, to) {
    if (!from.length) return;
    to.push(snapshot());
    if (to.length > HISTORY_LIMIT) to.shift();
    var old = from.pop(); App.state = Core.isPalette(old.state.city) ? old.state : S.settings(old.state,{city:'chongqing'}); App.selectedId = old.selectedId; App.selectedKey = old.selectedKey; App.selectionKeys = old.selectionKeys; App.anchorKey = old.anchorKey; App.panelView = old.panelView; groupKey = null;
    render(); scheduleSave();
  }
  function flushSave() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(KEY, S.serialize(App.state)); $('save-status').textContent = '已自动保存到本机'; }
    catch (err) { $('save-status').textContent = '自动保存失败，请保存项目 JSON'; }
  }
  function scheduleSave() { $('save-status').textContent = '保存中…'; clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 500); }
  global.addEventListener('pagehide', flushSave);
  global.addEventListener('beforeunload', flushSave);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flushSave(); });
  function value(id, v) { if (document.activeElement !== $(id)) $(id).value = v; }
  function set(patch, key) { App.update(function (state) { return S.settings(state, patch); }, key); }
  function patchStation(patch, key) { App.update(function (state) { return S.patchStation(state, App.selectedId, patch); }, key); }
  function render() {
    App.scene = R.metrics(App.state, App.measure); R.draw($('platform-svg'), App.scene);
    App.selectionKeys = App.selectedKeys();
    if (App.selectionKeys.indexOf(App.selectedKey) < 0) App.selectedKey = App.selectionKeys[App.selectionKeys.length - 1] || null;
    if (!App.selectedKey) App.panelView = 'sign';
    var selected = findElement(App.selectedKey);
    var id = selected && selected.stationId || stationIdFromKey(App.selectedKey); if (id) App.selectedId = id;
    if (!S.validElementKey(App.anchorKey, App.state.stations)) App.anchorKey = App.selectedKey;
    sync(); fitPreview();
  }
  function fitPreview() {
    if (!App.scene) return;
    var size = App.scene.output, box = $('platform-preview-scroll'), mode = $('preview-zoom').value;
    var pad = 32;
    var scale = mode === 'fit' ? Math.max(0.01, Math.min(App.state.mode === 'vertical' ? 1 : 3, (box.clientWidth - pad) / size.width, (box.clientHeight - pad) / size.height)) : Number(mode);
    $('platform-svg').style.width = size.width * scale + 'px'; $('platform-svg').style.height = size.height * scale + 'px';
    paintInteraction();
  }
  function paintInteraction() {
    if (!App.scene) return;
    var svg = $('platform-svg'), scale = svg.getBoundingClientRect().width / App.scene.output.width, frame = App.scene.frame;
    function outline(el, key) {
      var item = findElement(key); el.hidden = !item; if (!item) return;
      var b = item.box;
      el.style.left = ((b.x * frame.scale + frame.x) * scale - 3) + 'px';
      el.style.top = ((b.y * frame.scale + frame.y) * scale - 3) + 'px';
      el.style.width = (b.width * frame.scale * scale + 6) + 'px'; el.style.height = (b.height * frame.scale * scale + 6) + 'px';
    }
    var keys = App.selectedKeys();
    outline($('element-hover-outline'), keys.indexOf(App.hoverKey) >= 0 ? null : App.hoverKey);
    outline($('element-selection-outline'), App.selectedKey);
    var extra = keys.filter(function (key) { return key !== App.selectedKey && findElement(key); }), layer = $('element-multi-outlines');
    while (layer.children.length > extra.length) layer.lastChild.remove();
    while (layer.children.length < extra.length) { var box = document.createElement('div'); box.className = 'platform-element-outline selected'; layer.appendChild(box); }
    extra.forEach(function (key, i) { outline(layer.children[i], key); });
    var toolbar = $('platform-element-toolbar'), item = findElement(App.selectedKey); toolbar.hidden = !item; if (!item) return;
    $('toolbar-element-label').textContent = keys.length > 1 ? '已选 ' + keys.length + ' 个元素' : item.label;
    var stationIds = App.selectedStationIds(), hasStation = !!stationIds.length, singleStation = stationIds.length === 1, index = App.state.stations.findIndex(function (s) { return s.id === item.stationId; });
    ['tool-current', 'tool-up', 'tool-down', 'tool-delete'].forEach(function (id) { $(id).hidden = !hasStation; });
    $('tool-current').disabled = !singleStation || stationIds[0] === App.state.currentId;
    $('tool-up').disabled = !singleStation || index <= 0; $('tool-down').disabled = !singleStation || index >= App.state.stations.length - 1; $('tool-delete').disabled = App.state.stations.length <= 1;
    var anchor = $('element-selection-outline').getBoundingClientRect(), area = document.querySelector('.platform-preview').getBoundingClientRect(), viewport = $('platform-preview-scroll').getBoundingClientRect();
    if (anchor.bottom < viewport.top || anchor.top > viewport.bottom || anchor.right < viewport.left || anchor.left > viewport.right) { toolbar.hidden = true; return; }
    var left = Math.max(8, Math.min(anchor.left - area.left, area.width - toolbar.offsetWidth - 8));
    var top = anchor.bottom - area.top + 8;
    if (top + toolbar.offsetHeight > viewport.bottom - area.top) top = anchor.top - area.top - toolbar.offsetHeight - 8;
    toolbar.style.left = left + 'px'; toolbar.style.top = Math.max(viewport.top - area.top + 4, top) + 'px';
  }
  function syncList() {
    var signature = App.state.stations.map(function (s) { return s.id; }).join('|');
    var list = $('station-list');
    if (signature !== listSignature) {
      var scroll = list.scrollTop, horizontal = list.scrollLeft; list.replaceChildren();
      App.state.stations.forEach(function (s) {
        var button = document.createElement('button'); button.className = 'station-item'; button.dataset.id = s.id;
        var code = document.createElement('span'); code.className = 'station-item-code';
        var text = document.createElement('span'); text.className = 'station-item-text'; text.appendChild(document.createElement('strong')); text.appendChild(document.createElement('small'));
        var tag = document.createElement('span'); tag.className = 'station-item-tag';
        var grip=document.createElement('span');grip.className='station-drag-handle';grip.setAttribute('aria-hidden','true');
        grip.innerHTML='<svg viewBox="0 0 24 24"><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/></svg>';
        button.append(grip,code, text, tag); button.addEventListener('click', function (event) { App.select(button.dataset.id, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey }); }); list.appendChild(button);
      });
      listSignature = signature; list.scrollTop = scroll; list.scrollLeft = horizontal;
    }
    var selected = App.selectedStationIds();
    Array.from(list.children).forEach(function (button, i) {
      var s = App.state.stations[i]; button.setAttribute('aria-pressed', String(selected.indexOf(s.id) >= 0));
      button.setAttribute('aria-label', s.code + ' ' + s.zh + (s.id === App.state.currentId ? ' 本站' : ''));
      button.querySelector('.station-item-code').textContent = s.code;
      button.querySelector('strong').textContent = s.zh || '未命名站点'; button.querySelector('small').textContent = s.en;
      button.querySelector('.station-item-tag').textContent = s.id === App.state.currentId ? '本站' : '';
    });
    $('station-count').textContent = App.state.stations.length + ' 站'; $('add-station').disabled = App.state.stations.length >= 120;
    $('reverse-stations').disabled=App.state.stations.length<2;
  }
  var stationDrag=null,dragFrame=null,suppressStationClick=false;
  function clearDropMarker() {
    Array.from($('station-list').children).forEach(function(el){el.classList.remove('station-drop-before','station-drop-after');});
  }
  function updateStationDrop() {
    var drag=stationDrag;if(!drag||!drag.active)return;
    var list=$('station-list'),box=list.getBoundingClientRect(),horizontal=global.matchMedia('(max-width:768px)').matches;
    var inside=drag.x>=box.left-8&&drag.x<=box.right+8&&drag.y>=box.top-8&&drag.y<=box.bottom+8;
    clearDropMarker();drag.gap=null;if(!inside)return;
    var point=horizontal?drag.x:drag.y,cards=Array.from(list.children);
    var gap=cards.filter(function(card){var b=card.getBoundingClientRect();return point>(horizontal?(b.left+b.right)/2:(b.top+b.bottom)/2);}).length;
    drag.gap=gap;var target=cards[Math.min(gap,cards.length-1)];
    target.classList.add(gap===cards.length?'station-drop-after':'station-drop-before');
  }
  function scrollStationDrag() {
    var drag=stationDrag;if(!drag||!drag.active)return;
    var list=$('station-list'),box=list.getBoundingClientRect(),horizontal=global.matchMedia('(max-width:768px)').matches;
    var p=horizontal?drag.x:drag.y,lo=horizontal?box.left:box.top,hi=horizontal?box.right:box.bottom;
    if(drag.x>=box.left-8&&drag.x<=box.right+8&&drag.y>=box.top-8&&drag.y<=box.bottom+8) {
      var step=p<lo+28?-8:p>hi-28?8:0;
      if(horizontal)list.scrollLeft+=step;else list.scrollTop+=step;
      updateStationDrop();
    }
    dragFrame=global.requestAnimationFrame(scrollStationDrag);
  }
  function finishStationDrag(cancel) {
    var drag=stationDrag;if(!drag)return;
    stationDrag=null;global.cancelAnimationFrame(dragFrame);dragFrame=null;
    clearDropMarker();drag.button.classList.remove('station-dragging');if(drag.ghost)drag.ghost.remove();
    if(drag.active) {
      suppressStationClick=true;setTimeout(function(){suppressStationClick=false;},0);
      if(!cancel&&drag.gap!==null){App.update(function(state){return S.reorderStation(state,drag.id,drag.gap);});App.select(drag.id);}
    }
  }
  $('station-list').addEventListener('pointerdown',function(event){
    var button=event.target.closest('.station-item');
    if(!button||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||stationDrag||App.state.stations.length<2)return;
    if(event.pointerType==='touch'&&!event.target.closest('.station-drag-handle'))return;
    stationDrag={id:button.dataset.id,button:button,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,active:false,gap:null};
  });
  document.addEventListener('pointermove',function(event){
    var drag=stationDrag;if(!drag||event.pointerId!==drag.pointerId)return;
    drag.x=event.clientX;drag.y=event.clientY;
    if(!drag.active&&Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<5)return;
    event.preventDefault();
    if(!drag.active) {
      drag.active=true;drag.button.classList.add('station-dragging');
      drag.ghost=drag.button.cloneNode(true);drag.ghost.removeAttribute('aria-pressed');drag.ghost.className='station-item station-drag-ghost';drag.ghost.setAttribute('aria-hidden','true');
      drag.ghost.style.width=drag.button.getBoundingClientRect().width+'px';document.body.appendChild(drag.ghost);
      dragFrame=global.requestAnimationFrame(scrollStationDrag);
    }
    drag.ghost.style.left=Math.min(global.innerWidth-drag.ghost.offsetWidth-4,drag.x+12)+'px';drag.ghost.style.top=drag.y+12+'px';updateStationDrop();
  },{passive:false});
  document.addEventListener('pointerup',function(event){if(stationDrag&&event.pointerId===stationDrag.pointerId)finishStationDrag(false);});
  document.addEventListener('pointercancel',function(event){if(stationDrag&&event.pointerId===stationDrag.pointerId)finishStationDrag(true);});
  global.addEventListener('blur',function(){finishStationDrag(true);});
  $('station-list').addEventListener('click',function(event){if(suppressStationClick){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
  $('station-list').addEventListener('keydown',function(event){
    var card=event.target.closest('.station-item');
    if(card&&event.altKey&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) {
      event.preventDefault();var id=card.dataset.id,delta=['ArrowUp','ArrowLeft'].includes(event.key)?-1:1;
      App.update(function(state){return S.moveStation(state,id,delta);});App.select(id);
      Array.from($('station-list').children).find(function(el){return el.dataset.id===id;}).focus();
    }
  });
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&stationDrag){event.preventDefault();finishStationDrag(true);}});
  function syncTransfers() {
    var s = live(), signature = s.id + ':' + s.transfers.map(function(t){return t.type||'number';}).join(',');
    if (signature !== transferSignature) {
      $('transfer-colors').replaceChildren();transferPickers=[];
      s.transfers.forEach(function (t, index) {
        var label = document.createElement('div'); label.className = 'transfer-color';
        var span = document.createElement('span');span.className='transfer-color-label';
        var picker=global.SignColorPicker.create({value:t.color,mini:true,scope:'换乘线路颜色',getValue:function(){return live().transfers[index].color;},getCity:function(){return App.state.city;},onCityChange:changeCity,onChange:function(color){
          var station = live();
          var transfers = station.transfers.map(function (item, i) { return i === index ? Object.assign({}, item, { color: color }) : item; });
          patchStation({ transfers: transfers }, station.id + ':transfer:' + index);
        }});
        transferPickers.push(picker);label.append(span,picker); $('transfer-colors').appendChild(label);
        if(t.type==='text') {
          var fields=document.createElement('div');fields.className='text-transfer-fields';
          [['nameZh','中文线路名',40],['nameEn','英文线路名',80]].forEach(function(spec){
            var field=document.createElement('label');field.textContent=spec[1];
            var input=document.createElement('input');input.type='text';input.maxLength=spec[2];input.dataset.transferField=spec[0];input.setAttribute('aria-label',spec[1]+' '+(index+1));
            input.addEventListener('input',function(){var station=live(),patch={};patch[spec[0]]=input.value;var transfers=station.transfers.map(function(item,i){return i===index?Object.assign({},item,patch):item;});if(spec[0]==='nameZh'&&!input.value.trim())return;patchStation({transfers:transfers},station.id+':transfer:'+index+':'+spec[0]);});
            field.append(input);fields.append(field);
          });
          var remove=document.createElement('button');remove.className='btn';remove.textContent='删除文字线路';
          remove.addEventListener('click',function(){var station=live();patchStation({transfers:station.transfers.filter(function(_,i){return i!==index;})});});
          fields.append(remove);label.append(fields);
        }
      });
      transferSignature = signature;
    }
    Array.from($('transfer-colors').children).forEach(function (label, i) {
      label.querySelector('.transfer-color-label').textContent = s.transfers[i].type==='text'?s.transfers[i].nameZh:s.transfers[i].number;
      label.querySelectorAll('[data-transfer-field]').forEach(function(input){if(document.activeElement!==input)input.value=s.transfers[i][input.dataset.transferField];});
      transferPickers[i].sync();
    });
  }
  function changeCity(city) { var auto=Core.lineColorFor(App.state.line,city);set(Object.assign({city:city},auto?{color:auto.bg}:{})); }
  function sync() {
    var state = App.state, s = live(), size = state.sizes[state.mode];
    if(paletteRevision!==global.SignPalettes.revision()) {
      global.SignColorPicker.syncPaletteSelect($('palette-city'),state.city);paletteRevision=global.SignPalettes.revision();
    }
    syncList(); syncTransfers();basePickers.forEach(function(picker){picker.sync();});
    var element = findElement(App.selectedKey), hanging = state.mode !== 'vertical', multi = App.selectedKeys().length > 1;
    if (layoutMode !== state.mode) { $('advanced-layout').open = !hanging; layoutMode = state.mode; }
    document.querySelectorAll('[data-property-view]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.propertyView === App.panelView)); });
    document.querySelectorAll('[data-panel]').forEach(function (section) {
      section.hidden = section.dataset.panel === 'sign' ? App.panelView !== 'sign' : section.dataset.panel === 'element' ? !element : App.panelView !== 'station' || multi || !!(element && !element.stationId);
    });
    $('property-heading').textContent = App.panelView === 'sign' ? '标识牌设置' : multi ? '已选择 ' + App.selectedKeys().length + ' 个元素' : element ? element.label : '站点编辑';
    $('element-properties').querySelector('h2').textContent = multi ? '整组位置微调' : '元素位置微调';
    ['element-offset-x', 'element-offset-y'].forEach(function (id) { $(id).disabled = multi; });
    $('hanging-size-controls').hidden = !hanging; $('fit-ratio').hidden = true;
    $('output-width').readOnly = !hanging; $('output-height').readOnly = false;
    $('station-direction-option').hidden = state.mode !== 'station';
    $('show-station-direction').checked = state.showStationDirection;
    $('vertical-layout-controls').hidden = hanging;
    value('vertical-variant', state.verticalVariant);
    $('swap-vertical-columns').hidden = state.verticalVariant !== 'double';
    $('travel-direction-label').textContent = !hanging && state.verticalVariant === 'double' ? '基准行车方向（与吊板共用）' : '列车行驶方向';
    $('vertical-layout-help').textContent = state.verticalVariant === 'double' ? '左右显示两个行车方向，中央共用一列换乘。交换左右列同步更新方向与已驶过区段；吊板使用基准行车方向。' : '顶栏显示行车方向与本站。换乘始终从左到右阅读，与吊板共用站点、本站和颜色。';
    $('size-help').textContent = hanging ? '每格 256px：地铁线路图 3格，单轨线路图 5格，本站信息 2格。手动设置的长度单独保留。' : 'MC尺寸：单列1.5格 / 384px宽，双列2.5格 / 640px宽；默认固定3格 / 768px高。增删站点自动调整内部间距，密集时整体缩小；也可手动修改高度。';
    var units = size.width / Core.SIGN_GRID_SIZE;
    value('hanging-length', Number.isInteger(units) && units >= 1 && units <= 15 ? units : 'custom');
    value('hanging-height', size.height === 192 || size.height === 256 ? size.height : 'custom');
    var offset = element && state.adjustments[element.key] || { x: 0, y: 0 };
    value('element-offset-x', offset.x); value('element-offset-y', offset.y);
    document.querySelectorAll('[data-mode]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode)); });
    $('preview-title').textContent = names[state.mode]; $('preview-dimensions').textContent = size.width + ' × ' + size.height + ' px';
    value('line-number', state.line); value('line-name', state.lineName); value('palette-city', state.city); value('travel-direction', state.direction);
    value('station-code', s.code); value('station-zh', s.zh); value('station-en', s.en);
    value('station-transfers', S.formatTransfers(s.transfers));
    $('add-text-transfer').disabled=s.transfers.length>=6;
    value('output-width', size.width); value('output-height', size.height); value('font-scale', state.fontScale);
    $('font-scale-label').textContent = Math.round(state.fontScale * 100) + '%';
    $('current-station-label').textContent = s.id === state.currentId ? '当前本站' : s.code;
    $('set-current').disabled = s.id === state.currentId;
    var index = state.stations.findIndex(function (item) { return item.id === s.id; });
    $('station-up').disabled = index === 0; $('station-down').disabled = index === state.stations.length - 1; $('station-delete').disabled = state.stations.length <= 1;
    $('undo').disabled = !undo.length; $('redo').disabled = !redo.length;
    if (global.PlatformClipboard) global.PlatformClipboard.sync();
  }
  document.querySelector('.platform-property-scroll').prepend($('dimension-section'));
  document.querySelectorAll('[data-mode]').forEach(function (button) { button.addEventListener('click', function () { set({ mode: button.dataset.mode }); App.deselect(); }); });
  document.querySelectorAll('[data-property-view]').forEach(function (button) { button.addEventListener('click', function () { if (button.dataset.propertyView === 'sign') App.deselect(); else App.select(App.selectedId); }); });
  // Preserve controls and text drag selections while allowing blank clicks anywhere on the page.
  var selectionControls = 'button, input, select, textarea, label, a, summary, [contenteditable], [role="button"], .field, .platform-section, #platform-element-toolbar, dialog, #platform-notice';
  var pagePointer = null, suppressPageClick = false;
  document.addEventListener('pointerdown', function (event) {
    if (event.button !== 0 || event.isPrimary === false) return;
    pagePointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, control: !!event.target.closest(selectionControls) };
  }, true);
  function trackPointer(event) { if (pagePointer && pagePointer.id === event.pointerId) pagePointer.moved = pagePointer.moved || Math.hypot(event.clientX - pagePointer.x, event.clientY - pagePointer.y) > 5; }
  document.addEventListener('pointermove', trackPointer, true);
  document.addEventListener('pointerup', function (event) {
    if (!pagePointer || pagePointer.id !== event.pointerId) return;
    trackPointer(event);
    if (pagePointer.control || pagePointer.moved) { suppressPageClick = true; setTimeout(function () { suppressPageClick = false; }, 0); }
    pagePointer = null;
  }, true);
  document.addEventListener('pointercancel', function (event) { if (pagePointer && pagePointer.id === event.pointerId) pagePointer = null; }, true);
  document.addEventListener('click', function (event) {
    if (suppressPageClick) { suppressPageClick = false; return; }
    if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
    var element = event.target.closest('#platform-svg [data-element-key]'), station = event.target.closest('#platform-svg [data-station-id]');
    var modifiers = { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey };
    if (element) App.selectElement(element.dataset.elementKey, modifiers);
    else if (station) App.select(station.dataset.stationId, modifiers);
    else if (App.selectedKey && !event.target.closest(selectionControls)) App.deselect();
  });
  $('platform-svg').addEventListener('pointermove', function (event) { var target = event.target.closest('[data-element-key]'), key = target ? target.dataset.elementKey : null; if (key !== App.hoverKey) { App.hoverKey = key; paintInteraction(); } });
  $('platform-svg').addEventListener('pointerleave', function () { App.hoverKey = null; paintInteraction(); });
  $('platform-preview-scroll').addEventListener('scroll', paintInteraction);
  $('preview-zoom').addEventListener('change', fitPreview);
  new ResizeObserver(fitPreview).observe($('platform-preview-scroll'));
  $('undo').addEventListener('click', App.undo); $('redo').addEventListener('click', App.redo);
  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || event.isComposing || document.querySelector('dialog[open]') || global.PlatformClipboard.editing(event.target)) return;
    var command = (event.ctrlKey || event.metaKey) && !event.altKey, key = event.key.toLowerCase();
    if (command && key === 'a') { event.preventDefault(); if (event.target.closest && event.target.closest('#station-list')) App.selectAllStations(); else App.selectAll(); }
    else if (command && key === 'z') { event.preventDefault(); if (event.shiftKey) App.redo(); else App.undo(); }
    else if (key === 'escape') { event.preventDefault(); App.deselect(); }
    else if ((key === 'delete' || key === 'backspace') && App.selectedStationIds().length) { event.preventDefault(); App.deleteSelection(); }
  });
  document.addEventListener('focusout', function () { groupKey = null; });
  ['code', 'zh', 'en'].forEach(function (key) {
    $('station-' + key).addEventListener('input', function (event) { var patch = {}; patch[key] = event.target.value; patchStation(patch, App.selectedId + ':' + key); });
  });
  $('station-transfers').addEventListener('change', function (event) {
    try { patchStation({ transfers: S.parseTransfers(event.target.value, App.state.city) }); event.target.setCustomValidity(''); }
    catch (err) { event.target.setCustomValidity(err.message); event.target.reportValidity(); notice(err.message); }
  });
  $('station-transfers').addEventListener('input', function (event) { event.target.setCustomValidity(''); });
  $('add-text-transfer').addEventListener('click',function(){var s=live();if(s.transfers.length<6)patchStation({transfers:s.transfers.concat([{type:'text',nameZh:'文字线路',nameEn:'',color:'#0057B8'}])});});
  $('line-number').addEventListener('input', function (event) {
    var state = App.state, n = event.target.value, auto = Core.lineColorFor(n, state.city);
    var patch = { line: n };
    if (state.lineName === state.line + '号线' || state.lineName===state.line) patch.lineName = /^\d+$/.test(n)?n+'号线':n;
    if (auto) patch.color = auto.bg;
    set(patch, 'line-number');
  });
  $('line-name').addEventListener('input', function (event) { set({ lineName: event.target.value }, 'line-name'); });
  $('palette-city').addEventListener('change', function (event) { changeCity(event.target.value); });
  $('travel-direction').addEventListener('change', function (event) { set({ direction: Number(event.target.value) }); });
  $('show-station-direction').addEventListener('change', function (event) { set({ showStationDirection: event.target.checked }); });
  $('vertical-variant').addEventListener('change', function(event) { App.update(function(state){return S.setVerticalVariant(state,event.target.value);}); });
  $('swap-vertical-columns').addEventListener('click',function(){App.update(S.swapVerticalColumns);});
  $('reverse-stations').addEventListener('click',function(){App.update(S.reverseStations);});
  $('font-scale').addEventListener('input', function (event) { set({ fontScale: Number(event.target.value) }, 'font-scale'); });
  $('hanging-length').addEventListener('change', function (event) { if (event.target.value !== 'custom') App.update(function (state) { return S.setHangingLength(state, Number(event.target.value)); }); else { $('advanced-layout').open = true; $('output-width').focus(); } });
  $('hanging-height').addEventListener('change', function (event) { if (event.target.value !== 'custom') App.update(function (state) { return S.setHangingHeight(state, Number(event.target.value)); }); else { $('advanced-layout').open = true; $('output-height').focus(); } });
  document.querySelectorAll('[data-nudge-x]').forEach(function (button) { button.addEventListener('click', function () { var keys = App.selectedKeys(); if (keys.length) App.update(function (state) { return S.nudgeElements(state, keys, Number(button.dataset.nudgeX), Number(button.dataset.nudgeY)); }); }); });
  ['x', 'y'].forEach(function (axis) { $('element-offset-' + axis).addEventListener('change', function (event) { if (!App.selectedKey) return; var n = Number(event.target.value); if (!Number.isFinite(n) || n < -128 || n > 128) { notice('微调范围为 −128 至 128px'); event.target.value = (App.state.adjustments[App.selectedKey] || {})[axis] || 0; return; } var patch = {}; patch[axis] = n; App.update(function (state) { return S.setElementOffset(state, App.selectedKey, patch); }); }); });
  function resetElement() { var keys = App.selectedKeys(); if (keys.length) App.update(function (state) { return S.resetElements(state, keys); }); }
  $('tool-reset').addEventListener('click', resetElement); $('reset-element').addEventListener('click', resetElement);
  [['tool-current', 'set-current'], ['tool-up', 'station-up'], ['tool-down', 'station-down'], ['tool-delete', 'station-delete']].forEach(function (pair) { $(pair[0]).addEventListener('click', function () { $(pair[1]).click(); }); });
  function setSize(patch) {
    if(App.state.mode==='vertical'&&patch.width!==undefined)return;
    var sizes = Object.assign({}, App.state.sizes); sizes[App.state.mode] = Object.assign({}, sizes[App.state.mode], patch); set(Object.assign({ sizes: sizes }, App.state.mode === 'route' && patch.width !== undefined ? { routeLengthAuto: false } : {}));
  }
  ['width', 'height'].forEach(function (key) {
    $('output-' + key).addEventListener('change', function (event) {
      if(App.state.mode==='vertical'&&key==='width'){event.target.value=App.state.sizes.vertical.width;return;}
      var n = Number(event.target.value);
      if (!Number.isFinite(n) || n < 128 || n > 8192) { event.target.value = App.state.sizes[App.state.mode][key]; notice('尺寸须为 128–8192 px'); return; }
      var patch = {}; patch[key] = Math.round(n); setSize(patch);
    });
  });
  $('set-current').addEventListener('click', function () { set({ currentId: App.selectedId }); });
  $('add-station').addEventListener('click', function () {
    var previous = App.state;
    App.update(function (state) { return S.addStation(state, App.selectedId); });
    var added = App.state.stations.find(function (s) { return !previous.stations.some(function (old) { return old.id === s.id; }); });
    if (added) { App.select(added.id); $('station-zh').focus(); $('station-zh').select(); }
  });
  $('station-delete').addEventListener('click', App.deleteSelection);
  [['station-up', -1], ['station-down', 1]].forEach(function (pair) { $(pair[0]).addEventListener('click', function () { App.update(function (state) { return S.moveStation(state, App.selectedId, pair[1]); }); }); });
  $('batch-stations').addEventListener('click', function () {
    $('batch-text').value = App.state.stations.map(function (s) { return [s.code, s.zh, s.en, S.formatTransfers(s.transfers)].join('|'); }).join('\n');
    $('batch-error').textContent = ''; $('batch-dialog').showModal();
  });
  $('apply-batch').addEventListener('click', function () {
    try {
      var stations = S.parseStations($('batch-text').value, App.state.city), old = S.neighbors(App.state).current;
      App.update(function (state) {
        var same = stations.find(function (s) { return s.code === old.code; });
        return S.settings(S.replaceStations(state, stations), { currentId: same ? same.id : stations[0].id });
      });
      App.select(App.state.currentId); $('batch-dialog').close(); notice('已更新 ' + stations.length + ' 个站点');
    } catch (err) { $('batch-error').textContent = err.message; }
  });
  function filename(ext, state) { return 'platform-' + state.mode + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + ext; }
  $('save-project').addEventListener('click', function () { App.download(new Blob([S.serialize(App.state)], { type: 'application/json' }), filename('json', App.state)); notice('项目 JSON 已保存'); });
  $('import-project').addEventListener('click', function () { $('project-file').click(); });
  $('project-file').addEventListener('change', async function (event) {
    var file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try { if (file.size > 2 * 1024 * 1024) throw new Error('项目 JSON 过大'); var state = S.deserialize(await file.text()); App.update(function () { return state; }); App.select(state.currentId); notice('项目已导入'); }
    catch (err) { notice('导入失败：' + err.message); }
  });
  function selectLibrary(name) {
    library = name;
    document.querySelectorAll('[data-library]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.library === name)); });
    $('station-library').hidden = name !== 'stations'; $('preset-library').hidden = name !== 'presets';
    if (name === 'presets') syncPresets();
  }
  function persistPresets(next) {
    try { localStorage.setItem(PRESET_KEY, P.serialize(next)); }
    catch (err) { notice('预设保存失败：本地空间不足，请保存项目 JSON'); return false; }
    presets = next; syncPresets(); return true;
  }
  function syncPresets() {
    var signature = presets.map(function (preset) { return preset.id; }).join('|');
    if (signature === presetSignature && $('preset-list').children.length) return;
    presetSignature = signature; var list = $('preset-list'), scroll = list.scrollTop; list.replaceChildren();
    if (!presets.length) { var empty = document.createElement('p'); empty.className = 'preset-empty'; empty.textContent = '保存常用标识牌，之后一键载入。预设保存在当前浏览器。'; list.appendChild(empty); }
    presets.forEach(function (preset) {
      var card = document.createElement('div'); card.className = 'platform-preset'; card.dataset.presetId = preset.id;
      var load = document.createElement('button'); load.className = 'preset-load'; load.setAttribute('aria-label', '载入预设 ' + preset.name);
      var svg = document.createElementNS(Core.SVG_NS, 'svg'); R.draw(svg, R.metrics(preset.state, App.measure), { clean: true }); svg.removeAttribute('width'); svg.removeAttribute('height'); svg.setAttribute('aria-hidden', 'true');
      var title = document.createElement('strong'); title.textContent = preset.name;
      var meta = document.createElement('small'), size = preset.state.sizes[preset.state.mode]; meta.textContent = names[preset.state.mode] + ' · ' + size.width + ' × ' + size.height;
      load.append(svg, title, meta); load.addEventListener('click', function () {
        var current = presets.find(function (item) { return item.id === card.dataset.presetId; }); if (!current) return;
        var state = S.deserialize(S.serialize(current.state)); App.update(function () { return state; }); App.selectedId = state.currentId; App.deselect(); notice('已载入预设：' + current.name);
      });
      var remove = document.createElement('button'); remove.className = 'preset-remove'; remove.textContent = '×'; remove.setAttribute('aria-label', '删除预设 ' + preset.name);
      remove.addEventListener('click', function () { persistPresets(presets.filter(function (item) { return item.id !== card.dataset.presetId; })); });
      card.append(load, remove); list.appendChild(card);
    });
    list.scrollTop = scroll;
  }
  function showPresetDialog() {
    if (presets.length >= 30) { notice('最多保存 30 个预设，请先删除不需要的预设'); return; }
    $('preset-name').value = App.state.lineName + ' · ' + names[App.state.mode]; $('preset-error').textContent = ''; $('preset-dialog').showModal(); $('preset-name').select();
  }
  document.querySelectorAll('[data-library]').forEach(function (button) { button.addEventListener('click', function () { selectLibrary(button.dataset.library); }); });
  $('save-preset').addEventListener('click', showPresetDialog); $('save-preset-shortcut').addEventListener('click', showPresetDialog);
  function savePreset() {
    try { var preset = P.create(App.state, $('preset-name').value); if (persistPresets(presets.concat([preset]))) { $('preset-dialog').close(); selectLibrary('presets'); notice('预设已保存到本机'); } }
    catch (err) { $('preset-error').textContent = err.message; }
  }
  $('save-preset-confirm').addEventListener('click', savePreset);
  $('preset-dialog').querySelector('form').addEventListener('submit', function (event) { if (event.submitter && event.submitter.value === 'cancel') return; event.preventDefault(); savePreset(); });
  function buildSVG(state, measure, embedData, scene) {
    scene = scene || R.metrics(state, measure);
    var svg = document.createElementNS(Core.SVG_NS, 'svg'); R.draw(svg, scene, { clean: true });
    var style = document.createElementNS(Core.SVG_NS, 'style'); style.textContent = SignExporters.buildFontCSS(scene.usedFonts, embedData); svg.insertBefore(style, svg.firstChild);
    svg.querySelectorAll('[data-station-id], [data-element-key], [data-role]').forEach(function (el) { ['data-station-id', 'data-element-key', 'data-role'].forEach(function (attr) { el.removeAttribute(attr); }); });
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
  }
  function pngBlob(svgText, size, scale) {
    return SignExporters.rasterizePNG(svgText, size, scale);
  }
  async function exportFile(format) {
    if (busy) return;
    var state = App.state, scale = format === 'png' ? Number($('png-scale').value) : 1;
    busy = true; $('export-png').disabled = $('export-svg').disabled = true; notice('正在生成 ' + format.toUpperCase() + '…');
    try {
      await App.ready; var scene = R.metrics(state, App.measure), fonts = await SignExporters.ensureUsedFontData(scene.usedFonts); var svg = buildSVG(state, App.measure, fonts, scene);
      var blob = format === 'svg' ? new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }) : await pngBlob(svg, state.sizes[state.mode], scale);
      App.download(blob, filename(format, state)); notice(format.toUpperCase() + ' 已导出 · ' + state.sizes[state.mode].width * scale + ' × ' + state.sizes[state.mode].height * scale + ' px');
    } catch (err) { notice('导出失败：' + err.message); }
    finally { busy = false; $('export-png').disabled = $('export-svg').disabled = false; }
  }
  global.PlatformExport = { buildSVG: buildSVG, pngBlob: pngBlob, exportFile: exportFile };
  $('export-svg').addEventListener('click', function () { exportFile('svg'); }); $('export-png').addEventListener('click', function () { exportFile('png'); });
  [['line-color-picker','color','线路色','line-color','line-color-hex'],['background-color-picker','background','标识牌背景','background-color'],['muted-color-picker','muted','已驶过','muted-color']].forEach(function(spec){
    var picker=global.SignColorPicker.create({value:App.state[spec[1]],scope:spec[2],nativeId:spec[3],hexId:spec[4],swatchesId:spec[1]==='color'?'platform-swatches':undefined,
      getCity:function(){return App.state.city;},onCityChange:changeCity,getValue:function(){return App.state[spec[1]];},onChange:function(color){var patch={};patch[spec[1]]=color;set(patch,spec[3]);}});
    $(spec[0]).appendChild(picker);basePickers.push(picker);
  });
  global.addEventListener('sign-palettes-change',function(){
    if(!Core.isPalette(App.state.city))set({city:'chongqing'});else sync();
  });
  global.PlatformClipboard.init(App, notice);
  render();
  App.ready = Promise.all(Core.FONT_LOAD_SPECS.map(function (spec) { return document.fonts.load(spec.css, '新站点 Station 0123456789'); })).then(function () { App.measure = Core.createCanvasMeasurer(); render(); presetSignature = ''; if (library === 'presets') syncPresets(); }).catch(function (err) { notice('字体加载失败，当前使用备用字体：' + err.message); });
})(window);
