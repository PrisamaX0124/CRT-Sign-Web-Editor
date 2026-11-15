import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function harness() {
  const c = { window: null, document: {}, Date };
  c.window = c;
  ['core', 'state', 'ui'].forEach(name => runInNewContext(
    readFileSync(new URL('../js/' + name + '.js', import.meta.url), 'utf8'), c));
  c.App.state = c.SignState.createSign();
  c.App.renderAll = () => {};
  const saved = [];
  c.SignStorage = { scheduleAutosave: state => saved.push(state) };
  return { ...c, saved };
}

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
