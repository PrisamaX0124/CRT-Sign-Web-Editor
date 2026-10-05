/** 元素剪贴板：原生 copy/cut/paste 事件与按钮共用，受限环境保留页面内副本。 */
(function (global) {
  'use strict';
  var App = global.App, State = global.SignState, UI = global.SignUI;
  var localText = '', pendingWrite = Promise.resolve(), cutTarget = null, localOnly = false, copyVersion = 0;

  function editing(target) {
    return !!(target && target.closest && target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'));
  }

  function blocked(target) { return editing(target) || !!document.querySelector('.modal-mask'); }

  function selectionText() {
    var ids = App.selectedIds();
    return ids.length ? State.serializeElements(App.state, ids) : '';
  }

  function cut(ids) {
    cutTarget = null;
    App.state.rows.some(function (row) {
      var index = row.elements.findIndex(function (el) { return ids.indexOf(el.id) >= 0; });
      if (index < 0) return false;
      cutTarget = { rowId: row.id, gap: index };
      return true;
    });
    App.update(function (st) { return State.deleteElements(st, ids); });
  }

  function pasteText(text) {
    if (!text || text.length > 8 * 1024 * 1024) throw new Error('剪贴板中没有有效的标识牌元素');
    var data = State.deserializeElements(text);
    var found = State.findElement(App.state, App.selection.elementId);
    var target = found ? { rowId: found.rowId, gap: found.index + 1 }
      : cutTarget && App.state.rows.some(function (row) { return row.id === cutTarget.rowId; }) ? cutTarget
        : { rowId: App.state.rows[App.state.rows.length - 1].id };
    App.update(function (st) { return State.pasteElements(st, data, target.rowId, target.gap); }, null, { selectNew: true });
    cutTarget = null;
    UI.toast('已粘贴 ' + App.selectedIds().length + ' 个元素', 'success');
    return true;
  }

  function onCopy(ev) {
    if (ev.defaultPrevented || blocked(ev.target) || !ev.clipboardData) return;
    var text = selectionText();
    if (!text) return;
    ev.clipboardData.setData('text/plain', text);
    ev.preventDefault();
    localText = text;
    localOnly = false;
    copyVersion++;
    var ids = App.selectedIds();
    if (ev.type === 'cut') cut(ids); else cutTarget = null;
    UI.toast((ev.type === 'cut' ? '已剪切 ' : '已复制 ') + ids.length + ' 个元素');
  }

  function onPaste(ev) {
    if (ev.defaultPrevented || blocked(ev.target) || !ev.clipboardData) return;
    var text = ev.clipboardData.getData('text/plain');
    // 文本、图片和其他应用的剪贴板由浏览器自行处理，不套用旧的页面副本。
    var data;
    try { data = JSON.parse(text); } catch (e) { return; }
    if (!data || data.kind !== 'jr-sign-elements') return;
    ev.preventDefault();
    try { pasteText(text); } catch (e) { UI.toast(e.message, 'error'); }
  }

  function copyButton(isCut) {
    if (document.querySelector('.modal-mask')) return Promise.resolve(false);
    var text = selectionText(), ids = App.selectedIds();
    if (!text) return Promise.resolve(false);
    localText = text;
    var version = ++copyVersion;
    var writing;
    try { writing = navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('clipboard unavailable')); }
    catch (e) { writing = Promise.reject(e); }
    pendingWrite = Promise.resolve(writing).then(function () { return true; }, function () { return false; }).then(function (system) {
      if (version === copyVersion) localOnly = !system;
      return system;
    });
    if (isCut) cut(ids); else cutTarget = null;
    return pendingWrite.then(function (system) {
      UI.toast((isCut ? '已剪切 ' : '已复制 ') + ids.length + ' 个元素' + (system ? '' : '（可在当前页面粘贴）'));
      return true;
    });
  }

  async function pasteButton() {
    if (document.querySelector('.modal-mask')) return false;
    var text = localText;
    await pendingWrite;
    try { if (navigator.clipboard && !localOnly) text = await navigator.clipboard.readText(); }
    catch (e) { /* 无系统剪贴板权限时使用页面内副本。 */ }
    try { return pasteText(text); } catch (e) { UI.toast(e.message, 'error'); return false; }
  }

  function sync() {
    var bar = document.getElementById('edit-actions');
    if (!bar) return;
    var count = App.selectedIds().length;
    bar.querySelector('[data-edit-action="select-all"]').disabled = !App.state.rows.some(function (row) { return row.elements.length; });
    ['copy', 'cut'].forEach(function (action) { bar.querySelector('[data-edit-action="' + action + '"]').disabled = !count; });
    document.getElementById('selection-status').textContent = count ? '已选择 ' + count + ' 个元素' : 'Ctrl 单击加选 · Shift 单击范围选择';
  }

  function init() {
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('paste', onPaste);
    document.getElementById('edit-actions').addEventListener('click', function (ev) {
      var button = ev.target.closest('button[data-edit-action]');
      if (!button || button.disabled) return;
      var action = button.getAttribute('data-edit-action');
      if (action === 'select-all') App.selectAll();
      else if (action === 'paste') pasteButton();
      else copyButton(action === 'cut');
    });
    sync();
  }

  global.SignClipboard = { init: init, sync: sync, copy: copyButton, paste: pasteButton, pasteText: pasteText, editing: editing };
})(typeof window !== 'undefined' ? window : globalThis);
