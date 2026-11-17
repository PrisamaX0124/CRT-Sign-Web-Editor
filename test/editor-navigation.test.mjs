import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const filename = fileURLToPath(new URL('../js/editor-navigation.js', import.meta.url));
const source = readFileSync(filename, 'utf8');

function createNavigation(current = 1) {
  let focused;
  function element() {
    const listeners = new Map();
    return {
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      focus() { focused = this; },
      addEventListener(type, listener) { listeners.set(type, listener); },
      send(type, details = {}) {
        const event = { button: 0, target: this, preventDefault() { this.defaultPrevented = true; }, ...details };
        listeners.get(type)(event);
        return Boolean(event.defaultPrevented);
      },
    };
  }
  const window = element();
  const document = window.document = element();
  const navigation = element();
  const toggle = element();
  const label = {};
  const choices = { hidden: true };
  const links = ['导向标识', '换乘标识', '站台标识'].map(textContent => ({ ...element(), textContent }));
  document.querySelector = () => navigation;
  navigation.querySelector = selector => selector === '.editor-switch' ? toggle : choices;
  navigation.contains = target => [navigation, toggle, ...links].includes(target);
  toggle.querySelector = () => label;
  choices.querySelectorAll = () => links;
  choices.querySelector = () => links[current];
  runInNewContext(source, { window }, { filename });
  return { window, document, navigation, toggle, label, choices, links, focused: () => focused };
}

test('三个编辑器的标题使用全称，菜单保留简称', () => {
  const names = ['导向标识', '换乘标识', '站台标识'];
  for (const [index, name] of names.entries()) {
    const { toggle, label, links } = createNavigation(index);
    assert.equal(label.textContent, name + '编辑器');
    assert.equal(toggle.attributes['aria-label'], '切换编辑器，当前为' + name + '编辑器');
    assert.deepEqual(links.map(link => link.textContent), names);
  }
});

test('鼠标点击标题可以展开和收起三个入口', () => {
  const { toggle, choices, focused } = createNavigation();
  toggle.send('click');
  assert.equal(choices.hidden, false);
  assert.equal(toggle.attributes['aria-expanded'], 'true');
  assert.equal(focused(), toggle);
  toggle.send('click');
  assert.equal(choices.hidden, true);
});

test('上下键可以循环选择，退出键先收起菜单并把焦点还给标题', () => {
  const { navigation, links, toggle, focused, choices } = createNavigation();
  assert.equal(navigation.send('keydown', { key: 'Escape' }), false);
  navigation.send('keydown', { key: 'ArrowUp', target: toggle });
  assert.equal(focused(), links[2]);
  navigation.send('keydown', { key: 'ArrowDown', target: links[2] });
  assert.equal(focused(), links[0]);
  navigation.send('keydown', { key: 'ArrowDown', target: toggle });
  assert.equal(focused(), links[0]);
  assert.equal(navigation.send('keydown', { key: 'Escape', target: links[0] }), true);
  assert.equal(choices.hidden, true);
  assert.equal(focused(), toggle);
});

test('点当前页只收起菜单，组合键点击仍交给浏览器处理', () => {
  const { toggle, links, choices, focused } = createNavigation(2);
  toggle.send('click');
  for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
    assert.equal(links[2].send('click', { [key]: true }), false);
  }
  assert.equal(links[2].send('click', { button: 1 }), false);
  assert.equal(links[2].send('click'), true);
  assert.equal(choices.hidden, true);
  assert.equal(focused(), toggle);
});

test('点外部、移走焦点或从浏览器历史返回时，导航会收起', () => {
  const { window, document, navigation, toggle, links, choices } = createNavigation();
  toggle.send('click');
  navigation.send('focusout', { relatedTarget: links[0] });
  document.send('click', { target: links[0] });
  assert.equal(choices.hidden, false);
  navigation.send('focusout', { relatedTarget: null });
  assert.equal(choices.hidden, true);
  toggle.send('click');
  document.send('click');
  assert.equal(choices.hidden, true);
  toggle.send('click');
  window.send('pageshow');
  assert.equal(choices.hidden, true);
});
