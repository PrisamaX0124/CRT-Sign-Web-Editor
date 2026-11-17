import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

const filename = fileURLToPath(new URL('../js/storage.js', import.meta.url));
const source = readFileSync(filename, 'utf8');
const storageKey = 'project';

function createEditor({ delay = 500, restored } = {}) {
  const status = { textContent: '本地自动保存' };
  const backup = { hidden: true, addEventListener: (event, listener) => { backup.click = listener; } };
  const indicator = {
    dataset: {},
    querySelector: selector => selector === 'button' ? backup : status,
  };
  const timers = new Map();
  const windowEvents = new EventTarget();
  const document = new EventTarget();
  const writes = [];
  const exports = [];
  let project = '初始内容';
  let timerNumber = 0;
  const browser = {
    document,
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    localStorage: { setItem: (key, value) => writes.push([key, value]) },
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
    browser, document, windowEvents, status, backup, timers, writes, exports,
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
