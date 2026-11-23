import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const filename = fileURLToPath(new URL('../js/notifications.js', import.meta.url));
const source = readFileSync(filename, 'utf8');

function setup(supportsPopover = true) {
  const timers = new Map();
  const finished = [];
  const popover = [];
  let modal = false;

  function createElement() {
    const attributes = new Map();
    const classes = new Set();
    const element = {
      children: [],
      dataset: {},
      textContent: '',
      open: false,
      get childElementCount() { return this.children.length; },
      getAttribute(name) { return attributes.get(name); },
      setAttribute(name, value) { attributes.set(name, value); },
      hasAttribute(name) { return attributes.has(name); },
      classList: { add(name) { classes.add(name); }, contains(name) { return classes.has(name); } },
      append(...children) {
        this.children.push(...children);
        for (const child of children) child.parent = this;
      },
      matches(selector) { return selector === ':popover-open' && this.open; },
      remove() { this.parent.children = this.parent.children.filter(child => child !== this); },
    };
    if (supportsPopover) {
      element.showPopover = () => { element.open = true; popover.push('show'); };
      element.hidePopover = () => { element.open = false; popover.push('hide'); };
    }
    return element;
  }
  const document = {
    body: createElement(), createElement,
    querySelector: selector => selector === 'dialog:modal' && modal,
  };
  const window = {
    EditorMotion: { afterMotion(element, callback) { finished.push(callback); } },
    setTimeout(callback, delay) { timers.set(callback, delay); return callback; },
    clearTimeout(timer) { timers.delete(timer); },
  };
  runInNewContext(source, { document, window }, { filename });
  return {
    show: window.EditorNotifications.show, document, timers, finished, popover,
    openModal() { modal = true; },
  };
}

test('短通知按类型显示名称，错误单独播报，未知类型使用普通提示', () => {
  const { show, document, timers } = setup();
  show('<示例>', 'unknown');
  show('已导出', 'success');
  show('请修改尺寸', 'warning');
  show('无法保存', 'error');
  const [container, status, alert] = document.body.children;
  assert.equal(container.id, 'toasts');
  assert.equal(container.getAttribute('aria-hidden'), 'true');
  assert.deepEqual(container.children.map(item => item.dataset.kind), ['information', 'success', 'warning', 'error']);
  assert.deepEqual(container.children.map(item => item.children[1].textContent), ['提示', '成功', '注意', '失败']);
  assert.equal(container.children[0].children[2].textContent, '<示例>');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.textContent, '注意。请修改尺寸');
  assert.equal(alert.getAttribute('role'), 'alert');
  assert.equal(alert.textContent, '失败。无法保存');
  assert.ok(Math.max(...timers.values()) > Math.min(...timers.values()));
});

test('只保留三条活动通知，手动关闭和计时结束会等动效完成再移除', () => {
  const { show, document, timers, finished, popover } = setup();
  const first = show('一');
  const second = show('二');
  show('三');
  show('四');
  const container = document.body.children[0];
  assert.equal(timers.size, 3);
  assert.equal(container.children[0].classList.contains('leaving'), true);
  first();
  assert.equal(finished.length, 1);
  finished.shift()();
  assert.equal(container.children.length, 3);
  second();
  for (const timer of timers.keys()) timer();
  assert.equal(timers.size, 0);
  assert.equal(container.children.length, 3);
  for (const finish of finished) finish();
  assert.equal(container.childElementCount, 0);
  assert.equal(popover.at(-1), 'hide');
});

test('打开原生对话框后，新通知移到浏览器顶层；旧浏览器仍能计时和关闭', () => {
  const withPopover = setup();
  withPopover.show('普通提示');
  withPopover.openModal();
  withPopover.show('对话框内的操作已完成', 'success');
  assert.deepEqual(withPopover.popover, ['show', 'hide', 'show']);
  const withoutPopover = setup(false);
  withoutPopover.show('普通提示');
  withoutPopover.timers.keys().next().value();
  withoutPopover.finished.shift()();
  assert.equal(withoutPopover.document.body.children[0].childElementCount, 0);
  assert.equal(withoutPopover.popover.length, 0);
});
