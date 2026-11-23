import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function harness() {
  const context = { window: null, document: {}, Date };
  context.window = context;
  for (const name of ['core', 'state', 'ui']) {
    const filename = fileURLToPath(new URL('../js/' + name + '.js', import.meta.url));
    runInNewContext(readFileSync(filename, 'utf8'), context, { filename });
  }
  context.App.state = context.SignState.createSign();
  const renderAll = context.App.renderAll;
  context.App.renderAll = () => {};
  const saved = [];
  context.App.autosave = { schedule: () => saved.push(context.App.state) };
  return { ...context, saved, renderAll };
}

test('导向预览栏根据撤销和重做记录启用按钮', () => {
  const { App, SignState, window, document, renderAll } = harness();
  const undo = {};
  const redo = {};
  const controls = { 'guidance-undo': undo, 'guidance-redo': redo };
  document.getElementById = identifier => controls[identifier];
  window.SignRender = { renderSignInto: () => ({ width: 768, height: 192 }) };
  App.measure = () => {};
  App.renderAll = renderAll;
  App.renderAll();
  assert.equal(undo.disabled, true);
  assert.equal(redo.disabled, true);

  App.update(state => SignState.updateSignSettings(state, { rowHeight: 180 }));
  assert.equal(undo.disabled, false);
  assert.equal(redo.disabled, true);
  App.undo();
  assert.equal(undo.disabled, true);
  assert.equal(redo.disabled, false);
  App.redo();
  assert.equal(undo.disabled, false);
  assert.equal(redo.disabled, true);

  App.undo();
  App.update(state => SignState.updateSignSettings(state, { rowHeight: 200 }));
  assert.equal(undo.disabled, false);
  assert.equal(redo.disabled, true);
});

test('撤销/重做恢复整牌与自动边距，并重新安排保存', () => {
  const { App: A, SignState: S, saved } = harness();
  const a = S.createElement('bilingual-text'), b = S.createElement('icon');
  A.update(s => S.addElement(s, s.rows[0].id, a));
  const before = A.state;
  A.select(a.id);
  A.update(s => S.addElement(s, s.rows[0].id, b));
  const after = A.state;
  assert.equal(S.findElement(after, a.id).element.props.padding.right, 0.1);
  assert.equal(A.undo(), true);
  assert.equal(A.state, before);
  assert.equal(S.findElement(A.state, a.id).element.props.padding.right, 0.2);
  assert.equal(A.redo(), true);
  assert.equal(A.state, after);
  assert.equal(saved.at(-1), after);
});

test('撤销删除恢复选中元素；重做删除清除过期选择', () => {
  const { App: A, SignState: S } = harness();
  const el = S.createElement('exit');
  A.update(s => S.addElement(s, s.rows[0].id, el));
  A.select(el.id);
  A.update(s => S.deleteElement(s, el.id));
  assert.equal(A.selection.elementId, null);
  A.undo();
  assert.equal(A.selection.elementId, el.id);
  A.redo();
  assert.equal(A.selection.elementId, null);
});

test('无效操作不占历史或清除重做，新编辑清除重做', () => {
  const { App: A, SignState: S } = harness();
  A.update(s => S.updateSignSettings(s, { rowHeight: 160 }));
  A.undo();
  A.update(s => S.updateSignSettings(s, { rowHeight: s.rowHeight }));
  assert.equal(A.redo(), true);
  A.undo();
  A.update(s => S.updateSignSettings(s, { rowHeight: 180 }));
  assert.equal(A.redo(), false);
});

test('仅保留最近20步，历史为空时安全返回', () => {
  const { App: A, SignState: S } = harness();
  assert.equal(A.undo(), false);
  assert.equal(A.redo(), false);
  for (let i = 1; i <= 25; i++) A.update(s => S.updateSignSettings(s, { rowHeight: 192 + i }));
  let count = 0;
  while (A.undo()) count++;
  assert.equal(count, 20);
  assert.equal(A.state.rowHeight, 197);
  count = 0;
  while (A.redo()) count++;
  assert.equal(count, 20);
  assert.equal(A.state.rowHeight, 217);
});

test('同一文本的一次连续输入合并撤销，不同字段分别记录', () => {
  const { App: A, SignState: S } = harness();
  const el = S.createElement('bilingual-text');
  A.update(s => S.addElement(s, s.rows[0].id, el));
  const edit = (patch, key) => A.update(s => S.updateElementProps(s, el.id, patch), key);
  edit({ textZh: '开' }, el.id + ':textZh');
  edit({ textZh: '开先' }, el.id + ':textZh');
  edit({ textZh: '中心广场' }, el.id + ':textZh');
  edit({ textEn: 'Central Plaza' }, el.id + ':textEn');
  A.undo();
  assert.equal(S.findElement(A.state, el.id).element.props.textZh, '中心广场');
  A.undo();
  assert.equal(S.findElement(A.state, el.id).element.props.textZh, '站名');
  A.redo();
  assert.equal(S.findElement(A.state, el.id).element.props.textZh, '中心广场');
});
