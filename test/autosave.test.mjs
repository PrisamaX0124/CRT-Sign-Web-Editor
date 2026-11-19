import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

const filename = fileURLToPath(new URL('../js/storage.js', import.meta.url));
const source = readFileSync(filename, 'utf8');
const storageKey = 'project';

function createEditor({ delay = 500, restored, initialReadFails = false } = {}) {
  const status = { textContent: '本地自动保存' };
  const backup = { hidden: true, addEventListener: (event, listener) => { backup.click = listener; } };
  const indicator = {
    dataset: {},
    querySelector: selector => selector === 'button' ? backup : status,
    append: control => { indicator.reload = control; },
  };
  const timers = new Map();
  const windowEvents = new EventTarget();
  const document = new EventTarget();
  document.createElement = () => ({ addEventListener: (event, listener) => { indicator.reloadClick = listener; } });
  const writes = [];
  const stored = new Map();
  const exports = [];
  let project = '初始内容';
  let timerNumber = 0;
  const browser = {
    document,
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    localStorage: {
      getItem: key => {
        if (initialReadFails) { initialReadFails = false; throw new Error('存储暂时不可用'); }
        return stored.get(key) ?? null;
      },
      setItem: (key, value) => { stored.set(key, value); writes.push([key, value]); },
    },
    setTimeout: (callback, milliseconds) => {
      assert.equal(milliseconds, delay);
      timers.set(++timerNumber, callback);
      return timerNumber;
    },
    clearTimeout: timer => timers.delete(timer),
  };
  runInNewContext(source, browser, { filename });
  const autosave = browser.SignStorage.createAutosave({
    storageKey, indicator, delay: delay || undefined, restored,
    serializeProject: () => JSON.stringify(project),
    exportProject: () => exports.push(project),
  });
  return {
    browser, document, windowEvents, status, backup, timers, writes, exports, stored, indicator,
    edit(value) {
      project = value;
      autosave.schedule(delay ? undefined : JSON.stringify(value));
    },
    finishDelay() {
      for (const [timer, callback] of timers) {
        timers.delete(timer);
        callback();
      }
    },
  };
}

test('没有存档时提示本地自动保存，恢复存档后显示已保存', () => {
  assert.equal(createEditor().status.textContent, '本地自动保存');
  const editor = createEditor({ restored: true });
  assert.equal(editor.status.textContent, '已保存');
  assert.equal(editor.backup.hidden, true);
  assert.deepEqual(editor.writes, []);
});

test('同类型项目被其他页面修改后，取消待保存内容并保留备份入口', () => {
  const editor = createEditor();
  editor.edit('本页未保存的内容');
  editor.stored.set(storageKey, '其他页面的内容');
  editor.windowEvents.dispatchEvent(Object.assign(new Event('storage'), { key: storageKey }));
  editor.finishDelay();
  assert.equal(editor.indicator.dataset.saveState, 'conflict');
  assert.match(editor.status.textContent, /其他窗口/);
  assert.equal(editor.backup.hidden, false);
  editor.backup.click();
  assert.deepEqual(editor.exports, ['本页未保存的内容']);
  let reloads = 0;
  editor.browser.location = { reload: () => { reloads += 1; } };
  editor.indicator.reloadClick();
  assert.equal(reloads, 1);
  assert.equal(editor.indicator.reload.textContent, '重新加载');
  editor.edit('冲突后继续编辑');
  editor.windowEvents.dispatchEvent(new Event('pagehide'));
  assert.deepEqual(editor.writes, []);
  assert.equal(editor.stored.get(storageKey), '其他页面的内容');
});

test('其他页面删除存档或清空存储后，本页不会重新写回旧项目', () => {
  for (const key of [storageKey, null]) {
    const editor = createEditor();
    editor.edit('本页已保存');
    editor.finishDelay();
    editor.stored.clear();
    editor.windowEvents.dispatchEvent(Object.assign(new Event('storage'), { key }));
    editor.edit('继续编辑');
    editor.finishDelay();
    assert.equal(editor.indicator.dataset.saveState, 'conflict');
    assert.equal(editor.writes.length, 1);
    assert.equal(editor.stored.size, 0);
  }
});

test('旧存储事件晚到时，以当前存档为准，不误报冲突', () => {
  const editor = createEditor();
  editor.edit('已保存');
  editor.finishDelay();
  editor.windowEvents.dispatchEvent(Object.assign(new Event('storage'), { key: storageKey, newValue: '较早的内容' }));
  assert.equal(editor.indicator.dataset.saveState, 'saved');
});

test('启动时无法读取存储，恢复后发现其他存档时先保留备份，不覆盖未知内容', () => {
  const editor = createEditor({ initialReadFails: true });
  editor.stored.set(storageKey, '其他窗口保存的项目');
  editor.edit('本页修改');
  editor.finishDelay();
  assert.equal(editor.indicator.dataset.saveState, 'conflict');
  assert.equal(editor.backup.hidden, false);
  assert.deepEqual(editor.writes, []);
});

test('保存前检查最新存档，即使未收到存储事件也不会覆盖其他页面', () => {
  for (const delay of [0, 500]) {
    const editor = createEditor({ delay });
    editor.stored.set(storageKey, '其他页面抢先保存');
    editor.edit('本页修改');
    editor.finishDelay();
    assert.equal(editor.indicator.dataset.saveState, 'conflict');
    assert.deepEqual(editor.writes, []);
  }
});

test('其他类型的项目和本页已保存的数据不会误报，未修改页面离开时不写入', () => {
  const editor = createEditor();
  editor.windowEvents.dispatchEvent(new Event('pagehide'));
  assert.deepEqual(editor.writes, []);
  editor.windowEvents.dispatchEvent(Object.assign(new Event('storage'), { key: 'another-project' }));
  editor.edit('正常保存');
  editor.finishDelay();
  editor.windowEvents.dispatchEvent(Object.assign(new Event('storage'), { key: storageKey }));
  assert.equal(editor.indicator.dataset.saveState, 'saved');
  editor.windowEvents.dispatchEvent(new Event('beforeunload'));
  assert.equal(editor.writes.length, 1);
});

test('连续修改只留下一个等待中的保存，写入最后一次修改', () => {
  const editor = createEditor();
  editor.edit('第一次修改');
  editor.edit('最后一次修改');
  assert.equal(editor.timers.size, 1);
  assert.equal(editor.status.textContent, '保存中');
  assert.deepEqual(editor.writes, []);
  editor.finishDelay();
  assert.equal(editor.status.textContent, '已保存');
  assert.deepEqual(editor.writes, [[storageKey, '"最后一次修改"']]);
});

test('离开页面立即保存并取消等待中的写入，随后的编辑仍保存最新内容', () => {
  const editor = createEditor();
  editor.edit('离开前的内容');
  editor.windowEvents.dispatchEvent(new Event('pagehide'));
  assert.equal(editor.timers.size, 0);
  assert.equal(editor.status.textContent, '已保存');
  editor.edit('回来后的内容');
  editor.finishDelay();
  assert.deepEqual(editor.writes, [
    [storageKey, '"离开前的内容"'], [storageKey, '"回来后的内容"'],
  ]);
});

test('页面切到后台或即将关闭时立即保存当前内容', () => {
  const editor = createEditor();
  editor.edit('切到后台前');
  editor.document.hidden = false;
  editor.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(editor.writes, []);
  editor.document.hidden = true;
  editor.document.dispatchEvent(new Event('visibilitychange'));
  editor.edit('关闭前');
  editor.windowEvents.dispatchEvent(new Event('beforeunload'));
  assert.equal(editor.timers.size, 0);
  assert.deepEqual(editor.writes, [
    [storageKey, '"切到后台前"'], [storageKey, '"关闭前"'],
  ]);
});

test('空间不足时保留失败状态，备份包含正在等待保存的最新修改', () => {
  const editor = createEditor();
  const write = editor.browser.localStorage.setItem;
  editor.browser.localStorage.setItem = () => { throw new DOMException('空间不足', 'QuotaExceededError'); };
  editor.edit('写入失败的内容');
  editor.finishDelay();
  assert.equal(editor.status.textContent, '保存失败');
  assert.equal(editor.backup.hidden, false);
  editor.edit('备份前又修改的内容');
  assert.equal(editor.backup.hidden, false);
  editor.backup.click();
  assert.deepEqual(editor.exports, ['备份前又修改的内容']);
  editor.browser.localStorage.setItem = write;
  editor.finishDelay();
  assert.equal(editor.status.textContent, '已保存');
  assert.equal(editor.backup.hidden, true);
  assert.deepEqual(editor.writes, [[storageKey, '"备份前又修改的内容"']]);
});

test('浏览器禁止访问存储时，立即保存的编辑器仍能编辑和备份', () => {
  const editor = createEditor({ delay: 0 });
  Object.defineProperty(editor.browser, 'localStorage', {
    get() { throw new DOMException('存储已禁用', 'SecurityError'); },
  });
  editor.edit('存储禁用后的修改');
  assert.equal(editor.status.textContent, '保存失败');
  assert.equal(editor.backup.hidden, false);
  assert.equal(editor.timers.size, 0);
  editor.backup.click();
  assert.deepEqual(editor.exports, ['存储禁用后的修改']);
});

test('立即保存连续写入每次修改，离开页面也不会再写', () => {
  const editor = createEditor({ delay: 0 });
  editor.edit('第一次修改');
  editor.edit('最后一次修改');
  editor.windowEvents.dispatchEvent(new Event('pagehide'));
  editor.windowEvents.dispatchEvent(new Event('beforeunload'));
  assert.equal(editor.status.textContent, '已保存');
  assert.equal(editor.timers.size, 0);
  assert.deepEqual(editor.writes, [
    [storageKey, '"第一次修改"'], [storageKey, '"最后一次修改"'],
  ]);
});

test('离开时写入失败会显示备份入口，存储恢复后能立即保存', () => {
  const editor = createEditor();
  const write = editor.browser.localStorage.setItem;
  editor.browser.localStorage.setItem = () => { throw new Error('写入失败'); };
  editor.edit('离开页面前修改的内容');
  editor.windowEvents.dispatchEvent(new Event('pagehide'));
  assert.equal(editor.status.textContent, '保存失败');
  assert.equal(editor.backup.hidden, false);
  assert.equal(editor.timers.size, 0);
  editor.browser.localStorage.setItem = write;
  editor.windowEvents.dispatchEvent(new Event('beforeunload'));
  assert.equal(editor.status.textContent, '已保存');
  assert.equal(editor.backup.hidden, true);
  assert.deepEqual(editor.writes, [[storageKey, '"离开页面前修改的内容"']]);
});
