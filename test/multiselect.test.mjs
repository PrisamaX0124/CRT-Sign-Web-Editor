import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function harness() {
  const c = { window: null, document: {}, Date };
  c.window = c;
  ['core', 'state', 'ui'].forEach(name => runInNewContext(readFileSync(new URL('../js/' + name + '.js', import.meta.url), 'utf8'), c));
  const S = c.SignState, A = c.App;
  const els = ['bilingual-text', 'small-bilingual-text', 'exit', 'icon', 'number-line'].map(type => S.createElement(type));
  let st = S.createSign();
  els.forEach(el => { st = S.addElement(st, st.rows[0].id, el); });
  A.state = S.applyPaddingAuto(st);
  A.renderAll = () => {};
  return { S, A, els };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('批量背景色覆盖所有可设色类型，跳过出口并保留未选中元素', () => {
  const { A: application, S: state } = harness();
  const editableTypes = ['arrow', 'bilingual-text', 'small-bilingual-text', 'big-number', 'number-line', 'text-line', 'entrance', 'space', 'icon'];
  const elements = editableTypes.concat('exit', 'icon').map(type => state.createElement(type));
  let sign = state.createSign();
  elements.forEach(element => { sign = state.addElement(sign, sign.rows[0].id, element); });
  application.state = state.applyPaddingAuto(sign);
  application.selectMany(elements.slice(0, -1).map(element => element.id));
  const before = JSON.stringify(application.state);
  assert.equal(application.backgroundColorValue(), null);
  application.setBackgroundColor('#123456');
  editableTypes.forEach((type, index) => assert.equal(state.findElement(application.state, elements[index].id).element.props.backgroundColor, '#123456', type));
  assert.equal(state.findElement(application.state, elements[9].id).element.props.backgroundColor, '#F7D917');
  assert.equal(state.findElement(application.state, elements[10].id).element.props.backgroundColor, null);
  assert.equal(application.backgroundColorValue(), '#123456');
  assert.equal(application.state.backgroundColor, '#FFFFFF');
  application.undo();
  assert.equal(JSON.stringify(application.state), before);
  assert.equal(application.selectedIds().length, 10);
  application.redo();
  application.setBackgroundColor(null);
  assert.equal(application.backgroundColorValue(), null);
  assert.equal(state.findElement(application.state, elements[9].id).element.props.backgroundColor, '#F7D917');
  application.selectMany([elements[9].id]);
  const fixed = application.state;
  application.setBackgroundColor('#ABCDEF');
  assert.equal(application.state, fixed);
});

test('批量背景色区分透明、混合值、失效选择，连续编辑不回滚', () => {
  const { A: application, S: state, els: elements } = harness();
  application.selectMany([elements[0].id, elements[1].id]);
  application.update(sign => state.updateElementProps(sign, elements[0].id, { backgroundColor: '#112233' }));
  assert.equal(application.backgroundColorValue(), undefined);
  application.setAlignment('align', 'right');
  application.setBackgroundColor('#AABBCC');
  assert.equal(application.backgroundColorValue(), '#AABBCC');
  elements.slice(0, 2).forEach(element => assert.equal(state.findElement(application.state, element.id).element.props.align, 'right'));
  application.selectMany([]);
  const before = application.state;
  application.setBackgroundColor('#112233');
  assert.equal(application.state, before);
});

test('预览外层、图形与覆盖层共用显示宽度，缩放和窗口变化不会累积缩小', () => {
  const context = { window: null, Date };
  context.window = context;
  const elements = {
    'canvas-area': { clientWidth: 1400 },
    'canvas-wrap': { style: {} },
    'sign-svg': { style: {}, getBoundingClientRect: () => ({ height: 192 }) },
    'sign-overlay': { style: {} },
  };
  context.document = { getElementById: name => elements[name] };
  ['core', 'state', 'ui'].forEach(name => runInNewContext(readFileSync(new URL('../js/' + name + '.js', import.meta.url), 'utf8'), context));
  const application = context.App;
  for (const width of [256, 512, 768, 1024, 1280, 1536, 2048]) {
    application.layout = { width };
    for (const available of [1400, 320, 1000]) {
      elements['canvas-area'].clientWidth = available;
      for (const zoom of [1, 0.5, 2]) {
        application.canvasZoom = zoom;
        application.fitSignDisplay();
        const expected = Math.min(available, 1600, width) * zoom + 'px';
        assert.equal(elements['canvas-wrap'].style.width, expected);
        assert.equal(elements['sign-svg'].style.width, expected);
        assert.equal(elements['sign-overlay'].style.width, expected);
        application.fitSignDisplay();
        assert.equal(elements['canvas-wrap'].style.width, expected);
      }
    }
  }
});

test('Ctrl切换选择、Shift范围、Ctrl+Shift追加、普通单击及全选', () => {
  const { A, els: [a, b, c, d, e] } = harness();
  A.select(a.id); A.select(c.id, { toggle: true });
  assert.deepEqual(plain(A.selectedIds()), [a.id, c.id]);
  A.select(e.id, { range: true });
  assert.deepEqual(plain(A.selectedIds()), [c.id, d.id, e.id]);
  A.select(b.id, { range: true, toggle: true });
  assert.deepEqual(new Set(A.selectedIds()), new Set([b.id, c.id, d.id, e.id]));
  A.select(c.id, { toggle: true });
  assert.equal(A.selectedIds().includes(c.id), false);
  A.select(b.id);
  assert.deepEqual(plain(A.selectedIds()), [b.id]);
  A.selectAll(); assert.equal(A.selectedIds().length, 5);
  A.select(null); assert.equal(A.selection.elementId, null); assert.deepEqual(plain(A.selectedIds()), []);
});

test('Shift范围按牌面视觉顺序选择，包括贴右通道与跨行', () => {
  const { A, S, els } = harness();
  A.state = S.addRow(A.state);
  A.state = S.moveElement(A.state, els[4].id, A.state.rows[1].id, 0);
  A.layout = { rows: [{ elements: [3, 2, 1, 0].map((n, i) => ({ id: els[n].id, x: i * 100 })) },
    { elements: [{ id: els[4].id, x: 0 }] }] };
  A.select(els[2].id); A.select(els[4].id, { range: true });
  assert.deepEqual(plain(A.selectedIds()), [els[2].id, els[1].id, els[0].id, els[4].id]);
});

test('多选对齐只改适用元素，一步撤销恢复完整多选，删除过滤失效选择', () => {
  const { A, S, els } = harness();
  A.selectAll(); const before = JSON.stringify(A.state);
  assert.equal(A.alignmentValue('align'), 'center');
  A.setAlignment('align', 'right');
  assert.equal(S.findElement(A.state, els[0].id).element.props.align, 'right');
  assert.equal(S.findElement(A.state, els[2].id).element.props.align, 'left');
  A.undo(); assert.equal(JSON.stringify(A.state), before); assert.equal(A.selectedIds().length, 5);
  A.setAlignment('elementAlign', 'right');
  assert.ok(A.state.rows[0].elements.every(el => el.props.elementAlign === 'right'));
  A.update(st => S.deleteElements(st, [els[0].id, els[1].id]));
  assert.equal(A.selectedIds().length, 3);
  A.deleteSelection(); assert.equal(A.selectedIds().length, 0); assert.equal(A.state.rows[0].elements.length, 0);
  A.undo(); assert.equal(A.selectedIds().length, 3);
  A.undo(); assert.equal(A.selectedIds().length, 5);
});

test('多选左右移动保留各行各通道的组内顺序与非选中元素', () => {
  const { S, A, els: [a, b, c, d, e] } = harness();
  const before = JSON.stringify(A.state);
  const moved = S.moveElementsBy(A.state, [b.id, c.id], -1);
  assert.deepEqual(plain(moved.rows[0].elements.map(el => el.id)), [b.id, c.id, a.id, d.id, e.id]);
  assert.equal(JSON.stringify(A.state), before);
  assert.equal(JSON.stringify(S.moveElementsBy(moved, [b.id, c.id], -1)), JSON.stringify(moved));
  let right = A.state;
  [a, b, c, d, e].forEach(el => { right = S.updateElementProps(right, el.id, { elementAlign: 'right' }); });
  assert.deepEqual(plain(S.moveElementsBy(right, [b.id, c.id], -1).rows[0].elements.map(el => el.id)), [a.id, d.id, b.id, c.id, e.id]);
  assert.deepEqual(plain(S.moveElements(A.state, [b.id, c.id], A.state.rows[0].id, 5).rows[0].elements.map(el => el.id)), [a.id, d.id, e.id, b.id, c.id]);
  assert.equal(S.moveElements(A.state, [b.id], 'missing', 0), A.state);
});

test('剪贴板快照保留跨行偏移、复杂属性，粘贴深拷贝并生成新ID', () => {
  const { S, A, els } = harness();
  let source = S.addRow(S.addRow(A.state));
  source = S.moveElement(source, els[4].id, source.rows[2].id, 0);
  source = S.updateElementProps(source, els[4].id, { lines: [{ number: '10', color: '#ABCDEF' }, { number: '2', color: '#123456' }],
    padding: { left: 0.375 }, elementAlign: 'right' });
  const text = S.serializeElements(source, [els[0].id, els[4].id]);
  const data = S.deserializeElements(text);
  assert.deepEqual(plain(data.rows.map(row => row.offset)), [0, 2]);
  const target = S.createSign(), original = JSON.stringify(target);
  const pasted = S.pasteElements(target, data, target.rows[0].id, 0);
  assert.equal(JSON.stringify(target), original); assert.equal(pasted.rows.length, 3);
  assert.equal(pasted.rows[1].elements.length, 0);
  const clone = pasted.rows[2].elements[0];
  assert.notEqual(clone.id, els[4].id);
  assert.deepEqual(plain(clone.props), plain(S.findElement(source, els[4].id).element.props));
  clone.props.lines[0].number = '99';
  assert.equal(data.rows[1].elements[0].props.lines[0].number, '10');
  const repeated = S.pasteElements(pasted, data, pasted.rows[0].id, 1);
  assert.notEqual(repeated.rows[0].elements[0].id, repeated.rows[0].elements[1].id);
});

test('剪贴板仅接受自身格式，校验外部属性并限制异常行偏移/内容', () => {
  const { S } = harness();
  for (const data of ['ordinary text', '{}', '{"kind":"jr-sign-elements","version":9,"rows":[]}',
    { kind: 'jr-sign-elements', version: 1, rows: [{ offset: -1, elements: [{ type: 'icon' }] }] },
    { kind: 'jr-sign-elements', version: 1, rows: [{ offset: 10000, elements: [{ type: 'icon' }] }] },
    { kind: 'jr-sign-elements', version: 1, rows: [{ offset: 0, elements: [{ type: 'unknown' }] }] }]) {
    assert.throws(() => S.deserializeElements(data));
  }
  const repaired = S.deserializeElements({ kind: 'jr-sign-elements', version: 1, rows: [{ offset: 0,
    elements: [{ type: 'bilingual-text', props: { textZh: 42, align: 'invalid', padding: { left: 999 } } }] }] });
  assert.equal(repaired.rows[0].elements[0].props.textZh, '42');
  assert.equal(repaired.rows[0].elements[0].props.padding.left, 8);
});

test('粘贴历史同时保存新多选，撤销/重做恢复粘贴前后选择', () => {
  const { A, S, els } = harness();
  A.selectMany([els[0].id, els[1].id]);
  const beforeIds = A.selectedIds().slice();
  const data = S.deserializeElements(S.serializeElements(A.state, beforeIds));
  A.update(st => S.pasteElements(st, data, st.rows[0].id, 2), null, { selectNew: true });
  const newIds = A.selectedIds().slice();
  assert.equal(newIds.length, 2); assert.ok(newIds.every(id => !beforeIds.includes(id)));
  A.undo(); assert.deepEqual(plain(A.selectedIds()), plain(beforeIds));
  A.redo(); assert.deepEqual(plain(A.selectedIds()), plain(newIds));
});
