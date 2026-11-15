/** Palette DOM behavior; fonts/layout are verified in e2e.html. */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function paletteHarness(mobile = false, presets = []) {
  class Node {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.attrs = {};
      this.events = {};
      this.scrollLeft = 0;
      this.classList = {
        contains: name => (this.attrs.class || '').split(' ').includes(name),
        add: name => this.classList.toggle(name, true),
        remove: name => this.classList.toggle(name, false),
        toggle: (name, enabled) => {
          const names = new Set((this.attrs.class || '').split(' ').filter(Boolean));
          const add = enabled === undefined ? !names.has(name) : enabled;
          if (add) names.add(name); else names.delete(name);
          this.attrs.class = [...names].join(' ');
        },
      };
    }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
    replaceChild(next, old) {
      this.children[this.children.indexOf(old)] = next;
      next.parentNode = this;
    }
    addEventListener(name, fn) { this.events[name] = fn; }
    click() { this.events.click?.({ stopPropagation() {} }); }
    set innerHTML(value) { this.children = []; }
    querySelectorAll(selector) {
      const match = selector.match(/^\.([\w-]+)(?:\[([\w-]+)="([^"]+)"\])?$/);
      assert.ok(match, 'stub selector: ' + selector);
      const result = [];
      const visit = node => node.children.forEach(child => {
        if (child.classList.contains(match[1]) && (!match[2] || child.getAttribute(match[2]) === match[3])) result.push(child);
        visit(child);
      });
      visit(this);
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const root = new Node('div');
  const context = {
    document: { getElementById: () => root, createElementNS: (_, tag) => new Node(tag) },
    SignUI: {
      h: (tag, attrs = {}, children = []) => {
        const node = new Node(tag);
        Object.entries(attrs).forEach(([key, value]) => key === 'text' ? node.textContent = value : node.setAttribute(key, value));
        children.forEach(child => node.appendChild(child));
        return node;
      },
    },
    SignRender: { renderElementStandalone: () => ({ node: new Node('svg') }) },
    SignPresets: { list: () => presets, onChange: fn => { context.presetChanged = fn; } },
    App: {
      measure: () => 0, isMobileView: () => mobile,
      previewPreset: id => { context.previews.push(id); },
    },
    previews: [],
  };
  ['core', 'state', 'icons', 'directions', 'panel'].forEach(name => runInNewContext(
    readFileSync(new URL('../js/' + name + '.js', import.meta.url), 'utf8'), context));
  context.SignPanel.buildPalette();
  return { root, context };
}

test('选择区把预设分入独立选项卡，方向保留全部12种且分类收敛', () => {
  const { root } = paletteHarness();
  assert.equal(root.querySelectorAll('.palette-tab').length, 2);
  assert.equal(root.querySelectorAll('.palette-category').length, 3);
  assert.equal(root.querySelectorAll('.direction-card').length, 12);
  assert.ok(root.querySelectorAll('.palette-card').every(card => card.tagName === 'button' && card.getAttribute('aria-label')));
  assert.equal(root.querySelectorAll('.palette-empty').length, 0);
  root.querySelector('.palette-tab[data-value="presets"]').click();
  assert.equal(root.querySelectorAll('.palette-card').length, 0);
  assert.equal(root.querySelectorAll('.palette-empty').length, 1);
});

test('移动分类切换保留chip节点与滚动位置，存预设重建保留位置', () => {
  const { root, context } = paletteHarness(true);
  const chips = root.querySelector('.palette-chips');
  assert.equal(root.querySelectorAll('.palette-chip').length, 6);
  chips.scrollLeft = 120;
  const last = root.querySelectorAll('.palette-chip')[5];
  last.click();
  assert.equal(root.querySelector('.palette-chips'), chips);
  assert.equal(root.querySelectorAll('.palette-chip')[5], last);
  assert.equal(chips.scrollLeft, 120);
  context.presetChanged();
  assert.equal(root.querySelector('.palette-chips').scrollLeft, 120);
  root.querySelector('.palette-tab[data-value="presets"]').click();
  assert.equal(root.querySelectorAll('.palette-chip').length, 0);
  root.querySelector('.palette-tab[data-value="elements"]').click();
  assert.equal(root.querySelector('.palette-chips').scrollLeft, 120);
});

test('预设卡片可用Enter/Space打开预览，内部删除按钮的按键不会重复打开', () => {
  const { root, context } = paletteHarness(false, [{ id: 'preset-1', name: '常用方向', elements: [] }]);
  root.querySelector('.palette-tab[data-value="presets"]').click();
  const card = root.querySelector('.preset-card');
  assert.equal(card.getAttribute('role'), 'button');
  assert.equal(card.getAttribute('tabindex'), '0');
  assert.equal(card.getAttribute('aria-label'), '预览预设：常用方向');
  for (const key of ['Enter', ' ']) {
    let prevented = false;
    card.events.keydown({ target: card, key, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  assert.equal(context.previews.length, 2);
  card.events.keydown({ target: card.querySelector('.preset-delete'), key: 'Enter', preventDefault() {} });
  assert.equal(context.previews.length, 2);
});
