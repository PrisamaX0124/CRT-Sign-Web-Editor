/* Modified by PrisamaX0124, 2026-10-06: text lines, railway icon, station glyphs and public release data separation; see docs/fork-changes.md. */
/**
 * presets.js — 预设系统（issue 05）
 *
 * 预设 = 一整行元素的完整快照（Element[] + 全部 props），存于 localStorage key
 * `sign-presets`，结构：[{ id, name, createdAt, elements }]。
 * 拖入预设 → 替换目标空行的全部元素（元素 id 重新生成，避免与牌内冲突）。
 */
(function (global) {
  'use strict';

  var Core = global.SignCore;
  var State = global.SignState;
  var KEY = 'public-sign-presets';
  var listeners = [];

  function list() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.filter(function (p) {
        return p && typeof p.name === 'string' && Array.isArray(p.elements);
      });
    } catch (e) {
      return [];
    }
  }

  function persist(items) {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch (e) {
      console.error('预设保存失败', e);
      return; // 写盘失败时不触发变更通知，UI 与存储保持一致
    }
    listeners.forEach(function (fn) { fn(); });
  }

  function get(id) {
    var found = list().filter(function (p) { return p.id === id; });
    return found[0] || null;
  }

  /** 将一行的元素保存为预设（深拷贝快照） */
  function save(name, elements) {
    var items = list();
    items.push({
      id: Core.uuid(),
      name: name,
      createdAt: Date.now(),
      elements: Core.deepClone(elements),
    });
    persist(items);
  }

  function remove(id) {
    persist(list().filter(function (p) { return p.id !== id; }));
  }

  function rename(id, newName) {
    persist(list().map(function (p) {
      return p.id === id ? Object.assign({}, p, { name: newName }) : p;
    }));
  }

  /** 取预设元素并重新生成 id（每次落牌都是独立副本） */
  function materialize(id) {
    var p = get(id);
    if (!p) return null;
    return p.elements
      .filter(function (el) { return State.ELEMENT_TYPES.indexOf(el.type) !== -1; })
      .map(function (el) {
        return {
          id: Core.uuid(),
          type: el.type,
          props: Core.deepClone(el.props || {}),
        };
      });
  }

  function onChange(fn) { listeners.push(fn); }

  global.SignPresets = {
    KEY: KEY,
    list: list,
    get: get,
    save: save,
    remove: remove,
    rename: rename,
    materialize: materialize,
    onChange: onChange,
  };
})(typeof window !== 'undefined' ? window : globalThis);
