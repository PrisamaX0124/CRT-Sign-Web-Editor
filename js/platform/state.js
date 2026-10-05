/* Modified by PrisamaX0124, 2026-10-05: public release data and storage separation; see docs/fork-changes.md. */
/** Independent platform projects; all edits return new objects. */
(function (global) {
  'use strict';
  var Core = global.SignCore;
  var MODES = ['route', 'station', 'vertical'];
  var DEFAULT_SIZES = { route: { width: 768, height: 192 }, station: { width: 512, height: 192 } };
  function verticalGeometry(count, variant, height) {
    var width=variant==='double'?640:384; height=Math.round(number(height,768,128,8192));
    var contentHeight=height/.75,unit=Math.min(1,(contentHeight-72)/(208+(count-1)*64));
    return {width:width,height:height,contentWidth:width/.75,contentHeight:contentHeight,scale:.75,bodyUnit:unit,first:72+104*unit,last:contentHeight-104*unit};
  }
  function str(value, fallback, limit) {
    return typeof value === 'string' ? value.slice(0, limit || 160) : fallback;
  }
  function number(value, fallback, lo, hi) {
    return typeof value === 'number' && Number.isFinite(value) ? Core.clamp(value, lo, hi) : fallback;
  }
  function transfer(value, city) {
    if (!value || typeof value !== 'object') return null;
    var n = str(value.number, '', 8).trim();
    if (!n) return null;
    var auto = Core.lineColorFor(n, city);
    return { number: n, color: Core.normalizeHex(value.color) || (auto ? auto.bg : '#424A52') };
  }
  function station(value, i, city, ids) {
    value = value && typeof value === 'object' ? value : {};
    var id = str(value.id, '', 80);
    if (!id || ids.has(id)) id = Core.uuid();
    ids.add(id);
    return {
      id: id, code: str(value.code, String(i + 1).padStart(2, '0'), 8),
      zh: str(value.zh, '新站点', 80), en: str(value.en, '', 160),
      transfers: (Array.isArray(value.transfers) ? value.transfers : []).slice(0, 6).map(function (t) { return transfer(t, city); }).filter(Boolean),
    };
  }
  function sanitize(value) {
    if (!value || value.kind !== 'platform-sign' || [1,2,3].indexOf(value.version) < 0) throw new Error('请选择站台标识项目 JSON（版本 1–3）');
    if (!Array.isArray(value.stations) || value.stations.length < 1 || value.stations.length > 120) throw new Error('站点数量须为 1–120');
    var city = Core.PALETTE_CITY_ORDER.indexOf(value.city) >= 0 ? value.city : 'chongqing';
    var ids = new Set(), stations = value.stations.map(function (s, i) { return station(s, i, city, ids); });
    var sizes = {};
    MODES.forEach(function (mode) {
      if(mode==='vertical') {var verticalSize=value.sizes&&value.sizes.vertical||{},geometry=verticalGeometry(stations.length,value.verticalVariant,value.verticalHeightAuto===true?768:verticalSize.height);sizes.vertical={width:geometry.width,height:geometry.height};return;}
      var size = value.sizes && value.sizes[mode] || {};
      if (value.version === 1 && ((mode === 'route' && size.width === 3072 && size.height === 768) || (mode === 'station' && size.width === 1536 && size.height === 768))) size = DEFAULT_SIZES[mode];
      if (value.version < 3 && mode === 'route' && size.width === 768 && size.height === 256) size = { width: 1280, height: 256 };
      sizes[mode] = {
        width: Math.round(number(size.width, DEFAULT_SIZES[mode].width, 128, 8192)),
        height: Math.round(number(size.height, DEFAULT_SIZES[mode].height, 128, 8192)),
      };
    });
    var adjustments = {};
    Object.keys(value.adjustments && typeof value.adjustments === 'object' ? value.adjustments : {}).forEach(function (key) {
      if (!validElementKey(key, stations)) return;
      var offset = value.adjustments[key] || {};
      adjustments[key] = { x: number(offset.x, 0, -128, 128), y: number(offset.y, 0, -128, 128) };
    });
    return {
      kind: 'platform-sign', version: 3,
      mode: MODES.indexOf(value.mode) >= 0 ? value.mode : 'route', city: city,
      line: str(value.line, '10', 8), lineName: str(value.lineName, '10号线', 40),
      color: Core.normalizeHex(value.color) || '#5F249F',
      background: Core.normalizeHex(value.background) || '#FFFFFF',
      muted: Core.normalizeHex(value.muted) || '#A6A6A6',
      direction: value.direction === 1 ? 1 : -1,
      verticalVariant: ['left', 'right', 'double'].indexOf(value.verticalVariant) >= 0 ? value.verticalVariant : 'left',
      verticalSwapped: value.verticalSwapped === true,
      verticalLayout: 'responsive',
      verticalWidthAuto: true, verticalHeightAuto: false,
      currentId: stations.some(function (s) { return s.id === value.currentId; }) ? value.currentId : stations[0].id,
      fontScale: number(value.fontScale, 1, 0.7, 1.4),
      showStationDirection: value.showStationDirection !== false,
      texture: false,
      routeLayout: 'responsive',
      routeLengthAuto: sizes.route.width === (sizes.route.height === 256 ? 1280 : 768) && (value.version < 3 || value.routeLengthAuto !== false),
      sizes: sizes, stations: stations, adjustments: adjustments,
    };
  }
  function create() {
    var id = Core.uuid();
    return sanitize({ kind: 'platform-sign', version: 3, city: 'chongqing', line: '1', lineName: '1号线', color: Core.lineColorFor('1', 'chongqing').bg, currentId: id,
      stations: [{ id: id, code: '01', zh: '新站点', en: 'New Station', transfers: [] }] });
  }
  function validElementKey(key, stations) {
    return ['station:title', 'station:badge', 'station:left', 'station:right', 'station:direction', 'vertical:title', 'vertical:direction:left', 'vertical:direction:right'].indexOf(key) >= 0 || stations.some(function (s) { return key === 'route:' + s.id || key === 'vertical:left:' + s.id || key === 'vertical:right:' + s.id || key === 'vertical:transfer:' + s.id; });
  }
  function setVerticalVariant(state, variant) {
    if (['left','right','double'].indexOf(variant) < 0 || variant === state.verticalVariant) return state;
    return settings(state, {verticalVariant:variant});
  }
  function swapVerticalColumns(state) {
    return state.verticalVariant === 'double' ? settings(state,{verticalSwapped:!state.verticalSwapped}) : state;
  }
  function setHangingLength(state, units) {
    if (state.mode === 'vertical' || !Number.isInteger(units) || units < 1 || units > 15) return state;
    var sizes = Object.assign({}, state.sizes); sizes[state.mode] = Object.assign({}, sizes[state.mode], { width: units * Core.SIGN_GRID_SIZE });
    return settings(state, Object.assign({ sizes: sizes }, state.mode === 'route' ? { routeLengthAuto: false, routeLayout: 'responsive' } : {}));
  }
  function setHangingHeight(state, height) {
    if (height !== 192 && height !== 256) return state;
    var route = Object.assign({}, state.sizes.route, { height: height });
    if (state.routeLengthAuto) route.width = height === 256 ? 1280 : 768;
    return settings(state, { routeLayout: 'responsive', sizes: Object.assign({}, state.sizes, { route: route, station: Object.assign({}, state.sizes.station, { height: height }) }) });
  }
  function setElementOffset(state, key, patch) {
    if (!validElementKey(key, state.stations)) return state;
    var adjustments = Object.assign({}, state.adjustments);
    adjustments[key] = Object.assign({ x: 0, y: 0 }, adjustments[key], patch);
    return settings(state, { adjustments: adjustments });
  }
  function nudgeElement(state, key, dx, dy) {
    var old = state.adjustments[key] || { x: 0, y: 0 };
    return setElementOffset(state, key, { x: old.x + dx, y: old.y + dy });
  }
  function resetElement(state, key) {
    if (!state.adjustments[key]) return state;
    var adjustments = Object.assign({}, state.adjustments); delete adjustments[key];
    return settings(state, { adjustments: adjustments });
  }
  function settings(state, patch) {
    var next = Object.assign({}, state, patch), route = patch.sizes && patch.sizes.route;
    if (patch.stations && patch.stations.map(function(s){return s.id;}).join('|') !== state.stations.map(function(s){return s.id;}).join('|')) next.verticalLayout = 'responsive';
    if (route && (route.width !== state.sizes.route.width || route.height !== state.sizes.route.height)) next.routeLayout = 'responsive';
    return sanitize(next);
  }
  function patchStation(state, id, patch) {
    if (!state.stations.some(function (s) { return s.id === id; })) return state;
    return settings(state, { stations: state.stations.map(function (s) { return s.id === id ? Object.assign({}, s, patch, { id: id }) : s; }) });
  }
  function addStation(state, afterId) {
    if (state.stations.length >= 120) return state;
    var index = state.stations.findIndex(function (s) { return s.id === afterId; });
    var list = state.stations.slice();
    list.splice(index < 0 ? list.length : index + 1, 0, { id: Core.uuid(), code: String(list.length + 1).padStart(2, '0'), zh: '新站点', en: 'New Station', transfers: [] });
    return settings(state, { stations: list, routeLayout: 'responsive' });
  }
  function removeStation(state, id) {
    if (state.stations.length <= 1) return state;
    var index = state.stations.findIndex(function (s) { return s.id === id; });
    if (index < 0) return state;
    var list = state.stations.filter(function (s) { return s.id !== id; });
    return settings(state, { stations: list, routeLayout: 'responsive', currentId: state.currentId === id ? list[Math.min(index, list.length - 1)].id : state.currentId });
  }
  function moveStation(state, id, delta) {
    var index = state.stations.findIndex(function (s) { return s.id === id; });
    var target = index + delta;
    if (index < 0 || target < 0 || target >= state.stations.length) return state;
    var list = state.stations.slice(), item = list.splice(index, 1)[0];
    list.splice(target, 0, item);
    return settings(state, { stations: list, routeLayout: 'responsive' });
  }
  function reorderStation(state, id, gap) {
    var from = state.stations.findIndex(function(s) { return s.id === id; });
    if (from < 0 || !Number.isInteger(gap) || gap < 0 || gap > state.stations.length) return state;
    var to = gap > from ? gap - 1 : gap;
    if (to === from) return state;
    var list = state.stations.slice(), item = list.splice(from, 1)[0];
    list.splice(to, 0, item);
    return settings(state, { stations: list, routeLayout: 'responsive' });
  }
  function reverseStations(state) {
    if (state.stations.length < 2) return state;
    return settings(state, { stations: state.stations.slice().reverse(), routeLayout: 'responsive' });
  }
  function replaceStations(state, stations) {
    return settings(state, { stations: stations, routeLayout: 'responsive' });
  }
  function neighbors(state) {
    var i = state.stations.findIndex(function (s) { return s.id === state.currentId; });
    return { current: state.stations[i], next: state.stations[i + state.direction] || null, previous: state.stations[i - state.direction] || null };
  }
  function parseTransfers(text, city) {
    if (!text.trim()) return [];
    var items = text.split(/[,，]/).map(function (part) {
      var bits = part.trim().split(':');
      if (!bits[0] || bits[0].length > 8 || bits.length > 2 || (bits[1] && !Core.isHexColor(bits[1]))) throw new Error('换乘格式：1,5 或 1:#E4002B,5:#00A3E0');
      return transfer({ number: bits[0], color: bits[1] }, city);
    });
    if (items.length > 6) throw new Error('每站最多填写 6 条换乘线路');
    return items;
  }
  function parseStations(text, city) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length || lines.length > 120) throw new Error('请填写 1–120 行站点');
    return lines.map(function (line, index) {
      var parts = line.split('|').map(function (p) { return p.trim(); });
      if (parts.length < 2 || parts.length > 4 || !parts[1]) throw new Error('第 ' + (index + 1) + ' 行格式不正确：编号|中文站名|英文站名|换乘');
      return { id: Core.uuid(), code: parts[0] || String(index + 1).padStart(2, '0'), zh: parts[1], en: parts[2] || '', transfers: parseTransfers(parts[3] || '', city) };
    });
  }
  global.PlatformState = {
    create: create, settings: settings, patchStation: patchStation, addStation: addStation,
    setVerticalVariant: setVerticalVariant, swapVerticalColumns: swapVerticalColumns,
    verticalGeometry: verticalGeometry,
    removeStation: removeStation, moveStation: moveStation, replaceStations: replaceStations,
    reorderStation: reorderStation, reverseStations: reverseStations,
    neighbors: neighbors, parseTransfers: parseTransfers, parseStations: parseStations,
    setHangingLength: setHangingLength, setHangingHeight: setHangingHeight,
    setElementOffset: setElementOffset, nudgeElement: nudgeElement, resetElement: resetElement,
    serialize: function (state) { return JSON.stringify(state, null, 2); },
    deserialize: function (text) { return sanitize(JSON.parse(text)); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
