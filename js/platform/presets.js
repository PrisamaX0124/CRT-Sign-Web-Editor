/** Validated project snapshots; storage and dialogs live in main.js. */
(function (global) {
  'use strict';
  var State = global.PlatformState;
  function create(state, name, id) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('请填写预设名称');
    return { id: id || global.SignCore.uuid(), name: name.trim().slice(0, 80), state: State.deserialize(State.serialize(state)) };
  }
  function deserialize(text) {
    var data = JSON.parse(text);
    if (!Array.isArray(data) || data.length > 30) throw new Error('预设数量须为 0–30');
    var ids = new Set();
    return data.map(function (item) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('预设 id 不合法');
      ids.add(item.id);
      return create(State.deserialize(JSON.stringify(item.state)), item.name, item.id);
    });
  }
  global.PlatformPresets = { create: create, deserialize: deserialize, serialize: function (list) { return JSON.stringify(list); } };
})(typeof window !== 'undefined' ? window : globalThis);
