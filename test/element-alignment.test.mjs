import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const browser = { crypto: { randomUUID: (() => { let count = 0; return () => 'element-' + ++count; })() } };
for (const name of ['core', 'state', 'render', 'element-alignment']) {
  const source = new URL('../js/' + name + '.js', import.meta.url);
  runInNewContext(readFileSync(source, 'utf8'), browser, { filename: fileURLToPath(source) });
}

const { selectionBounds, alignMovement } = browser.ElementAlignment;
const { SignState, SignRender } = browser;
const canvasWidth = 400;
const moving = { x: 0, width: 40 };
const limits = { left: -Infinity, right: Infinity };

test('右侧箭头贴住原边缘，文字变长时在左侧腾出空间', () => {
  let sign = SignState.updateSignSettings(SignState.createSign(), { width: 400, rowHeight: 100 });
  const line = SignState.createElement('space', { widthRatio: 0.6 });
  const text = SignState.createElement('space', { widthRatio: 1.3, positionOffset: { x: 120 } });
  const arrow = SignState.createElement('space', { widthRatio: 0.5, positionOffset: { x: 160 } });
  for (const element of [line, text, arrow]) sign = SignState.addElement(sign, sign.rows[0].id, element);
  const measure = () => 0;
  const prepared = SignRender.anchorExistingPositions(sign, SignRender.layoutSign(sign, measure));
  const longer = SignState.updateElementProps(prepared, text.id, { widthRatio: 2.5 });
  const [first, name, last] = SignRender.layoutSign(longer, measure).rows[0].elements.map(element => element.box);
  assert.equal(first.x, 0);
  assert.equal(last.x + last.width, 400);
  assert.ok(first.x + first.width <= name.x && name.x + name.width <= last.x);
  const crowded = SignState.updateElementProps(prepared, text.id, { widthRatio: 4 });
  const crowdedRow = SignRender.layoutSign(crowded, measure).rows[0];
  assert.ok(crowdedRow.elements[0].scale < 1);
  assert.equal(crowdedRow.elements.at(-1).box.x + crowdedRow.elements.at(-1).box.width, 400);
  const beyondEdge = SignState.updateElementProps(sign, arrow.id, { positionOffset: { x: 240 } });
  const repaired = SignRender.anchorExistingPositions(beyondEdge, SignRender.layoutSign(beyondEdge, measure));
  assert.deepEqual({ ...repaired.rows[0].elements.at(-1).props.positionOffset }, { anchor: 'right', x: 0 });
});

test('居中和贴右的位置经保存恢复后，随画布宽度改变继续对齐', () => {
  let sign = SignState.updateSignSettings(SignState.createSign(), { width: 400, rowHeight: 100 });
  const centered = SignState.createElement('space', { widthRatio: 1, positionOffset: { anchor: 'center', x: 0 } });
  const right = SignState.createElement('space', { widthRatio: 0.5, positionOffset: { anchor: 'right', x: 0 } });
  for (const element of [centered, right]) sign = SignState.addElement(sign, sign.rows[0].id, element);
  const restored = SignState.deserializeSign(SignState.serializeSign(sign));
  const wider = SignState.updateSignSettings(restored, { width: 600 });
  const elements = SignRender.layoutSign(wider, () => 0).rows[0].elements;
  assert.equal(elements[0].box.x + elements[0].box.width / 2, 300);
  assert.equal(elements[1].box.x + elements[1].box.width, 600);
});

test('自由拖动吸附到目标行，为移动的元素让位，原状态保持不变', () => {
  let sign = SignState.addRow(SignState.updateSignSettings(SignState.createSign(), { width: 400, rowHeight: 100 }));
  const first = SignState.createElement('space', { widthRatio: 1 });
  const second = SignState.createElement('space', { widthRatio: 1 });
  sign = SignState.addElement(sign, sign.rows[0].id, first);
  sign = SignState.addElement(sign, sign.rows[1].id, second);
  const measure = () => 0;
  const layout = SignRender.layoutSign(sign, measure);
  assert.equal(SignRender.moveFreeElements(sign, layout, [first.id, second.id], 0, 1), sign);
  const moved = SignRender.moveFreeElements(sign, layout, [first.id], 0, 1);
  const rows = SignRender.layoutSign(moved, measure).rows;
  assert.equal(sign.rows[0].elements[0].id, first.id);
  assert.equal(rows[0].elements.length, 0);
  assert.deepEqual(Array.from(rows[1].elements, element => [element.box.x, element.box.y]), [[0, 100], [100, 100]]);
});

test('左右移动按钮交换视觉相邻的元素，其他元素的位置不变', () => {
  let sign = SignState.updateSignSettings(SignState.createSign(), { width: 400, rowHeight: 100 });
  const first = SignState.createElement('space', { widthRatio: 0.5 });
  const second = SignState.createElement('space', { widthRatio: 0.8, positionOffset: { x: 30 } });
  const last = SignState.createElement('space', { widthRatio: 0.5, positionOffset: { x: 220 } });
  for (const element of [first, second, last]) sign = SignState.addElement(sign, sign.rows[0].id, element);
  const measure = () => 0;
  const initial = SignRender.layoutSign(sign, measure);
  const moved = SignRender.moveVisualElementsBy(sign, initial, [first.id], 1);
  const elements = SignRender.layoutSign(moved, measure).rows[0].elements;
  assert.deepEqual(Array.from(elements, element => element.id), [second.id, first.id, last.id]);
  assert.deepEqual(Array.from(elements, element => element.box.x), [0, 110, 350]);
});

test('左右移动按钮把连续多选看作整组，保留组内空隙和远处元素的位置', () => {
  let sign = SignState.updateSignSettings(SignState.createSign(), { width: 400, rowHeight: 100 });
  const positions = [0, 70, 190, 350];
  const widths = [0.5, 0.8, 0.6, 0.5];
  const elements = widths.map((widthRatio, index) => SignState.createElement('space', {
    widthRatio, positionOffset: { anchor: 'left', x: positions[index] },
  }));
  for (const element of elements) sign = SignState.addElement(sign, sign.rows[0].id, element);
  const measure = () => 0;
  const before = SignRender.layoutSign(sign, measure);
  const moved = SignRender.moveVisualElementsBy(sign, before, [elements[0].id, elements[1].id], 1);
  const actual = SignRender.layoutSign(moved, measure).rows[0].elements;
  assert.deepEqual(Array.from(actual, element => element.box.x), [0, 100, 170, 350]);
  const reversed = SignRender.moveVisualElementsBy(sign, before, [elements[1].id, elements[2].id], -1);
  assert.deepEqual(Array.from(SignRender.layoutSign(reversed, measure).rows[0].elements, element => element.box.x), [0, 120, 200, 350]);
});

test('旧项目的跨行位置回到所属行，横向偏移保留在排版和存档中', () => {
  let sign = SignState.addRow(SignState.createSign());
  const upper = SignState.createElement('space', { positionOffset: { x: 31.5, y: sign.rowHeight / 2 } });
  const lower = SignState.createElement('space', { positionOffset: { y: -sign.rowHeight / 2 } });
  sign = SignState.addElement(sign, sign.rows[0].id, upper);
  sign = SignState.addElement(sign, sign.rows[1].id, lower);
  const restored = SignState.deserializeSign(SignState.serializeSign(sign));
  assert.deepEqual({ ...restored.rows[0].elements[0].props.positionOffset }, { x: 31.5 });
  assert.equal(restored.rows[1].elements[0].props.positionOffset, undefined);
  for (const project of [sign, restored]) {
    const { rows } = SignRender.layoutSign(project, () => 0);
    assert.equal(rows[0].elements[0].box.x, 31.5);
    for (const row of rows) assert.equal(row.elements[0].box.y, row.y);
  }
  const copied = SignState.deserializeElements(SignState.serializeElements(sign, [upper.id, lower.id]));
  assert.deepEqual({ ...copied.rows[0].elements[0].props.positionOffset }, { x: 31.5 });
  assert.equal(copied.rows[1].elements[0].props.positionOffset, undefined);
});

function checkMovement(box, others, distance, expected, settings = {}) {
  const result = alignMovement(box, others, canvasWidth, distance, settings.scale || 1,
    settings.limits || limits, settings.enabled ?? true);
  assert.deepEqual({ ...result }, expected);
}

test('标识牌中心和左右边缘可以吸附', () => {
  checkMovement(moving, [], 184, { distance: 180, guide: 200 });
  checkMovement(moving, [], 357, { distance: 360, guide: 400 });
  checkMovement(moving, [], 4, { distance: 0, guide: 0 });
});

test('相邻元素支持贴边、同侧边缘和中心对齐，选择最近的参考线', () => {
  const nearby = { x: 100, width: 30 };
  checkMovement(moving, [nearby], 62, { distance: 60, guide: 100 });
  checkMovement(moving, [nearby], 94, { distance: 95, guide: 115 });
  checkMovement(moving, [nearby], 103, { distance: 100, guide: 100 });
});

test('多选以整组选框为准，排除选中的元素作为参照', () => {
  const bounds = selectionBounds([moving, { x: 55, width: 25 }]);
  assert.deepEqual({ ...bounds }, { x: 0, width: 80 });
  checkMovement(bounds, [], 157, { distance: 160, guide: 200 });
});

test('吸附距离按屏幕像素计算，关闭吸附保留原移动量', () => {
  const nearby = { x: 100, width: 40 };
  checkMovement(moving, [nearby], 50, { distance: 60, guide: 100 }, { scale: 0.5 });
  checkMovement(moving, [nearby], 56, { distance: 56, guide: null }, { scale: 2 });
  checkMovement(moving, [nearby], 58.5, { distance: 58.5, guide: null }, { enabled: false });
});

test('不可达的位置不显示对齐线，拖回起点不吸附到附近的线', () => {
  checkMovement(moving, [], 185, { distance: 174, guide: null }, { limits: { ...limits, right: 174 } });
  checkMovement({ x: 4, width: 40 }, [], 0, { distance: 0, guide: null });
});

test('每个选框都留在画布内，多选两端共用可移动范围', () => {
  const boxes = [{ x: 10, width: 40 }, { x: 325, width: 50 }];
  const bounds = browser.ElementAlignment.limitsWithinCanvas(boxes, canvasWidth);
  assert.deepEqual({ ...bounds }, { left: -10, right: 25 });
  checkMovement(selectionBounds(boxes), [], 500, { distance: 25, guide: 400 }, { limits: bounds });
});

test('超宽的单个元素保持最大可见范围，放不下的多选不能继续整体横移', () => {
  assert.deepEqual({ ...browser.ElementAlignment.limitsWithinCanvas([{ x: -10, width: 420 }], canvasWidth) }, {
    left: -10, right: 10,
  });
  assert.deepEqual({ ...browser.ElementAlignment.limitsWithinCanvas([
    { x: 0, width: 20 }, { x: 390, width: 30 },
  ], canvasWidth) }, { left: 0, right: 0 });
});

class TestElement extends EventTarget {
  attributes = new Map();
  classList = new Set();
  children = [];
  dataset = {};
  style = {};

  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...elements) { this.children.push(...elements); }
  replaceChildren() { this.children = []; }
  hasPointerCapture() { return false; }
}

function createMovement() {
  const document = new TestElement(), window = new EventTarget();
  const paper = new TestElement(), graphic = new TestElement(), toggle = new TestElement();
  const frames = new Map(), previews = [], commits = [];
  let frameNumber = 0;
  const bounds = { left: 6, top: 9, width: 400, height: 200 };
  graphic.getBoundingClientRect = () => ({ ...bounds });
  const createElement = () => new TestElement();
  document.createElement = document.createElementNS = createElement;
  Object.assign(browser, {
    document,
    addEventListener: window.addEventListener.bind(window),
    requestAnimationFrame(callback) { frames.set(++frameNumber, callback); return frameNumber; },
    cancelAnimationFrame(number) { frames.delete(number); },
  });
  toggle.setAttribute('aria-pressed', 'true');
  let identifier = '选中元素';
  const controller = browser.ElementAlignment.create({
    paper, graphic, toggle,
    identifierAt: () => identifier,
    select: () => identifier && { canvasWidth, moving, others: [], limits },
    rowDistance: (selection, position) => position >= 120 ? 1 : 0,
    preview: (graphic, selection, movement) => previews.push(movement),
    commit: (selection, distance, rows) => commits.push({ distance, rows }),
  });
  const [preview, guideLayer] = paper.children;
  const [guide] = guideLayer.children;
  function pointer(type, clientX, clientY, options = {}) {
    const target = type === 'pointerdown' ? graphic : type === 'lostpointercapture' ? paper : document;
    const event = Object.assign(new Event(type, { cancelable: true }), {
      clientX, clientY, pointerType: 'mouse', pointerId: 1, button: 0, ...options,
    });
    target.dispatchEvent(event);
    return event;
  }
  return {
    pointer, preview, previews, commits, bounds, guide, toggle, controller, document, window,
    clearIdentifier() { identifier = null; },
    frame() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback());
    },
  };
}

test('先达到拖动距离才显示预览，多次移动只绘制一帧，松手以最后位置提交', () => {
  const movement = createMovement();
  assert.equal(movement.pointer('pointerdown', 26, 39).defaultPrevented, true);
  movement.pointer('pointermove', 28, 39);
  movement.frame();
  assert.equal(movement.previews.length, 0);
  movement.pointer('pointermove', 150, 39);
  movement.pointer('pointermove', 209, 106);
  movement.frame();
  assert.equal(movement.previews.length, 1);
  assert.equal(movement.guide.style.left, '50%');
  movement.pointer('pointermove', 209, 106);
  movement.frame();
  assert.equal(movement.previews.length, 1);
  movement.pointer('pointerup', 206, 106, { pointerId: 2 });
  assert.equal(movement.commits.length, 0);
  movement.pointer('pointerup', 224, 106);
  assert.equal(movement.commits.length, 1);
  assert.deepEqual(movement.commits[0], { distance: 198, rows: 0 });
  assert.equal(movement.guide.hidden, true);
  assert.equal(movement.preview.getAttribute('hidden'), '');
});

test('只向下拖动可以吸附到另一行，无需横向移动', () => {
  const movement = createMovement();
  movement.pointer('pointerdown', 26, 39);
  movement.pointer('pointermove', 26, 180);
  movement.frame();
  movement.pointer('pointerup', 26, 180);
  assert.equal(movement.previews.length, 1);
  assert.deepEqual(movement.commits, [{ distance: 0, rows: 1 }]);
  assert.equal(movement.guide.hidden, true);
});

test('拖动时关闭吸附即更新参考线，缩放和滚动之后仍按当前画布换算位置', () => {
  const movement = createMovement();
  movement.pointer('pointerdown', 26, 39);
  movement.pointer('pointermove', 209, 39);
  movement.frame();
  assert.equal(movement.previews[0], 180);
  movement.toggle.dispatchEvent(new Event('click'));
  movement.frame();
  assert.equal(movement.guide.hidden, true);
  assert.equal(movement.toggle.getAttribute('aria-pressed'), 'false');
  Object.assign(movement.bounds, { left: 20, top: -12, width: 800, height: 400 });
  movement.pointer('pointermove', 380, 48);
  movement.frame();
  assert.equal(movement.previews.at(-1), 160);
  movement.controller.cancelActive();
  assert.equal(movement.preview.getAttribute('hidden'), '');
  assert.equal(movement.commits.length, 0);
});

test('空白和辅助按键不会拖动元素，取消指针或离开窗口时清理预览', () => {
  const movement = createMovement();
  for (const options of [{ button: 1 }, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { isPrimary: false }]) {
    assert.equal(movement.pointer('pointerdown', 26, 39, options).defaultPrevented, false);
    movement.pointer('pointermove', 209, 106);
    movement.frame();
  }
  for (const cancel of [
    () => movement.pointer('pointercancel', 209, 106),
    () => movement.pointer('lostpointercapture', 209, 106),
    () => movement.window.dispatchEvent(new Event('blur')),
    () => movement.document.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' })),
  ]) {
    movement.pointer('pointerdown', 26, 39);
    movement.pointer('pointermove', 209, 106);
    movement.frame();
    assert.equal(movement.guide.hidden, false);
    cancel();
    movement.pointer('pointerup', 209, 106);
    assert.equal(movement.guide.hidden, true);
    assert.equal(movement.commits.length, 0);
  }
  movement.pointer('pointerdown', 26, 39);
  movement.clearIdentifier();
  movement.pointer('pointermove', 209, 106);
  movement.frame();
  assert.equal(movement.preview.getAttribute('hidden'), '');
  assert.equal(movement.pointer('pointerdown', 26, 39).defaultPrevented, false);
});

test('单指移动元素时不滚动画布，加入第二根手指后交回浏览器处理', () => {
  const movement = createMovement();
  const touch = (type, count) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { touches: Array(count).fill({}) });
    movement.document.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(touch('touchmove', 1), false);
  movement.pointer('pointerdown', 26, 39, { pointerType: 'touch' });
  assert.equal(touch('touchmove', 1), true);
  movement.pointer('pointermove', 209, 106, { pointerType: 'touch' });
  movement.frame();
  assert.equal(movement.guide.hidden, false);
  assert.equal(touch('touchstart', 2), false);
  assert.equal(touch('touchmove', 2), false);
  assert.equal(movement.guide.hidden, true);
  assert.equal(movement.commits.length, 0);
});

test('导向标识整体移动保留所属行和组内间距，位置随项目保存并可恢复', () => {
  const first = SignState.createElement('space', { widthRatio: 0.5 });
  const second = SignState.createElement('space', { widthRatio: 0.75 });
  let original = SignState.addRow(SignState.createSign());
  original = SignState.addElement(original, original.rows[0].id, first);
  original = SignState.addElement(original, original.rows[1].id, second);
  const emptyMeasurement = () => 0;
  const initialLayout = SignRender.layoutSign(original, emptyMeasurement);
  const identifiers = [first.id, second.id, '找不到的元素'];
  const shifted = SignRender.moveFreeElements(original, initialLayout, identifiers, 31.5, 0);
  const restored = SignState.deserializeSign(SignState.serializeSign(shifted));
  const layout = SignRender.layoutSign(restored, emptyMeasurement);
  for (const [index, row] of layout.rows.entries()) {
    const initial = initialLayout.rows[index].elements[0];
    const element = row.elements[0];
    assert.equal(element.id, initial.id);
    assert.equal(element.x, initial.x);
    assert.equal(element.box.x - initial.box.x, 31.5);
    assert.equal(element.box.y, initial.box.y);
    assert.equal(original.rows[index].elements[0].props.positionOffset, undefined);
  }
  const reset = SignState.resetElementPositions(shifted, identifiers);
  assert.equal(SignState.serializeSign(reset), SignState.serializeSign(original));
  assert.equal(SignState.resetElementPositions(original, identifiers), original);
  assert.equal(SignRender.moveFreeElements(original, initialLayout, [], 6, 0), original);
  assert.equal(SignRender.moveFreeElements(original, initialLayout, identifiers, 0, 0), original);
  assert.equal(SignRender.moveFreeElements(original, initialLayout, identifiers, NaN, 0), original);
});

test('导向标识旧项目照常打开，导入时忽略无效位置并保留有效坐标', () => {
  let sign = SignState.createSign();
  sign = SignState.addElement(sign, sign.rows[0].id, SignState.createElement('arrow'));
  sign = SignState.addElement(sign, sign.rows[0].id, SignState.createElement('arrow', { positionOffset: { x: '错误', y: Infinity } }));
  sign = SignState.addElement(sign, sign.rows[0].id, SignState.createElement('arrow', { positionOffset: { x: -1.25, y: null } }));
  const positions = SignState.deserializeSign(sign).rows[0].elements.map(element => element.props.positionOffset);
  assert.equal(positions[0], undefined);
  assert.equal(positions[1], undefined);
  assert.deepEqual({ ...positions[2] }, { x: -1.25 });
});
