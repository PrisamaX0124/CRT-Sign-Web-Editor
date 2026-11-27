(function (global) {
  'use strict';
  var S = global.PlatformState, R = global.PlatformRender, Core = global.SignCore, P = global.PlatformPresets;
  var KEY = 'public-platform-sign-project-v1', undo = [], redo = [], groupKey = null, groupTime = 0;
  var HISTORY_LIMIT = 20;
  var PRESET_KEY = 'public-platform-sign-presets-v1', presets = [], presetSignature = '', library = 'stations';
  var listSignature = '', transferSignature = '', layoutMode = '', busy = false;
  var previousPanelSelection = '';
  var renderedCurrentId;
  var renderedLayout;
  var propertyTabs = global.PropertyTabs.create($('property-scroll'));
  var basePickers = [], transferRows = [], paletteRevision = -1;
  var syncLinePattern;
  var names = { route: '全线吊板', station: '本站吊板', vertical: '纵向线路图' };
  function $(id) { return document.getElementById(id); }
  var notice = global.EditorNotifications.show;
  var restoredProject;
  try { var saved = localStorage.getItem(KEY); if (saved) restoredProject = S.deserialize(saved); }
  catch (err) { notice('未能恢复本地项目：' + err.message, 'warning'); }
  var initial = restoredProject || S.create();
  try { presets = P.deserialize(localStorage.getItem(PRESET_KEY) || '[]'); }
  catch (err) { notice('未能恢复预设：' + err.message, 'error'); }
  var App = global.App = {
    state: initial, selectedId: initial.currentId, selectedKey: null, selectionKeys: [], anchorKey: null, hoverKey: null, measure: Core.createCanvasMeasurer(), scene: null,
    update: function (fn, key, options) {
      if (App.projects?.busy && !options?.activateProject) return false;
      var next = fn(App.state);
      if (options?.activateProject) {
        finishStationDrag(true, false); stationLanding?.(); pagePointer = null;
        if (options.changedProject) previewZoom.resetForProject();
        else previewZoom.resetInteraction();
        suppressStationClick = suppressPageClick = false;
        global.PlatformClipboard.resetProject();
        undo = []; redo = []; groupKey = null; groupTime = 0;
        App.state = next; App.selectedId = next.currentId;
        App.selectionKeys = []; App.selectedKey = App.anchorKey = App.hoverKey = null;
        listSignature = transferSignature = previousPanelSelection = '';
        renderedCurrentId = renderedLayout = null;
        document.querySelectorAll('.current-station-highlight').forEach(function (item) { item.remove(); });
        ['batch-dialog', 'preset-dialog'].forEach(function (id) { if ($(id).open) $(id).close(); });
        render(); return true;
      }
      if (JSON.stringify(next) === JSON.stringify(App.state)) return false;
      var now = Date.now();
      if (!(key && key === groupKey && ((options && options.continuous) || now - groupTime < 800))) {
        undo.push(snapshot()); if (undo.length > HISTORY_LIMIT) undo.shift();
      }
      groupKey = key || null; groupTime = now; redo = [];
      var previous = App.state; App.state = next;
      if ((options && options.replaceProject) || !live()) App.selectedId = next.currentId;
      if (options && options.selectNew) {
        App.selectionKeys = next.stations.filter(function (s) { return !previous.stations.some(function (old) { return old.id === s.id; }); }).map(function (s) { return stationKey(s.id, next); });
        App.selectedKey = App.selectionKeys[App.selectionKeys.length - 1] || null; App.anchorKey = App.selectionKeys[0] || null;
      }
      if (options && (options.clearSelection || options.replaceProject)) { App.selectionKeys = []; App.selectedKey = App.anchorKey = App.hoverKey = null; }
      render(); autosave.schedule();
      return true;
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
      App.hoverKey = null;
      groupKey = null; sync(); paintInteraction();
    },
    elementOrder: function () { return App.scene.elements.map(function (item) { return item.key; }); },
    selectAll: function () { App.selectMany(App.elementOrder(), App.selectedKey); },
    selectAllStations: function () { App.selectMany(App.state.stations.map(function (s) { return stationKey(s.id); }), App.selectedKey); },
    deselect: function () { App.selectMany([]); },
    deleteSelection: function () {
      var ids = App.selectedStationIds(); if (!ids.length) return;
      if (App.state.stations.length <= 1) { notice('至少保留一个站点', 'warning'); return; }
      var all = ids.length === App.state.stations.length;
      if (App.update(function (state) { return S.removeStations(state, ids); }, null, { clearSelection: true })) {
        notice(all ? '已删除选中站点，并保留本站' : '已删除 ' + ids.length + ' 个站点', 'success');
      }
    },
    undo: function () { history(undo, redo, '已撤销上一步'); },
    redo: function () { history(redo, undo, '已重做上一步'); },
    download: function (blob, filename) {
      var url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 15000);
    },
    render: render,
  };
  var autosave = { schedule: function () { App.projectStorage?.schedule(); } };
  var previewZoom = global.PreviewZoom.create({
    viewport: $('platform-preview-scroll'),
    stage: $('platform-preview-scroll').firstElementChild,
    paper: $('platform-paper'),
    graphic: $('platform-svg'),
    controls: $('platform-zoom'),
    onChange: paintInteraction,
  });
  function live() { return App.state.stations.find(function (s) { return s.id === App.selectedId; }); }
  function snapshot() { return { state: App.state, selectedId: App.selectedId, selectedKey: App.selectedKey, selectionKeys: App.selectedKeys(), anchorKey: App.anchorKey }; }
  function findElement(key) { return App.scene && (App.scene.elements || []).find(function (item) { return item.key === key; }); }
  function selectedVisibleKeys() { return App.selectedKeys().filter(findElement); }
  function stationIdFromKey(key) { var s = App.state.stations.find(function (s) { return key === 'route:' + s.id || key === 'vertical:left:' + s.id || key === 'vertical:right:' + s.id || key === 'vertical:transfer:' + s.id; }); return s ? s.id : null; }
  function stationKey(id, state) {
    state = state || App.state;
    if (state.mode === 'route') return 'route:' + id;
    if (state.mode === 'vertical') return 'vertical:' + (state.verticalVariant === 'right' ? 'right:' : 'left:') + id;
    if (id === state.currentId) return 'station:title';
    var near = S.neighbors(state), left = state.direction === -1 ? near.next : near.previous, right = state.direction === 1 ? near.next : near.previous;
    return left && left.id === id ? 'station:left' : right && right.id === id ? 'station:right' : 'route:' + id;
  }
  function history(from, to, message) {
    if (!from.length || App.projects?.busy) return;
    to.push(snapshot());
    if (to.length > HISTORY_LIMIT) to.shift();
    var old = from.pop(); App.state = Core.isPalette(old.state.city) ? old.state : S.settings(old.state,{city:'chongqing'}); App.selectedId = old.selectedId; App.selectedKey = old.selectedKey; App.selectionKeys = old.selectionKeys; App.anchorKey = old.anchorKey; groupKey = null;
    render(); autosave.schedule();
    notice(message, 'information');
  }
  function value(id, v) { if (document.activeElement !== $(id)) $(id).value = v; }
  function set(patch, key) { return App.update(function (state) { return S.settings(state, patch); }, key); }
  function patchStation(patch, key) { return App.update(function (state) { return S.patchStation(state, App.selectedId, patch); }, key); }
  function changeStationOrder(change) {
    if (App.update(change)) notice('已调整站点顺序', 'success');
  }
  function render() {
    var currentChanged = renderedCurrentId && renderedCurrentId !== App.state.currentId;
    renderedCurrentId = App.state.currentId;
    var graphic = $('platform-svg'), previous = App.scene;
    var layout = App.state.mode === 'vertical' ? App.state.mode + ':' + App.state.verticalVariant : App.state.mode;
    var finishCrossfade = previous && renderedLayout && layout !== renderedLayout ? global.EditorMotion.prepareGraphicCrossfade(graphic, function (old) {
      R.draw(old, previous, { clean: true });
    }) : null;
    renderedLayout = layout;
    App.scene = R.metrics(App.state, App.measure); R.draw(graphic, App.scene);
    App.selectionKeys = App.selectedKeys();
    if (App.selectionKeys.indexOf(App.selectedKey) < 0) App.selectedKey = App.selectionKeys[App.selectionKeys.length - 1] || null;
    var selected = findElement(App.selectedKey);
    var id = selected && selected.stationId || stationIdFromKey(App.selectedKey); if (id) App.selectedId = id;
    if (!S.validElementKey(App.anchorKey, App.state.stations)) App.anchorKey = App.selectedKey;
    sync();
    previewZoom.refresh(App.scene.output.width, App.scene.output.height);
    finishCrossfade?.();
    if (currentChanged) highlightCurrentStation();
  }
  function highlightCurrentStation() {
    var paper = $('platform-paper'), scene = App.scene, frame = scene.frame;
    paper.querySelectorAll('.current-station-highlight').forEach(function (element) { element.remove(); });
    if (!global.EditorMotion.timing(paper).duration) return;
    scene.elements.filter(function (item) {
      return item.stationId === App.state.currentId && ['station-name', 'route-station', 'vertical-station'].includes(item.kind);
    }).forEach(function (item) {
      var box = item.box, highlight = document.createElement('div');
      highlight.className = 'current-station-highlight';
      highlight.setAttribute('aria-hidden', 'true');
      highlight.style.left = ((box.x * frame.scale + frame.x) / scene.output.width * 100) + '%';
      highlight.style.top = ((box.y * frame.scale + frame.y) / scene.output.height * 100) + '%';
      highlight.style.width = (box.width * frame.scale / scene.output.width * 100) + '%';
      highlight.style.height = (box.height * frame.scale / scene.output.height * 100) + '%';
      paper.append(highlight);
      var animation = global.EditorMotion.play(highlight, [{ opacity: 1 }, { opacity: .8, offset: .3 }, { opacity: 0 }], 'panel');
      if (animation) animation.finished.then(function () { highlight.remove(); }, function () { highlight.remove(); });
      else highlight.remove();
    });
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
    var toolbar = $('platform-element-toolbar'), item = findElement(App.selectedKey);
    var anchor = $('element-selection-outline').getBoundingClientRect();
    var scroller = $('platform-preview-scroll');
    var viewport = scroller.getBoundingClientRect();
    var right = viewport.left + scroller.clientWidth, bottom = viewport.top + scroller.clientHeight;
    var visible = item && anchor.bottom >= viewport.top && anchor.top <= bottom && anchor.right >= viewport.left && anchor.left <= right;
    global.EditorMotion.setToolbarVisible(toolbar, !!visible);
    if (!visible) return;
    $('toolbar-element-label').textContent = keys.length > 1 ? '已选 ' + keys.length + ' 个元素' : item.label;
    var stationIds = App.selectedStationIds(), hasStation = !!stationIds.length, singleStation = hasStation && keys.length === 1, index = App.state.stations.findIndex(function (s) { return s.id === item.stationId; });
    ['tool-current', 'tool-up', 'tool-down', 'tool-delete'].forEach(function (id) { $(id).hidden = !hasStation; });
    $('tool-current').disabled = !singleStation || stationIds[0] === App.state.currentId;
    $('tool-up').disabled = !singleStation || index <= 0; $('tool-down').disabled = !singleStation || index >= App.state.stations.length - 1; $('tool-delete').disabled = App.state.stations.length <= 1;
    var area = document.querySelector('.platform-preview').getBoundingClientRect();
    var left = Math.max(8, Math.min(anchor.left - area.left, right - area.left - toolbar.offsetWidth - 8));
    var top = anchor.bottom - area.top + 8;
    var toolBottom = bottom - parseFloat(getComputedStyle(scroller).paddingBottom) - area.top;
    if (top + toolbar.offsetHeight > toolBottom) top = anchor.top - area.top - toolbar.offsetHeight - 8;
    top = Math.max(viewport.top - area.top + 4, Math.min(top, toolBottom - toolbar.offsetHeight));
    global.EditorMotion.placeToolbar(toolbar, left, top, App.selectedKey);
  }
  function syncList() {
    var signature = App.state.stations.map(function (s) { return s.id; }).join('|');
    var list = $('station-list');
    if (signature !== listSignature) {
      if (stationDrag) finishStationDrag(true, false);
      stationLanding?.();
      var scroll = list.scrollTop, horizontal = list.scrollLeft;
      var existing = new Map(Array.from(list.children, function (card) { return [card.dataset.id, card]; }));
      var focused = list.contains(document.activeElement) ? document.activeElement : null;
      App.state.stations.forEach(function (s, index) {
        var current = existing.get(s.id);
        if (current) {
          existing.delete(s.id);
          if (list.children[index] !== current) list.insertBefore(current, list.children[index] || null);
          return;
        }
        var card = document.createElement('div'); card.className = 'station-item'; card.dataset.id = s.id;
        var button = document.createElement('button'); button.type = 'button'; button.className = 'station-select';
        var code = document.createElement('span'); code.className = 'station-item-code';
        var text = document.createElement('span'); text.className = 'station-item-text'; text.appendChild(document.createElement('strong')); text.appendChild(document.createElement('small'));
        var grip=document.createElement('span');grip.className='station-drag-handle';grip.setAttribute('aria-hidden','true');
        grip.innerHTML='<svg viewBox="0 0 24 24"><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/></svg>';
        var currentButton = document.createElement('button'); currentButton.type = 'button'; currentButton.className = 'station-current';
        currentButton.dataset.controlIcon = 'locate';
        currentButton.addEventListener('click', function (event) {
          event.stopPropagation();
          var hadFocus = document.activeElement === currentButton;
          setCurrentStation(card.dataset.id);
          if (hadFocus && currentButton.disabled) button.focus({ preventScroll: true });
        });
        button.append(grip, code, text);
        card.append(button, currentButton);
        card.addEventListener('click', function (event) { App.select(card.dataset.id, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey }); });
        list.insertBefore(card, list.children[index] || null);
      });
      existing.forEach(function (card) { card.remove(); });
      if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
      listSignature = signature; list.scrollTop = scroll; list.scrollLeft = horizontal;
    }
    var selected = App.selectedStationIds();
    Array.from(list.children).forEach(function (card, i) {
      var s = App.state.stations[i], isCurrent = s.id === App.state.currentId;
      var button = card.querySelector('.station-select'), currentButton = card.querySelector('.station-current');
      button.setAttribute('aria-pressed', String(selected.includes(s.id)));
      button.setAttribute('aria-label', s.code + ' ' + s.zh + (isCurrent ? ' 本站' : ''));
      card.querySelector('.station-item-code').textContent = s.code;
      card.querySelector('strong').textContent = s.zh || '未命名站点'; card.querySelector('small').textContent = s.en;
      currentButton.disabled = isCurrent;
      currentButton.title = isCurrent ? '已是本站' : '设为本站';
      currentButton.setAttribute('aria-label', isCurrent ? s.zh + '已是本站' : '将' + s.zh + '设为本站');
    });
    $('station-count').textContent = App.state.stations.length + ' 站'; $('add-station').disabled = App.state.stations.length >= 120;
    $('reverse-stations').disabled=App.state.stations.length<2;
  }
  var stationDrag = null, stationLanding = null, suppressStationClick = false;
  var stationList = $('station-list');

  function pointerInStationList(drag, box) {
    return drag.x >= box.left - 8 && drag.x <= box.right + 8 && drag.y >= box.top - 8 && drag.y <= box.bottom + 8;
  }

  function updateStationDrop() {
    var drag = stationDrag, box = stationList.getBoundingClientRect();
    var cards = drag.cards, from = drag.from, button = drag.button;
    var y = drag.y - box.top - stationList.clientTop + stationList.scrollTop;
    // 卡片动画中的位置会随每一帧变化，落点始终按列表原有的行位置判断。
    var gap = pointerInStationList(drag, box) ? cards.filter(function (card) {
      return y > card.offsetTop + card.offsetHeight / 2;
    }).length : null;
    if (gap === drag.gap) return;
    drag.gap = gap;
    var to = gap === null ? from : gap > from ? gap - 1 : gap;
    var step = from + 1 < cards.length ? cards[from + 1].offsetTop - button.offsetTop : button.offsetTop - cards[from - 1].offsetTop;
    cards.forEach(function (card, index) {
      var distance = index >= to && index < from ? step : index > from && index <= to ? -step : 0;
      card.style.translate = distance ? '0 ' + distance + 'px' : '';
    });
    stationList.classList.toggle('station-drop-active', gap !== null);
    if (gap === null) return;
    var next = cards[to + 1];
    var top = to <= from ? cards[to].offsetTop : next ? next.offsetTop - step : cards[to].offsetTop + cards[to].offsetHeight - button.offsetHeight;
    stationList.style.setProperty('--station-gap-top', top + 'px');
    stationList.style.setProperty('--station-gap-height', button.offsetHeight + 'px');
    stationList.style.setProperty('--station-gap-left', button.offsetLeft + 'px');
    stationList.style.setProperty('--station-gap-width', button.offsetWidth + 'px');
  }
  function scrollStationDrag() {
    var drag = stationDrag, box = stationList.getBoundingClientRect();
    if (pointerInStationList(drag, box)) {
      var previous = stationList.scrollTop;
      stationList.scrollTop += drag.y < box.top + 28 ? -8 : drag.y > box.bottom - 28 ? 8 : 0;
      if (stationList.scrollTop !== previous) updateStationDrop();
    }
    drag.frame = global.requestAnimationFrame(scrollStationDrag);
  }

  function landStationCard(drag, animate) {
    var cleaned = false;
    function clean() {
      if (cleaned) return;
      cleaned = true;
      drag.button.classList.remove('station-dragging');
      drag.ghost.remove();
    }
    var from = drag.ghost.getBoundingClientRect(), to = drag.button.getBoundingClientRect(), list = stationList.getBoundingClientRect();
    if (!animate || to.bottom <= list.top || to.top >= list.bottom) { clean(); return; }
    var motion = global.EditorMotion.play(drag.ghost, [{ translate: '0px 0px' }, {
      translate: (to.left - from.left) + 'px ' + (to.top - from.top) + 'px', opacity: 1,
    }]);
    if (!motion) { clean(); return; }
    stationLanding = function () { motion.cancel(); clean(); stationLanding = null; };
    motion.finished.then(function () { clean(); stationLanding = null; }, clean);
  }

  function finishStationDrag(cancel, animate = true) {
    var drag = stationDrag;
    if (!drag) return;
    stationDrag = null;
    if (!drag.ghost) return;
    global.cancelAnimationFrame(drag.frame);
    var commit = !cancel && drag.gap !== null;
    if (commit) stationList.classList.add('station-order-committing');
    stationList.classList.remove('station-drop-active');
    drag.cards.forEach(function (card) { card.style.translate = ''; });
    suppressStationClick = true;
    setTimeout(function () { suppressStationClick = false; }, 0);
    if (commit) {
      changeStationOrder(function (state) { return S.reorderStation(state, drag.button.dataset.id, drag.gap); });
      App.select(drag.button.dataset.id);
      stationList.getBoundingClientRect();
      stationList.classList.remove('station-order-committing');
    }
    landStationCard(drag, animate);
  }

  stationList.addEventListener('pointerdown', function (event) {
    var button = event.target.closest('.station-item');
    if (!button || event.target.closest('.station-current') || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || stationDrag || App.state.stations.length < 2) return;
    if (event.pointerType === 'touch' && !event.target.closest('.station-drag-handle')) return;
    stationLanding?.();
    var cards = Array.from(stationList.children);
    stationDrag = { button, cards, from: cards.indexOf(button), pointer: event.pointerId, startX: event.clientX, startY: event.clientY, gap: null };
  });
  document.addEventListener('pointermove', function (event) {
    var drag = stationDrag;
    if (drag?.pointer !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.ghost && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return;
    event.preventDefault();
    if (!drag.ghost) {
      var bounds = drag.button.getBoundingClientRect();
      drag.grabX = drag.startX - bounds.left;
      drag.grabY = drag.startY - bounds.top;
      drag.button.classList.add('station-dragging');
      drag.ghost = drag.button.cloneNode(true);
      drag.ghost.removeAttribute('aria-pressed');
      drag.ghost.className = 'station-item station-drag-ghost';
      drag.ghost.setAttribute('aria-hidden', 'true');
      drag.ghost.inert = true;
      drag.ghost.style.width = bounds.width + 'px';
      document.body.appendChild(drag.ghost);
      drag.frame = global.requestAnimationFrame(scrollStationDrag);
    }
    drag.ghost.style.left = (drag.x - drag.grabX) + 'px';
    drag.ghost.style.top = (drag.y - drag.grabY) + 'px';
    updateStationDrop();
  }, { passive: false });
  document.addEventListener('pointerup', function (event) {
    if (stationDrag?.pointer !== event.pointerId) return;
    if (stationDrag.ghost) {
      stationDrag.x = event.clientX;
      stationDrag.y = event.clientY;
      updateStationDrop();
    }
    finishStationDrag(false);
  });
  document.addEventListener('pointercancel', function (event) { if (stationDrag?.pointer === event.pointerId) finishStationDrag(true); });
  global.addEventListener('blur', function () { finishStationDrag(true); });
  $('station-list').addEventListener('click',function(event){if(suppressStationClick){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
  $('station-list').addEventListener('keydown',function(event){
    var card=event.target.closest('.station-item');
    if(card&&event.altKey&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) {
      event.preventDefault();var id=card.dataset.id,delta=['ArrowUp','ArrowLeft'].includes(event.key)?-1:1;
      changeStationOrder(function (state) { return S.moveStation(state, id, delta); });
      App.select(id);
      card.querySelector('.station-select').focus();
    }
  });
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&stationDrag){event.preventDefault();finishStationDrag(true);}});
  function numberColor(number, city) { return Core.lineColorFor(number, city)?.bg || '#424A52'; }
  function transferNumber(input) {
    var number = input.value.trim().normalize('NFKC');
    return /^\d{1,8}$/.test(number) ? number : '';
  }
  function buildTransferRow(stationId, transfer, index) {
    var textLine = transfer.type === 'text';
    var row = document.createElement('div'); row.className = 'transfer-color';
    var heading = document.createElement('div'); heading.className = 'transfer-entry-heading';
    var title = document.createElement('span'); title.className = 'transfer-color-label';
    var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'transfer-remove';
    remove.dataset.controlIcon = 'delete'; remove.title = '删除这条换乘线路';
    heading.append(title, remove); row.append(heading);
    var getTransfer = function () { return App.state.stations.find(function (station) { return station.id === stationId; })?.transfers[index]; };
    function updateTransfer(change, field) {
      if (!row.isConnected) return;
      return App.update(function (state) {
        var station = state.stations.find(function (entry) { return entry.id === stationId; });
        var current = station?.transfers[index];
        if (!current) return state;
        var items = station.transfers.slice(), next = change(current, state.city);
        if (next) items[index] = next;
        else items.splice(index, 1);
        return S.patchStation(state, stationId, { transfers: items });
      }, field && stationId + ':transfer:' + index + ':' + field);
    }
    remove.addEventListener('click', function () {
      if (!updateTransfer(function () { return null; })) return;
      (transferRows[Math.min(index, transferRows.length - 1)]?.remove || $('new-transfer-number')).focus();
      notice('已删除换乘线路', 'success');
    });
    var fields = (textLine ? [['nameZh', '中文线路名', 40], ['nameEn', '英文线路名', 80]] : [['number', '线路号', 8]]).map(function ([key, label, limit]) {
      var field = document.createElement('div'); field.className = 'field';
      var name = document.createElement('label'); name.textContent = label;
      var input = document.createElement('input'); input.type = 'text'; input.maxLength = limit;
      input.id = 'transfer-' + index + '-' + key; input.dataset.transferField = key; name.htmlFor = input.id;
      field.append(name, input); row.append(field);
      if (key === 'number') {
        input.inputMode = 'numeric';
        input.addEventListener('change', function () {
          var number = transferNumber(input);
          if (!number) { input.value = getTransfer()?.number || ''; notice('线路号须为 1–8 位数字', 'warning'); return; }
          input.value = number;
          updateTransfer(function (current, city) {
            var color = current.color === numberColor(current.number, city) ? numberColor(number, city) : current.color;
            return { number: number, color: color };
          }, key);
        });
      } else {
        input.addEventListener('input', function () {
          if (key === 'nameZh' && !input.value.trim()) return;
          updateTransfer(function (current) { return Object.assign({}, current, { [key]: input.value }); }, key);
        });
        input.addEventListener('blur', function () { input.value = getTransfer()?.[key] || ''; });
      }
      return input;
    });
    var picker = global.SignColorPicker.create({ value: transfer.color, mini: true, scope: '换乘线路颜色',
      getValue: function () { return getTransfer()?.color; }, getCity: function () { return App.state.city; }, onCityChange: changeCity,
      onChange: function (color) { updateTransfer(function (current) { return Object.assign({}, current, { color: color }); }, 'color'); },
    });
    row.append(picker);
    return { row, title, remove, fields, picker };
  }
  function syncTransfers() {
    var station = live(), items = station.transfers;
    var signature = station.id + ':' + items.map(function (item) { return item.type || 'number'; }).join(',');
    if (signature !== transferSignature) {
      transferRows = items.map(function (item, index) { return buildTransferRow(station.id, item, index); });
      $('transfer-colors').replaceChildren(...transferRows.map(function (entry) { return entry.row; }));
      transferSignature = signature;
    }
    transferRows.forEach(function (entry, index) {
      var item = items[index], label = item.type === 'text' ? item.nameZh : item.number + ' 号线';
      entry.title.textContent = label;
      entry.remove.setAttribute('aria-label', '删除换乘线路 ' + label);
      entry.fields.forEach(function (input) { if (document.activeElement !== input) input.value = item[input.dataset.transferField]; });
      entry.picker.sync();
    });
    $('transfer-count').textContent = items.length + ' / 6';
    $('transfer-empty').hidden = !!items.length;
    $('new-transfer-number').disabled = $('add-number-transfer').disabled = $('add-text-transfer').disabled = items.length >= 6;
  }
  function changeCity(city) { var auto=Core.lineColorFor(App.state.line,city);set(Object.assign({city:city},auto?{color:auto.bg}:{})); }
  function syncPropertyPanel() {
    var keys = App.selectedKeys();
    var hasSelection = keys.length > 0;
    var multiple = keys.length > 1;
    var selectedStationCount = hasSelection ? App.selectedStationIds().length : 0;
    var showStation = !multiple && selectedStationCount === 1;
    var selectedElement = findElement(App.selectedKey);
    var showPosition = keys.some(findElement);
    var selectionName = multiple ? '已选中 ' + keys.length + ' 项' : selectedElement ? selectedElement.label : '';

    var settings = $('property-settings'), selection = $('property-selection');
    var switchedSection = settings.hidden !== hasSelection;
    if (switchedSection) {
      settings.hidden = hasSelection;
      selection.hidden = !hasSelection;
    }
    $('return-to-settings').hidden = !hasSelection;
    $('property-heading').textContent = !hasSelection ? '标识牌设置' : multiple ? '批量属性' : showStation ? '站点属性' : '元素属性';
    $('property-selection-name').hidden = !selectionName || showStation;
    $('property-selection-name').textContent = selectionName;
    $('station-properties').hidden = !showStation;
    $('transfer-properties').hidden = !showStation;
    $('element-properties').hidden = !showPosition;
    $('element-offsets').hidden = multiple;
    $('move-selection').hidden = !multiple;
    $('station-management').hidden = !selectedStationCount;
    $('single-station-actions').hidden = multiple;
    $('delete-selected-stations').hidden = !multiple;
    $('delete-selected-stations').disabled = App.state.stations.length <= 1;
    propertyTabs.sync(!hasSelection ? 'settings' : multiple ? 'multiple' : showStation ? 'station' : 'element');

    var panelSelection = JSON.stringify([App.selectedKey, keys]);
    if (panelSelection !== previousPanelSelection) {
      $('property-scroll').scrollTop = 0;
      $('station-transfers').setCustomValidity('');
      $('new-transfer-number').value = '';
      $('new-transfer-number').setCustomValidity('');
      if (previousPanelSelection) {
        var direction = switchedSection ? (hasSelection ? 1 : -1) : 0;
        global.EditorMotion.reveal(hasSelection ? selection : settings, direction);
      }
      previousPanelSelection = panelSelection;
    }
  }
  function syncSizeSettings(state, size) {
    var hanging = state.mode !== 'vertical';
    var widthInGrids = size.width / Core.SIGN_GRID_SIZE;
    var standardLength = Number.isInteger(widthInGrids) && widthInGrids >= 1 && widthInGrids <= 15;
    var standardHeight = size.height === 192 || size.height === 256;
    if (layoutMode !== state.mode) {
      $('output-width-label').textContent = hanging ? '吊板长度' : '固定宽度';
      $('output-height-label').textContent = hanging ? '吊板短边' : '高度';
      ['hanging-length', 'hanging-height', 'hanging-length-labels', 'hanging-height-labels'].forEach(function (id) {
        $(id).hidden = !hanging;
      });
      $('travel-direction').options[0].textContent = hanging ? '前往列表首站 ←' : '前往列表首站 ↓';
      $('travel-direction').options[1].textContent = hanging ? '前往列表末站 →' : '前往列表末站 ↑';
      layoutMode = state.mode;
    }
    $('output-width').readOnly = !hanging;
    $('vertical-layout-controls').hidden = hanging;
    $('swap-vertical-columns').hidden = state.verticalVariant !== 'double';
    $('travel-direction-label').textContent = !hanging && state.verticalVariant === 'double' ? '基准行车方向（与吊板共用）' : '列车行驶方向';
    var lengthDescription = standardLength ? widthInGrids + ' 格' : '自定义';
    var heightDescription = standardHeight ? (size.height === 192 ? '地铁' : '单轨') : '自定义';
    $('hanging-length').value = Math.round(widthInGrids);
    $('hanging-height').value = size.height;
    $('hanging-length').setAttribute('aria-valuetext', lengthDescription + '，' + size.width + ' 像素');
    $('hanging-height').setAttribute('aria-valuetext', heightDescription + '，' + size.height + ' 像素');
    $('hanging-length-value').textContent = lengthDescription;
    $('hanging-height-value').textContent = standardHeight ? '' : heightDescription;
    value('vertical-variant', state.verticalVariant);
    value('output-width', size.width);
    value('output-height', size.height);
    value('font-scale', state.fontScale);
    $('font-scale-label').textContent = Math.round(state.fontScale * 100) + '%';
  }
  function sync() {
    var state = App.state, s = live(), size = state.sizes[state.mode];
    if(paletteRevision!==global.SignPalettes.revision()) {
      global.SignColorPicker.syncPaletteSelect($('palette-city'),state.city);paletteRevision=global.SignPalettes.revision();
    }
    syncList(); syncTransfers();basePickers.forEach(function(picker){picker.sync();});
    syncPropertyPanel();
    syncSizeSettings(state, size);
    $('station-direction-option').hidden = state.mode !== 'station';
    $('show-station-direction').setAttribute('aria-checked', String(state.showStationDirection));
    var offset = state.adjustments[App.selectedKey] || { x: 0, y: 0 };
    value('element-offset-x', offset.x); value('element-offset-y', offset.y);
    document.querySelectorAll('[data-mode]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode)); });
    $('preview-title').textContent = names[state.mode]; $('preview-dimensions').textContent = size.width + ' × ' + size.height + ' 像素';
    value('line-number', state.line); value('palette-city', state.city); value('travel-direction', state.direction);
    if (syncLinePattern) syncLinePattern(state);
    value('station-code', s.code); value('station-zh', s.zh); value('station-en', s.en);
    value('station-transfers', S.formatTransfers(s.transfers));
    $('current-station-label').hidden = s.id !== state.currentId;
    $('set-current').disabled = s.id === state.currentId;
    var index = state.stations.findIndex(function (item) { return item.id === s.id; });
    $('station-up').disabled = index === 0; $('station-down').disabled = index === state.stations.length - 1; $('station-delete').disabled = state.stations.length <= 1;
    $('undo').disabled = !undo.length; $('redo').disabled = !redo.length;
    if (global.PlatformClipboard) global.PlatformClipboard.sync();
  }
  document.querySelectorAll('[data-mode]').forEach(function (button) {
    button.addEventListener('click', function () {
      var mode = button.dataset.mode;
      if (set({ mode: mode })) notice('已切换到' + names[mode], 'information');
      App.deselect();
    });
  });
  $('return-to-settings').addEventListener('click', function () {
    App.deselect();
    $('property-heading').focus({ preventScroll: true });
  });
  // Preserve controls and text drag selections while allowing blank clicks anywhere on the page.
  var selectionControls = 'button, input, select, textarea, label, a, summary, [contenteditable], [role="button"], .field, .station-item, .platform-section, #platform-element-toolbar, dialog';
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
    catch (err) { event.target.setCustomValidity(err.message); notice(err.message, 'warning'); }
  });
  $('station-transfers').addEventListener('input', function (event) { event.target.setCustomValidity(''); });
  $('add-number-transfer-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var input = $('new-transfer-number'), number = transferNumber(input), station = live();
    if (station.transfers.length >= 6) return;
    if (!number) {
      var message = '请输入 1–8 位数字作为线路号';
      input.setCustomValidity(message);
      input.focus();
      notice(message, 'warning');
      return;
    }
    if (!patchStation({ transfers: station.transfers.concat({ number: number, color: numberColor(number, App.state.city) }) })) return;
    input.value = ''; input.setCustomValidity('');
    (input.disabled ? transferRows.at(-1).fields[0] : input).focus();
    notice('已添加 ' + number + ' 号线换乘', 'success');
  });
  $('new-transfer-number').addEventListener('input', function (event) { event.target.setCustomValidity(''); });
  $('add-text-transfer').addEventListener('click', function () {
    var station = live();
    if (station.transfers.length >= 6) return;
    if (!patchStation({ transfers: station.transfers.concat({ type: 'text', nameZh: '文字线路', nameEn: '', color: '#0057B8' }) })) return;
    var input = transferRows.at(-1).fields[0]; input.focus(); input.select();
    notice('已添加文字换乘线路', 'success');
  });
  $('line-number').addEventListener('input', function (event) {
    var state = App.state, n = event.target.value, auto = Core.lineColorFor(n, state.city);
    var patch = { line: n };
    if (state.lineName === state.line + '号线' || state.lineName===state.line) patch.lineName = /^\d+$/.test(n)?n+'号线':n;
    if (auto) patch.color = auto.bg;
    set(patch, 'line-number');
  });
  $('palette-city').addEventListener('change', function (event) { changeCity(event.target.value); });
  $('travel-direction').addEventListener('change', function (event) {
    if (set({ direction: Number(event.target.value) })) notice('已更改行车方向', 'success');
  });
  $('show-station-direction').addEventListener('click', function () { set({ showStationDirection: !App.state.showStationDirection }); });
  $('vertical-variant').addEventListener('change', function(event) { App.update(function(state){return S.setVerticalVariant(state,event.target.value);}); });
  $('swap-vertical-columns').addEventListener('click', function () {
    if (App.update(S.swapVerticalColumns)) notice('已交换左右两列', 'success');
  });
  $('reverse-stations').addEventListener('click', function () {
    if (App.update(S.reverseStations)) notice('已倒转站点顺序', 'success');
  });
  $('font-scale').addEventListener('input', function (event) { set({ fontScale: Number(event.target.value) }, 'font-scale'); });
  [['hanging-length', S.setHangingLength], ['hanging-height', S.setHangingHeight]].forEach(function (setting) {
    var slider = $(setting[0]);
    slider.addEventListener('input', function () {
      App.update(function (state) { return setting[1](state, slider.valueAsNumber); }, slider.id, { continuous: true });
    });
    slider.addEventListener('change', function () { groupKey = null; });
  });
  document.querySelectorAll('[data-nudge-x]').forEach(function (button) {
    button.addEventListener('click', function () {
      var keys = selectedVisibleKeys();
      if (keys.length) App.update(function (state) { return S.nudgeElements(state, keys, Number(button.dataset.nudgeX), Number(button.dataset.nudgeY)); });
    });
  });
  ['x', 'y'].forEach(function (axis) { $('element-offset-' + axis).addEventListener('change', function (event) { if (!App.selectedKey) return; var n = Number(event.target.value); if (!Number.isFinite(n) || n < -128 || n > 128) { notice('微调范围为 −128 至 128 像素', 'warning'); event.target.value = (App.state.adjustments[App.selectedKey] || {})[axis] || 0; return; } var patch = {}; patch[axis] = n; App.update(function (state) { return S.setElementOffset(state, App.selectedKey, patch); }); }); });
  function resetElement() {
    var keys = selectedVisibleKeys();
    if (keys.length && App.update(function (state) { return S.resetElements(state, keys); })) notice('已恢复选中元素的位置', 'success');
  }
  $('tool-reset').addEventListener('click', resetElement); $('reset-element').addEventListener('click', resetElement);
  [['tool-up', 'station-up'], ['tool-down', 'station-down'], ['tool-delete', 'station-delete']].forEach(function (pair) { $(pair[0]).addEventListener('click', function () { $(pair[1]).click(); }); });
  function setSize(patch) {
    if(App.state.mode==='vertical'&&patch.width!==undefined)return;
    var sizes = Object.assign({}, App.state.sizes); sizes[App.state.mode] = Object.assign({}, sizes[App.state.mode], patch); set(Object.assign({ sizes: sizes }, App.state.mode === 'route' && patch.width !== undefined ? { routeLengthAuto: false } : {}));
  }
  ['width', 'height'].forEach(function (key) {
    $('output-' + key).addEventListener('change', function (event) {
      if(App.state.mode==='vertical'&&key==='width'){event.target.value=App.state.sizes.vertical.width;return;}
      var n = Number(event.target.value);
      if (!Number.isFinite(n) || n < 128 || n > 8192) { event.target.value = App.state.sizes[App.state.mode][key]; notice('尺寸须为 128–8192 像素', 'warning'); return; }
      var patch = {}; patch[key] = Math.round(n); setSize(patch);
    });
  });
  function setCurrentStation(id) {
    if (id === App.state.currentId) return;
    var stationMode = App.state.mode === 'station', hadSelection = !!App.selectedKey;
    if (!App.update(function (state) { return S.settings(state, { currentId: id }); }, null, { clearSelection: stationMode })) return;
    if (stationMode && hadSelection) App.select(id);
    var station = App.state.stations.find(function (entry) { return entry.id === App.state.currentId; });
    notice('已将「' + (station.zh || '未命名站点') + '」设为本站', 'success');
  }
  $('set-current').addEventListener('click', function () { setCurrentStation(App.selectedId); });
  $('tool-current').addEventListener('click', function () { setCurrentStation(App.selectedId); });
  $('add-station').addEventListener('click', function () {
    var previous = App.state;
    App.update(function (state) { return S.addStation(state, App.selectedId); });
    var added = App.state.stations.find(function (s) { return !previous.stations.some(function (old) { return old.id === s.id; }); });
    if (added) {
      App.select(added.id);
      global.EditorPanels.expand('platform-properties');
      propertyTabs.show('edit');
      $('station-zh').focus();
      $('station-zh').select();
      notice('已添加站点', 'success');
    }
  });
  $('station-delete').addEventListener('click', App.deleteSelection);
  $('delete-selected-stations').addEventListener('click', App.deleteSelection);
  [['station-up', -1], ['station-down', 1]].forEach(function ([identifier, distance]) {
    $(identifier).addEventListener('click', function () {
      changeStationOrder(function (state) { return S.moveStation(state, App.selectedId, distance); });
    });
  });
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
      App.select(App.state.currentId); $('batch-dialog').close(); notice('已更新 ' + stations.length + ' 个站点', 'success');
    } catch (err) { $('batch-error').textContent = err.message; }
  });
  function filename(ext, state) { return 'platform-' + state.mode + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + ext; }
  function serializeProject() { return S.serialize(App.state); }
  function exportProject() {
    global.SignStorage.exportProject(serializeProject, filename('json', App.state), notice, App.download);
  }
  var projectFile = $('project-file');
  $('save-project').addEventListener('click', exportProject);
  $('import-project').addEventListener('click', function () { projectFile.click(); });
  function selectLibrary(name) {
    var changed = library !== name;
    library = name;
    document.querySelectorAll('[data-library]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.library === name)); });
    $('station-library').hidden = name !== 'stations'; $('preset-library').hidden = name !== 'presets';
    if (name === 'presets') syncPresets();
    if (changed) global.EditorMotion.reveal($(name === 'presets' ? 'preset-library' : 'station-library'), name === 'presets' ? 1 : -1);
  }
  function persistPresets(next) {
    try { localStorage.setItem(PRESET_KEY, P.serialize(next)); }
    catch (err) { notice('预设保存失败：本地空间不足，请保存项目 JSON', 'error'); return false; }
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
        var state = S.deserialize(S.serialize(current.state)); App.update(function () { return state; }); App.selectedId = state.currentId; App.deselect(); notice('已载入预设：' + current.name, 'success');
      });
      var remove = document.createElement('button'); remove.className = 'preset-remove'; remove.dataset.controlIcon = 'delete'; remove.setAttribute('aria-label', '删除预设 ' + preset.name);
      remove.addEventListener('click', function () {
        var remaining = presets.filter(function (item) { return item.id !== preset.id; });
        if (remaining.length !== presets.length && persistPresets(remaining)) notice('已删除预设「' + preset.name + '」', 'success');
      });
      card.append(load, remove); list.appendChild(card);
    });
    list.scrollTop = scroll;
  }
  function showPresetDialog() {
    if (presets.length >= 30) { notice('最多保存 30 个预设，请先删除不需要的预设', 'warning'); return; }
    $('preset-name').value = App.state.lineName + ' · ' + names[App.state.mode]; $('preset-error').textContent = ''; $('preset-dialog').showModal(); $('preset-name').select();
  }
  document.querySelectorAll('[data-library]').forEach(function (button) { button.addEventListener('click', function () { selectLibrary(button.dataset.library); }); });
  $('save-preset').addEventListener('click', showPresetDialog); $('save-preset-shortcut').addEventListener('click', showPresetDialog);
  function savePreset() {
    try { var preset = P.create(App.state, $('preset-name').value); if (persistPresets(presets.concat([preset]))) { $('preset-dialog').close(); selectLibrary('presets'); notice('预设已保存到本机', 'success'); } }
    catch (err) { $('preset-error').textContent = err.message; }
  }
  $('preset-dialog').querySelector('.dialog-close').addEventListener('click', function () { $('preset-dialog').close(); });
  $('preset-dialog').querySelector('form').addEventListener('submit', function (event) { event.preventDefault(); savePreset(); });
  function drawExportSVG(scene, embedData) {
    var svg = document.createElementNS(Core.SVG_NS, 'svg'); R.draw(svg, scene, { clean: true });
    if (embedData) {
      var style = document.createElementNS(Core.SVG_NS, 'style');
      style.textContent = SignExporters.buildFontCSS(scene.usedFonts, embedData);
      svg.insertBefore(style, svg.firstChild);
    }
    svg.querySelectorAll('[data-station-id], [data-element-key], [data-role]').forEach(function (el) { ['data-station-id', 'data-element-key', 'data-role'].forEach(function (attr) { el.removeAttribute(attr); }); });
    return svg;
  }
  function serializeExportSVG(svg) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
  }
  function buildSVG(state, measure, embedData, scene) {
    scene = scene || R.metrics(state, measure);
    return serializeExportSVG(drawExportSVG(scene, embedData));
  }
  function pngBlob(source, size, scale, signal) {
    return SignExporters.rasterizePNG(source, size, scale, signal);
  }
  async function prepareExport(state, signal) {
    await App.ready;
    if (signal) signal.throwIfAborted();
    var scene = R.metrics(state, App.measure);
    var fonts = await SignExporters.ensureUsedFontData(scene.usedFonts, { scene: scene });
    if (signal) signal.throwIfAborted();
    var drawing = drawExportSVG(scene, fonts);
    return {
      drawing: drawing,
      size: scene.output,
      get source() { return serializeExportSVG(drawing); },
    };
  }
  async function exportFile(format) {
    if (busy) return;
    var state = App.state, scale = format === 'png' ? Number($('png-scale').value) : 1;
    busy = true; $('export-png').disabled = $('export-svg').disabled = true;
    var dismissProgress = notice('正在生成 ' + format.toUpperCase() + '…');
    try {
      var prepared = await prepareExport(state);
      var blob = format === 'svg' ? new Blob([prepared.source], { type: 'image/svg+xml;charset=utf-8' }) : await pngBlob(prepared.drawing, prepared.size, scale);
      App.download(blob, filename(format, state)); notice(format.toUpperCase() + ' 已导出 · ' + state.sizes[state.mode].width * scale + ' × ' + state.sizes[state.mode].height * scale + ' 像素', 'success');
    } catch (err) { notice('导出失败：' + err.message, 'error'); }
    finally { dismissProgress(); busy = false; $('export-png').disabled = $('export-svg').disabled = false; }
  }
  global.PlatformExport = { buildSVG: buildSVG, drawSVG: drawExportSVG, prepare: prepareExport, pngBlob: pngBlob, exportFile: exportFile };
  $('export-svg').addEventListener('click', function () { exportFile('svg'); }); $('export-png').addEventListener('click', function () { exportFile('png'); });
  global.ImageUploadDialog.addButton($('export-svg'), async function () {
    var prepared = await prepareExport(App.state);
    return pngBlob(prepared.drawing, prepared.size);
  });
  [['line-color-picker','color','线路色','line-color','line-color-hex'],['background-color-picker','background','标识牌背景','background-color'],['muted-color-picker','muted','已驶过','muted-color']].forEach(function(spec){
    var picker=global.SignColorPicker.create({value:App.state[spec[1]],scope:spec[2],nativeId:spec[3],hexId:spec[4],swatchesId:spec[1]==='color'?'platform-swatches':undefined,
      getCity:function(){return App.state.city;},onCityChange:changeCity,getValue:function(){return App.state[spec[1]];},onChange:function(color){var patch={};patch[spec[1]]=color;set(patch,spec[3]);}});
    $(spec[0]).appendChild(picker);basePickers.push(picker);
  });
  global.addEventListener('sign-palettes-change',function(){
    if(!Core.isPalette(App.state.city))set({city:'chongqing'});else sync();
  });
  global.PlatformClipboard.init(App, notice);
  if (global.PlatformPatterns) {
    syncLinePattern = global.PlatformPatterns.init($('line-pattern-section'), {
      read: function () { return App.state; },
      update: function (changes, group) {
        App.update(function (state) {
          return S.settings(state, { linePattern: Object.assign({}, state.linePattern, changes) });
        }, group);
      },
      notice: notice,
    });
  }
  var loader = global.EditorLoader ? global.EditorLoader.createSession({
    editor: 'platform',
    stages: [
      { id: 'fonts', label: '标识牌字体', weight: 65, detail: '等待中' },
      { id: 'projects', label: '本地项目与存档', weight: 20, detail: '等待中' },
      { id: 'workspace', label: '站台排版渲染', weight: 15, detail: '等待中' },
    ],
  }) : null;
  render();
  var platformUsedFonts = Object.assign({ zh400: true, num400: true }, App.scene && App.scene.usedFonts);
  var platformSpecs = global.SignFontManager
    ? global.SignFontManager.specsForUsedFonts(platformUsedFonts, Core.FONT_LOAD_SPECS)
    : Core.FONT_LOAD_SPECS;
  var platformSampleText = '新站点换乘列车行驶方向 Station Transfer 0123456789' +
    (App.state.line || '') + (App.state.lineName || '') +
    App.state.stations.map(function (s) { return (s.zh || '') + (s.en || '') + (s.code || ''); }).join('');
  function refreshAfterFonts() {
    App.measure = Core.createCanvasMeasurer();
    render();
    presetSignature = '';
    if (library === 'presets') syncPresets();
  }
  var fontsReady = loader
    ? loader.loadFonts(platformSpecs, {
        sampleText: platformSampleText,
        stageId: 'fonts',
        onLateReady: function () {
          refreshAfterFonts();
          notice('标识牌字体已就绪，已按真实字形重新排版', 'success');
        },
      }).then(function (ok) {
        refreshAfterFonts();
        if (!ok) notice('部分字体加载较慢，将在后台继续重试；也可在「设置」导入本机字体', 'warning');
      })
    : Promise.all(platformSpecs.map(function (spec) { return document.fonts.load(spec.css, platformSampleText); })).then(refreshAfterFonts).catch(function (err) { notice('字体加载失败，当前使用备用字体：' + err.message, 'warning'); });
  if (global.SignFontManager) {
    global.SignFontManager.watchFontUpdates(refreshAfterFonts);
  }
  global.PlatformBatchDialog.init(App, notice);
  if (loader) loader.setStage('projects', 'active', 0.3, '连接本地项目库');
  App.projectStorage = global.SignProjectDialog.init(App, {
    library: global.PlatformProjects,
    editor: 'platform',
    graphic: $('platform-svg'),
    fileInput: projectFile,
    notice: notice,
    exportProject: exportProject,
    deserialize: async function (source) {
      var project = S.deserialize(source);
      await global.PlatformPatterns.validateImage(project.linePattern.image);
      return project;
    },
    drawThumbnail: async function (state, signal) {
      await App.ready;
      signal.throwIfAborted();
      const scene = R.metrics(state, App.measure);
      return { drawing: drawExportSVG(scene), size: scene.output, usedFonts: scene.usedFonts, fontOptions: { scene: scene }, cropVertical: state.mode === 'vertical' };
    },
    formatDetails: function (project) { return (project.lineName || '未命名线路') + ' · ' + (project.stationCount || 0) + ' 站'; },
  });
  var projectReady = App.projectStorage.ready.then(function () {
    if (loader) loader.setStage('projects', 'done', 1, '已同步本地项目');
  });
  App.ready = Promise.all([fontsReady, projectReady]).then(function () {
    if (loader) {
      loader.setStage('workspace', 'done', 1, '已渲染站台标识');
      loader.finish('准备就绪');
    }
  });
})(window);
