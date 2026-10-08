/** Station clipboard: native shortcuts, permission-free page fallback and 20 recent copies. */
(function (global) {
  'use strict';
  var S = global.PlatformState, App, notice, localText = '', localOnly = false;
  var pendingWrite = Promise.resolve(), copyVersion = 0, cutGap = null, entries = [], serial = 0;
  function editing(target) {
    return !!(target && target.closest && target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'));
  }
  function blocked(target) { return editing(target) || !!document.querySelector('dialog[open]'); }
  function selectionText() {
    var ids = App.selectedStationIds(); return ids.length ? S.serializeStations(App.state, ids) : '';
  }
  function remember(text, isCut) {
    var data = S.deserializeStations(text);
    var names = data.stations.slice(0, 2).map(function (item) { return item.station.zh || item.station.code; }).join('、');
    entries.unshift({ id: String(++serial), text: text, label: (isCut ? '剪切' : '复制') + ' ' + data.stations.length + ' 站 · ' + names });
    if (entries.length > 20) entries.pop();
    var control = document.getElementById('platform-clipboard-history'); control.replaceChildren();
    var placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '粘贴历史（' + entries.length + '/20）'; control.appendChild(placeholder);
    entries.forEach(function (entry, index) { var option = document.createElement('option'); option.value = entry.id; option.textContent = (index + 1) + '. ' + entry.label; control.appendChild(option); });
    sync();
  }
  function canCut(ids) {
    if (ids.length < App.state.stations.length) return true;
    notice('剪切时请至少保留一个站点'); return false;
  }
  function cut(ids) {
    cutGap = App.state.stations.findIndex(function (s) { return ids.indexOf(s.id) >= 0; });
    App.update(function (state) { return S.removeStations(state, ids); }, null, { clearSelection: true });
  }
  function pasteText(text) {
    var data = S.deserializeStations(text), ids = App.selectedStationIds(), gap;
    if (ids.length) {
      var id = ids.indexOf(App.selectedId) >= 0 ? App.selectedId : ids[ids.length - 1];
      gap = App.state.stations.findIndex(function (s) { return s.id === id; }) + 1;
    } else if (cutGap !== null) gap = cutGap;
    App.update(function (state) { return S.pasteStations(state, data, gap); }, null, { selectNew: true });
    cutGap = null; notice('已粘贴 ' + data.stations.length + ' 个站点'); return true;
  }
  function onCopy(event) {
    if (event.defaultPrevented || blocked(event.target) || !event.clipboardData) return;
    var text = selectionText(), ids = App.selectedStationIds(); if (!text || (event.type === 'cut' && !canCut(ids))) return;
    event.clipboardData.setData('text/plain', text); event.preventDefault();
    localText = text; localOnly = false; copyVersion++; remember(text, event.type === 'cut');
    if (event.type === 'cut') cut(ids); else cutGap = null;
    notice((event.type === 'cut' ? '已剪切 ' : '已复制 ') + ids.length + ' 个站点');
  }
  function onPaste(event) {
    if (event.defaultPrevented || blocked(event.target) || !event.clipboardData) return;
    var text = event.clipboardData.getData('text/plain'), value;
    if (text.length > 2 * 1024 * 1024) return;
    try { value = JSON.parse(text); } catch (err) { return; }
    if (!value || value.kind !== 'platform-sign-stations') return;
    event.preventDefault(); try { pasteText(text); } catch (err) { notice(err.message); }
  }
  function copyButton(isCut) {
    if (document.querySelector('dialog[open]')) return Promise.resolve(false);
    var text = selectionText(), ids = App.selectedStationIds(); if (!text || (isCut && !canCut(ids))) return Promise.resolve(false);
    localText = text; var version = ++copyVersion, writing;
    try { writing = navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('clipboard unavailable')); }
    catch (err) { writing = Promise.reject(err); }
    pendingWrite = Promise.resolve(writing).then(function () { return true; }, function () { return false; }).then(function (system) { if (version === copyVersion) localOnly = !system; return system; });
    remember(text, isCut); if (isCut) cut(ids); else cutGap = null;
    return pendingWrite.then(function (system) { notice((isCut ? '已剪切 ' : '已复制 ') + ids.length + ' 个站点' + (system ? '' : '（可在当前页面粘贴）')); return true; });
  }
  async function pasteButton() {
    if (document.querySelector('dialog[open]')) return false;
    await pendingWrite; var text = localText;
    try { if (navigator.clipboard && !localOnly) text = await navigator.clipboard.readText(); }
    catch (err) { /* Keep the local copy when clipboard permission is unavailable. */ }
    try { return pasteText(text); } catch (err) { notice(err.message); return false; }
  }
  function sync() {
    if (!App) return;
    var count = App.selectedStationIds().length, keys = App.selectedKeys().length;
    var bar = document.getElementById('platform-edit-actions');
    ['copy', 'cut', 'delete'].forEach(function (action) { bar.querySelector('[data-edit-action="' + action + '"]').disabled = !count || (action !== 'copy' && App.state.stations.length <= 1); });
    document.getElementById('platform-clipboard-history').disabled = !entries.length;
    document.getElementById('platform-selection-status').textContent = keys ? '已选 ' + keys + ' 个元素 · ' + count + ' 个站点' : 'Ctrl 单击加选 · Shift 单击范围选择';
  }
  function init(app, notify) {
    App = app; notice = notify;
    document.addEventListener('copy', onCopy); document.addEventListener('cut', onCopy); document.addEventListener('paste', onPaste);
    document.getElementById('platform-edit-actions').addEventListener('click', function (event) {
      var button = event.target.closest('[data-edit-action]'); if (!button || button.disabled) return;
      var action = button.dataset.editAction;
      if (action === 'select-all') App.selectAll(); else if (action === 'delete') App.deleteSelection(); else if (action === 'paste') pasteButton(); else copyButton(action === 'cut');
    });
    document.getElementById('platform-clipboard-history').addEventListener('change', function (event) {
      var entry = entries.find(function (item) { return item.id === event.target.value; }); event.target.value = '';
      if (entry && !document.querySelector('dialog[open]')) { try { pasteText(entry.text); } catch (err) { notice(err.message); } }
    });
    sync();
  }
  global.PlatformClipboard = { init: init, sync: sync, copy: copyButton, paste: pasteButton, pasteText: pasteText, editing: editing };
})(typeof window !== 'undefined' ? window : globalThis);
