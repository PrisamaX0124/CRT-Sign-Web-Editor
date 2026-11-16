import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const filename = fileURLToPath(new URL('../js/editor-motion.js', import.meta.url));
const source = readFileSync(filename, 'utf8');

function createEditor() {
  const timing = new Map([
    ['--motion-panel-duration', '300ms'],
    ['--motion-reveal-duration', '230ms'],
    ['--motion-enter', 'cubic-bezier(.22, .72, .24, 1)'],
  ]);
  const context = {
    getComputedStyle: element => ({ ...element.appearance, getPropertyValue: name => timing.get(name) }),
  };
  runInNewContext(source, context, { filename });
  return { motion: context.EditorMotion, timing };
}

function createElement() {
  const motions = [];
  return {
    motions, hidden: false, inert: false, style: {}, appearance: { opacity: '.75', transform: 'matrix(1, 0, 0, 1, 4, 0)' },
    getBoundingClientRect() {
      const left = parseFloat(this.style.left) || 0;
      const top = parseFloat(this.style.top) || 0;
      return { left, top, right: left + 30, bottom: top + 20 };
    },
    animate(frames, timing) {
      const motion = { frames, timing, playState: 'running', cancel() { this.playState = 'idle'; } };
      motions.push(motion);
      return motion;
    },
  };
}

test('属性切换接着当前画面过渡，启用减少动态效果后直接显示', () => {
  const { motion, timing } = createEditor();
  const panel = createElement();
  motion.reveal(panel, 1);
  const first = panel.motions[0];
  assert.equal(first.frames[0].transform, 'translateX(12px)');
  assert.equal(first.timing.duration, 300);
  motion.reveal(panel, -1);
  const second = panel.motions[1];
  assert.equal(first.playState, 'idle');
  assert.equal(second.frames[0].transform, panel.appearance.transform);
  assert.equal(second.frames[0].opacity, panel.appearance.opacity);
  timing.set('--motion-panel-duration', '0ms');
  motion.reveal(panel, 1);
  assert.equal(second.playState, 'idle');
  assert.equal(panel.motions.length, 2);
});

test('工具栏在切换选中元素时移动，同一元素跟随画布位置，隐藏时清除上次位置', () => {
  const { motion } = createEditor();
  const toolbar = createElement();
  motion.placeToolbar(toolbar, 20, 30, 'first');
  motion.placeToolbar(toolbar, 40, 50, 'second');
  const moving = toolbar.motions[0];
  assert.equal(moving.frames[0].translate, '-20px -20px');
  motion.placeToolbar(toolbar, 40, 50, 'second');
  assert.equal(moving.playState, 'running');
  motion.placeToolbar(toolbar, 40, 55, 'second');
  assert.equal(toolbar.style.top, '55px');
  assert.equal(moving.playState, 'idle');
  motion.setToolbarVisible(toolbar, false);
  assert.ok(toolbar.hidden && toolbar.inert);
  motion.setToolbarVisible(toolbar, true);
  motion.placeToolbar(toolbar, 20, 30, 'first');
  assert.ok(!toolbar.hidden && !toolbar.inert);
  assert.equal(toolbar.motions.length, 1);
});

test('结束或取消淡出后清理节点，没有动画时立即清理', async () => {
  const { motion } = createEditor();
  const element = createElement();
  let cleaned = false;
  motion.afterMotion(element, () => { cleaned = true; });
  assert.ok(cleaned);

  let cancel;
  const finished = new Promise((resolve, reject) => { cancel = reject; });
  element.getAnimations = () => [{ finished }];
  let cleanup;
  const removed = new Promise(resolve => { cleanup = resolve; });
  cleaned = false;
  motion.afterMotion(element, () => { cleaned = true; cleanup(); });
  assert.ok(!cleaned);
  cancel(new Error('动画已取消'));
  await removed;
  assert.ok(cleaned);
});

test('窗口变窄后，工具栏可以直接从画布外回到画布内', () => {
  const { motion } = createEditor();
  const toolbar = createElement();
  toolbar.offsetParent = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 200 }) };
  motion.placeToolbar(toolbar, 220, 20, 'first');
  motion.placeToolbar(toolbar, 110, 20, 'second');
  assert.equal(toolbar.style.left, '110px');
  assert.equal(toolbar.motions.length, 0);
});
