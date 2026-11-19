import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const filename = fileURLToPath(new URL('../js/preview-zoom.js', import.meta.url));
const browser = {};
runInNewContext(readFileSync(filename, 'utf8'), browser, { filename });
const { fitScale, scaleFromWheel, positionForAnchor } = browser.PreviewZoom;

test('适应画布可低于 25%，同时考虑宽和高，小牌面保持实际尺寸', () => {
  assert.equal(fitScale(800, 200, 600, 450), 0.75);
  assert.equal(fitScale(200, 800, 600, 400), 0.5);
  assert.equal(fitScale(8000, 8000, 600, 400), 0.05);
  assert.equal(fitScale(200, 8000, 600, 500), 0.0625);
  assert.equal(fitScale(100, 75, 600, 400), 1);
});

test('超长牌面显示实际的小数比例，手动缩放仍从 25% 起', () => {
  const preview = createPreview();
  preview.resize(600, 400);
  preview.zoom.refresh(200, 8000);
  assert.equal(preview.paper.style.height, '400px');
  assert.equal(preview.percent(), '5%');
  preview.zoom.refresh(200, 160000);
  assert.equal(preview.percent(), '0.25%');
  preview.choose(25);
  assert.equal(preview.paper.style.height, '40000px');
  preview.choose('fit');
  assert.equal(preview.paper.style.height, '400px');
});

test('滚轮支持像素、行、页和只提供横向滚动量的设备', () => {
  assert.ok(scaleFromWheel(1, { deltaY: -100, deltaX: 0, deltaMode: 0 }, 500) > 1);
  assert.ok(scaleFromWheel(1, { deltaY: 0, deltaX: 3, deltaMode: 1 }, 500) < 1);
  assert.ok(scaleFromWheel(1, { deltaY: -1, deltaX: 0, deltaMode: 2 }, 500) > 1);
  assert.equal(scaleFromWheel(1, { deltaY: 0, deltaX: 0, deltaMode: 0 }, 500), 1);
  assert.equal(scaleFromWheel(1, { deltaY: -3, deltaX: 0, deltaMode: 1 }, 500),
    scaleFromWheel(1, { deltaY: -96, deltaX: 0, deltaMode: 0 }, 500));
});

test('触控板的小数滚动量能累积，反向等量滚动回到原比例', () => {
  const event = { deltaY: -0.75, deltaX: 0, deltaMode: 0 };
  const closer = scaleFromWheel(1, event, 500);
  assert.ok(closer > 1 && closer < 1.01);
  assert.ok(Math.abs(scaleFromWheel(closer, { ...event, deltaY: 0.75 }, 500) - 1) < 1e-10);
  assert.ok(scaleFromWheel(closer, event, 500) > closer);
});

test('大幅滚动不会一次跳到边界，达到 25% 或 400% 后停止', () => {
  const fast = { deltaY: -9999, deltaX: 0, deltaMode: 0 };
  const reverse = { ...fast, deltaY: 9999 };
  assert.ok(scaleFromWheel(1, fast, 700) < 1.5);
  assert.equal(scaleFromWheel(3.9, fast, 700), 4);
  assert.equal(scaleFromWheel(4, fast, 700), 4);
  assert.equal(scaleFromWheel(0.26, reverse, 700), 0.25);
  assert.equal(scaleFromWheel(0.25, reverse, 700), 0.25);
});

test('放大后用滚动位置抵消鼠标下方图形的移动', () => {
  const position = positionForAnchor(250, 0.4, 800, 500);
  assert.equal(position.margin, 0);
  assert.equal(position.scroll, 70);
  assert.equal(position.margin - position.scroll + 0.4 * 800, 250);
});

test('缩小后在可用空白内挪动画布，碰到边缘时以可到达的位置为准', () => {
  const position = positionForAnchor(250, 0.4, 300, 500);
  assert.equal(position.margin, 130);
  assert.equal(position.scroll, 0);
  assert.equal(position.margin + 0.4 * 300, 250);
  assert.equal(positionForAnchor(490, 0, 300, 500).margin, 200);
  assert.equal(positionForAnchor(10, 1, 800, 500).scroll, 300);
});

function createPreview({ alignTop = false, observeResize = true } = {}) {
  const viewport = Object.assign(new EventTarget(), {
    clientWidth: 600, offsetWidth: 600, clientHeight: 450, offsetHeight: 450,
    clientLeft: 0, clientTop: 0, scrollLeft: 0, scrollTop: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    dataset: {}, style: {},
    setPointerCapture: () => {},
    hasPointerCapture: () => false,
  });
  const shackle = { setAttribute(name, value) { this[name] = value; } };
  const position = Object.assign(new EventTarget(), {
    dataset: {},
    querySelector: () => shackle,
    setAttribute(name, value) { this[name] = value; },
  });
  const fittingOption = {};
  const currentOption = {};
  const zoomMenu = Object.assign(new EventTarget(), {
    querySelector(selector) { return selector.includes('fit') ? fittingOption : currentOption; },
  });
  const graphic = { style: {} };
  const stage = { style: {} };
  const paper = {
    style: {},
    getBoundingClientRect: () => ({
      left: parseFloat(paper.style.marginLeft) - viewport.scrollLeft,
      top: parseFloat(paper.style.marginTop) - viewport.scrollTop,
      width: parseFloat(paper.style.width),
      height: parseFloat(paper.style.height),
    }),
  };
  let resize;
  browser.getComputedStyle = element => element === viewport ? {} : { marginTop: '20px' };
  browser.EditorMotion = { timing: () => ({ duration: 0 }) };
  browser.ResizeObserver = observeResize ? class {
    constructor(callback) { resize = callback; }
    observe(element) { assert.equal(element, viewport); }
  } : undefined;
  browser.addEventListener = (event, callback) => { assert.equal(event, 'resize'); resize = callback; };
  browser.setTimeout = setTimeout;
  browser.clearTimeout = clearTimeout;
  let changes = 0;
  const zoom = browser.PreviewZoom.create({
    viewport, stage, paper, graphic, alignTop, controls: { querySelector: selector => selector === 'button' ? position : zoomMenu },
    addRow: alignTop ? { offsetHeight: 30 } : undefined,
    onChange: () => { changes++; },
  });
  return {
    zoom, viewport, stage, paper, graphic, zoomMenu, position, shackle,
    percent() {
      if (zoomMenu.value === 'fit') return fittingOption.textContent.match(/[\d.]+%/)[0];
      if (zoomMenu.value === 'current') return currentOption.textContent;
      return zoomMenu.value + '%';
    },
    fitting: () => zoomMenu.value === 'fit',
    changeCount: () => changes,
    toggleLock: () => position.dispatchEvent(new Event('click')),
    choose(value) {
      zoomMenu.value = String(value);
      zoomMenu.dispatchEvent(new Event('change'));
    },
    pointer(type, clientX, clientY, button = 0) {
      const event = Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, clientX, clientY, button });
      viewport.dispatchEvent(event);
      return event.defaultPrevented;
    },
    wheel(options) {
      const event = Object.assign(new Event('wheel', { cancelable: !options.uncancelable }), {
        clientX: 300, clientY: 225, deltaMode: 0, deltaY: -100, deltaX: 0, ...options,
      });
      viewport.dispatchEvent(event);
      return event.defaultPrevented;
    },
    resize(width, height) {
      viewport.clientWidth = viewport.offsetWidth = width;
      viewport.clientHeight = viewport.offsetHeight = height;
      resize();
    },
  };
}

test('比例尺统一更新图形、外层和读数，窗口变化只重算适应模式', () => {
  const preview = createPreview({ alignTop: true });
  preview.zoom.refresh(800, 800);
  assert.equal(preview.percent(), '50%');
  assert.equal(preview.stage.style.minWidth, preview.paper.style.width);
  assert.equal(preview.graphic.style.height, preview.paper.style.height);
  assert.equal(preview.paper.style.marginTop, '0px');
  preview.resize(480, 350);
  assert.equal(preview.percent(), '38%');
  preview.choose(100);
  assert.equal(preview.percent(), '100%');
  assert.equal(preview.fitting(), false);
  preview.resize(900, 850);
  assert.equal(preview.graphic.style.width, '800px');
  preview.choose(75);
  assert.equal(preview.percent(), '75%');
  preview.choose('fit');
  assert.equal(preview.fitting(), true);
  assert.equal(preview.viewport.scrollLeft, 0);
  assert.equal(preview.viewport.scrollTop, 0);
});

test('只处理可取消的 Shift 滚动，保留浏览器快捷键和普通滚动', () => {
  const preview = createPreview({ observeResize: false });
  assert.equal(preview.wheel({ shiftKey: true }), false);
  preview.zoom.refresh(800, 400);
  const count = preview.changeCount();
  for (const options of [{}, { shiftKey: true, ctrlKey: true }, { shiftKey: true, metaKey: true },
    { shiftKey: true, uncancelable: true }, { shiftKey: true, deltaY: 0 }]) {
    assert.equal(preview.wheel(options), false);
  }
  assert.equal(preview.changeCount(), count);
  assert.equal(preview.wheel({ shiftKey: true, deltaY: 0, deltaX: -100 }), true);
  assert.equal(preview.percent(), '90%');
  assert.equal(preview.zoomMenu.value, 'current');
  preview.resize(700, 450);
  assert.equal(preview.percent(), '90%');
});

test('空白处单击仍能取消选择，拖动会平移纸面并退出适应画布', () => {
  const preview = createPreview();
  preview.zoom.refresh(120, 200);
  const before = parseFloat(preview.paper.style.marginLeft);
  preview.pointer('pointerdown', 300, 225);
  preview.pointer('pointerup', 300, 225);
  const clickWithoutDrag = new Event('click', { cancelable: true });
  preview.viewport.dispatchEvent(clickWithoutDrag);
  assert.equal(clickWithoutDrag.defaultPrevented, false);
  assert.equal(preview.fitting(), true);
  assert.equal(preview.pointer('pointerdown', 300, 225), true);
  preview.pointer('pointermove', 330, 225);
  preview.pointer('pointerup', 330, 225);
  const clickAfterDrag = new Event('click', { cancelable: true });
  preview.viewport.dispatchEvent(clickAfterDrag);
  assert.equal(clickAfterDrag.defaultPrevented, true);
  assert.equal(parseFloat(preview.paper.style.marginLeft), before + 30);
  assert.equal(preview.fitting(), false);
  assert.equal(preview.pointer('pointerdown', 300, 225, 1), true);
  preview.pointer('pointermove', 270, 225);
  preview.pointer('pointercancel', 270, 225);
  assert.equal(parseFloat(preview.paper.style.marginLeft), before);
  assert.equal(preview.viewport.dataset.dragging, undefined);
});

test('锁定后保留位置和比例，解锁后恢复缩放和拖动', () => {
  const preview = createPreview();
  preview.zoom.refresh(1000, 800);
  assert.equal(preview.position['aria-pressed'], 'false');
  assert.match(preview.position.title, /^已解锁/);
  const openShackle = preview.shackle.d;
  assert.equal(typeof openShackle, 'string');
  preview.choose(100);
  preview.viewport.scrollLeft = 175;
  preview.viewport.scrollTop = 150;
  preview.toggleLock();
  assert.equal(preview.viewport.dataset.positionLocked, 'true');
  assert.equal(preview.zoomMenu.disabled, true);
  assert.equal(preview.position['aria-pressed'], 'true');
  assert.match(preview.position.title, /^已锁定/);
  assert.notEqual(preview.shackle.d, openShackle);
  assert.equal(preview.pointer('pointerdown', 300, 225), false);
  assert.equal(preview.pointer('pointerdown', 300, 225, 1), false);
  preview.viewport.scrollLeft = 200;
  preview.viewport.scrollTop = 175;
  preview.viewport.dispatchEvent(new Event('scroll'));
  assert.equal(preview.viewport.scrollLeft, 175);
  assert.equal(preview.viewport.scrollTop, 150);
  preview.wheel({ shiftKey: true });
  preview.resize(500, 400);
  assert.equal(preview.percent(), '100%');
  const middleClick = Object.assign(new Event('auxclick', { cancelable: true }), { button: 1 });
  preview.viewport.dispatchEvent(middleClick);
  assert.equal(middleClick.defaultPrevented, true);
  preview.toggleLock();
  assert.equal(preview.zoomMenu.disabled, false);
  assert.equal(preview.position['aria-pressed'], 'false');
  assert.equal(preview.shackle.d, openShackle);
  assert.equal(preview.viewport.dataset.positionLocked, 'false');
  assert.equal(preview.pointer('pointerdown', 300, 225, 1), true);
  preview.pointer('pointerup', 300, 225, 1);
  preview.wheel({ shiftKey: true });
  assert.equal(preview.percent(), '120%');
});

test('切换项目解除锁定和滚动，下一张长图从适应比例开始', () => {
  const preview = createPreview();
  preview.zoom.refresh(1000, 800);
  preview.choose(100);
  preview.viewport.scrollLeft = 120;
  preview.viewport.scrollTop = 80;
  preview.toggleLock();
  preview.zoom.resetForProject();
  preview.zoom.refresh(250, 6000);
  assert.equal(preview.position['aria-pressed'], 'false');
  assert.equal(preview.zoomMenu.disabled, false);
  assert.equal(preview.viewport.scrollLeft, 0);
  assert.equal(preview.viewport.scrollTop, 0);
  assert.equal(preview.percent(), '7.5%');
});
