import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const filename = fileURLToPath(new URL('../js/editor-panels.js', import.meta.url));
const source = readFileSync(filename, 'utf8');

function setup(...identifiers) {
  let focused;
  const panels = new Map();
  const buttons = [];

  function button(identifier) {
    const element = Object.assign(new EventTarget(), {
      hidden: false,
      attributes: new Map([['aria-controls', identifier], ['aria-expanded', 'true']]),
      getAttribute(name) { return this.attributes.get(name); },
      setAttribute(name, value) { this.attributes.set(name, value); },
      focus(options) {
        assert.equal(options.preventScroll, true);
        assert.equal(this.hidden, false);
        assert.equal(panels.get(identifier).inert && this === panels.get(identifier).collapse, false);
        focused = this;
      },
      click() { this.dispatchEvent(new Event('click')); },
    });
    buttons.push(element);
    return element;
  }

  for (const identifier of identifiers) {
    const collapse = button(identifier);
    const expand = button(identifier);
    expand.hidden = true;
    const classes = new Set();
    panels.set(identifier, {
      collapse, expand, classes, inert: false,
      contains(element) { return element === collapse; },
      classList: {
        toggle(name, present) { if (present) classes.add(name); else classes.delete(name); },
      },
    });
  }
  const document = {
    querySelectorAll() { return buttons; },
    getElementById(identifier) { return panels.get(identifier); },
  };
  const window = { document };
  runInNewContext(source, { window, document }, { filename });
  return { panels, focused: () => focused, expand: window.EditorPanels?.expand };
}

test('收起和展开时更新侧栏状态，并把焦点移到对应按钮', () => {
  const { panels, focused } = setup('content');
  const { collapse, expand, classes } = panels.get('content');
  for (let round = 0; round < 2; round++) {
    collapse.click();
    assert.equal(classes.has('collapsed'), true);
    assert.equal(panels.get('content').inert, true);
    assert.equal(expand.hidden, false);
    assert.equal(expand.getAttribute('aria-expanded'), 'false');
    assert.equal(collapse.getAttribute('aria-expanded'), 'false');
    assert.equal(focused(), expand);

    expand.click();
    assert.equal(classes.has('collapsed'), false);
    assert.equal(panels.get('content').inert, false);
    assert.equal(expand.hidden, true);
    assert.equal(expand.getAttribute('aria-expanded'), 'true');
    assert.equal(collapse.getAttribute('aria-expanded'), 'true');
    assert.equal(focused(), collapse);
  }
});

test('左右侧栏可以独立收起和展开', () => {
  const { panels } = setup('content', 'properties');
  const content = panels.get('content');
  const properties = panels.get('properties');
  content.collapse.click();
  assert.equal(properties.inert, false);
  properties.collapse.click();
  content.expand.click();
  assert.equal(content.inert, false);
  assert.equal(properties.inert, true);
  assert.equal(properties.expand.hidden, false);
});

test('需要编辑内容时可展开目标侧栏，把焦点交给调用方安排', () => {
  const { panels, focused, expand } = setup('content', 'properties');
  const content = panels.get('content');
  const properties = panels.get('properties');
  expand('properties');
  assert.equal(properties.inert, false);
  assert.equal(focused(), undefined);
  properties.collapse.click();
  content.collapse.click();
  expand('properties');
  assert.equal(properties.inert, false);
  assert.equal(properties.expand.hidden, true);
  assert.equal(properties.collapse.getAttribute('aria-expanded'), 'true');
  assert.equal(focused(), content.expand);
  assert.equal(content.inert, true);
  expand('unknown');
});
