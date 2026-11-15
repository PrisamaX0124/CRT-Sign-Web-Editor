import { createStationProject } from './station-data.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

for (const path of [
  'js/core.js', 'js/platform/state.js', 'js/platform/reference.js',
  'js/platform/vertical-reference.js', 'js/platform/route.js', 'js/platform/hanging.js',
  'js/platform/vertical.js', 'js/platform/render.js',
  'assets/platform-patterns.js', 'js/platform/patterns.js', 'js/platform/presets.js',
]) {
  await import(new URL('../' + path, import.meta.url));
}

const measure = (text, family, weight, size) => String(text).length * size * 0.9;
measure.ascent = (text, family, weight, size) => size * 0.8;
measure.descent = (text, family, weight, size) => size * 0.1;
measure.ink = (text, family, weight, size) => ({
  abl: -size * 0.05, abr: measure(text, family, weight, size) - size * 0.05,
  adv: measure(text, family, weight, size),
});

const original = createStationProject(PlatformState);
const change = (linePattern, other) => PlatformState.settings(original, { ...other, linePattern });
const sceneFor = (linePattern, other) => PlatformRender.metrics(change(linePattern, other), measure);
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR42mNgAAAAAgAB5SjcZAAAAABJRU5ErkJggg==';

test('旧站台项目默认关闭底纹，忽略旧版底纹开关', () => {
  for (const version of [1, 2, 3]) {
    const oldProject = { ...original, version, texture: true };
    delete oldProject.linePattern;
    const restored = PlatformState.deserialize(JSON.stringify(oldProject));
    assert.equal(restored.linePattern.enabled, false);
    assert.equal(restored.linePattern.source, 'automatic');
    assert.equal(PlatformRender.metrics(restored, measure).patterns, undefined);
  }
});

test('自用站台项目保存纹样、大小、深浅和上传图片，预设可以载回', () => {
  const settings = { enabled: true, source: 'custom', size: 135, opacity: 47, image };
  const state = change(settings);
  assert.equal(original.linePattern.enabled, false);
  assert.deepEqual(state.linePattern, settings);
  assert.deepEqual(PlatformState.deserialize(PlatformState.serialize(state)), state);
  const preset = PlatformPresets.create(state, '自定义底纹');
  assert.deepEqual(PlatformPresets.deserialize(PlatformPresets.serialize([preset]))[0].state, state);
  assert.equal(PlatformState.settings(state, { mode: 'vertical' }).linePattern.image, image);
});

test('底纹设置限制大小、深浅和图片格式，拒绝外部地址、脚本和过大的图片', () => {
  assert.deepEqual(change({ source: 'unknown', size: '180', opacity: NaN }).linePattern,
    original.linePattern);
  assert.deepEqual(change({ source: 'automatic', size: 2, opacity: 140 }).linePattern,
    { enabled: true, source: 'automatic', size: 50, opacity: 100, image: null });
  const header = Buffer.from(image.slice(22), 'base64');
  header.writeUInt32BE(513, 16);
  const wide = 'data:image/png;base64,' + header.toString('base64');
  header.writeUInt32BE(1, 16);
  header.writeUInt32BE(0, 20);
  const empty = 'data:image/png;base64,' + header.toString('base64');
  header.write('abcd', 12);
  const invalidHeader = 'data:image/png;base64,' + header.toString('base64');
  for (const unsafe of ['https://example.test/image.png', 'data:image/svg+xml,<svg/>',
    'data:image/png;base64,AAAA', image + 'a'.repeat(350000), image + '<svg>', image.slice(0, -1),
    wide, empty, invalidHeader, null]) {
    assert.equal(change({ enabled: true, source: 'custom', image: unsafe }).linePattern.enabled, false);
  }
  assert.equal(change({ source: { toString: 'line-1' } }).linePattern.enabled, false);
  assert.equal(change({ source: 'constructor' }).linePattern.enabled, false);
  assert.equal(change({ source: 'custom', image, size: 400, opacity: -1 }).linePattern.size, 200);
  assert.equal(sceneFor({ source: 'custom', image, opacity: 0 }).patterns, undefined);
});

test('旧存档沿用已启用的纹样，开关关闭后保留纹样、图片和调整值', () => {
  const legacy = { source: 'custom', size: 127, opacity: 48, image };
  const restored = PlatformState.deserialize(JSON.stringify({ ...original, linePattern: legacy }));
  assert.deepEqual(restored.linePattern, { ...legacy, enabled: true });
  const hidden = change({ ...restored.linePattern, enabled: false });
  assert.equal(PlatformRender.metrics(hidden, measure).patterns, undefined);
  const preset = PlatformPresets.create(hidden, '已关闭的底纹');
  assert.deepEqual(preset.state.linePattern, { ...legacy, enabled: false });
  const enabled = change({ ...preset.state.linePattern, enabled: true });
  assert.equal(PlatformRender.metrics(enabled, measure).patterns.image, image);
  const oldOff = change({ ...legacy, source: 'off' });
  assert.deepEqual(oldOff.linePattern, { ...legacy, source: 'automatic', enabled: false });
});

test('自动匹配重庆线路，未知线路留纯色，手动选择可跨城市', () => {
  for (const line of ['0', '1', '2', '3', '4', '5', '6', '9', '10', '环线', ' １号线 ']) {
    assert.ok(sceneFor({ source: 'automatic' }, { line, city: 'chongqing' }).patterns, line);
  }
  for (const line of ['7', '18', '自定线路', '1-alternate', '']) {
    assert.equal(sceneFor({ source: 'automatic' }, { line, city: 'chongqing' }).patterns, undefined, line);
  }
  assert.equal(sceneFor({ source: 'automatic' }, { line: '1', city: 'shanghai' }).patterns, undefined);
  const normal = sceneFor({ source: 'line-1' }, { city: 'shanghai' }).patterns;
  const alternate = sceneFor({ source: 'line-1-alternate' }, { city: 'shanghai' }).patterns;
  assert.equal(normal.design.shapes, alternate.design.shapes);
  assert.equal(change({ source: 'line-1-alternate' }).linePattern.source, 'line-1');
});

test('底纹跟随色带尺寸和方向，本站吊板终到时保持纯灰', () => {
  for (const mode of ['route', 'station', 'vertical']) {
    for (const direction of [-1, 1]) {
      const variants = mode === 'vertical' ? ['left', 'right', 'double'] : ['left'];
      for (const verticalVariant of variants) {
        const options = { mode, direction, verticalVariant, color: '#123456' };
        const base = sceneFor({ source: 'off' }, options);
        const normal = sceneFor({ source: 'line-10', size: 100, opacity: 40 }, options);
        const enlarged = sceneFor({ source: 'line-10', size: 150 }, options);
        assert.deepEqual(normal.nodes, base.nodes);
        assert.deepEqual(normal.elements, base.elements);
        assert.equal(normal.patterns.color, '#123456');
        assert.equal(normal.patterns.opacity, 0.4);
        for (const [index, size] of Object.entries(normal.patterns.sizes)) {
          assert.ok(size > 0);
          assert.ok(Math.abs(enlarged.patterns.sizes[index] / size - 1.5) < 1e-10);
          assert.equal(normal.nodes[index].attrs.fill, '#123456');
          assert.match(normal.nodes[index].attrs['data-role'],
            /^(active-line(-core)?|vertical-(active-bar|tail|current-band))$/);
        }
        const terminal = original.stations.at(direction === 1 ? -1 : 0);
        const end = sceneFor({ source: 'line-10' }, { ...options, currentId: terminal.id });
        if (mode === 'station') assert.equal(end.patterns, undefined);
        else assert.ok(end.patterns);
      }
    }
  }
});

test('各线路使用新的默认底纹大小和深浅，仍可在此基础上调整', () => {
  const expected = {
    'line-0': 1.35 * 575 / 1724, 'line-1': 256 / 647, 'line-1-alternate': 256 / 647,
    'line-2': 2.5 * 80.5 / 647, 'line-3': 2 * 128.6 / 647, 'line-4': 2 * 92.1 / 647,
    'line-5': 161.5 / 647, 'line-6': 2.5 * 185.59 / 647, 'line-9': 3 * 146.5 / 647, 'line-10': 0.9 * 3 * 143 / 647,
  };
  const color = {
    'line-1': '#7c8fa1', 'line-1-alternate': '#7c8fa1', 'line-5': '#7c8fa1',
    'line-9': '#405c77', 'line-10': '#2a4967',
  };
  for (const [source, ratio] of Object.entries(expected)) {
    const scene = sceneFor({ source }, { color: '#123456' });
    const thickness = scene.nodes.find(node => node.attrs['data-role'] === 'passed-line').attrs.height;
    assert.equal(scene.patterns.inkColor, color[source] || '#597088', source);
    assert.ok(Object.values(scene.patterns.sizes).every(height => Math.abs(height - ratio * thickness) < 1e-8), source);
  }
  const lighter = sceneFor({ source: 'line-2', opacity: 40 }, { color: '#123456' });
  assert.equal(lighter.patterns.inkColor, '#33506e');
  const adjusted = sceneFor({ source: 'automatic', size: 200, opacity: 50 }, { color: '#000000', city: 'chongqing', line: '10' });
  assert.equal(adjusted.patterns.inkColor, '#0f0f0f');
  const thickness = adjusted.nodes.find(node => node.attrs['data-role'] === 'passed-line').attrs.height;
  assert.ok(Object.values(adjusted.patterns.sizes).every(height => Math.abs(height - thickness * expected['line-10'] * 2) < 1e-8));
});

test('一号线只保留原另一版纹样，自动匹配及旧存档都使用两倍默认大小', () => {
  const source = sceneFor({ source: 'line-1' }, {});
  const automatic = sceneFor({ source: 'automatic' }, { city: 'chongqing', line: '1号线' });
  assert.equal(source.patterns.design.width, 82);
  assert.equal(source.patterns.design.height, 82);
  assert.equal(automatic.patterns.design, source.patterns.design);
  assert.equal(source.patterns.design.repeat, 256 / 647);
  const half = sceneFor({ source: 'line-1-alternate', size: 50 }, {});
  assert.equal(Object.values(half.patterns.sizes)[0] * 2, Object.values(source.patterns.sizes)[0]);
});

test('纵向三种版式的顶栏保持纯色，密集站点和换向时只在线路上铺底纹', () => {
  const stations = Array.from({ length: 120 }, (_, index) => ({
    id: 'station-' + index, code: String(index + 1), zh: '新站点', en: 'New Station', transfers: [],
  }));
  for (const verticalVariant of ['left', 'right', 'double']) {
    for (const direction of [-1, 1]) {
      const scene = sceneFor({ source: 'line-10' }, {
        mode: 'vertical', verticalVariant, direction, verticalSwapped: direction === 1,
        stations, currentId: stations[60].id,
      });
      const index = scene.nodes.findIndex(node => node.attrs['data-role'] === 'vertical-header');
      assert.equal(scene.nodes[index].attrs.width, scene.width);
      assert.equal(index in scene.patterns.sizes, false);
      assert.ok(scene.nodes.some((node, index) =>
        node.attrs['data-role'] === 'vertical-active-bar' && index in scene.patterns.sizes));
      assert.equal(scene.nodes.some((node, index) =>
        node.attrs['data-role'] === 'vertical-bar' && index in scene.patterns.sizes), false);
    }
  }
});

test('六号线底纹采用附图的错列周期，既有斜椭圆，也有成带的圆点', () => {
  const { design } = sceneFor({ source: 'line-6' }, {}).patterns;
  assert.equal(design.width, 89.42);
  assert.equal(design.height, 185.59);
  assert.equal(design.transform, 'matrix(1 -0.00204 -0.03552 1 0 0)');
  const shapes = Array.from(design.shapes.matchAll(/ry="([\d.]+)"/g), match => Number(match[1]));
  assert.ok(shapes.filter(height => height < 8).length >= 5);
  assert.ok(shapes.filter(height => height > 12).length >= 12);
});

test('自定义图片保持来源，缩放与透明度和预设底纹使用相同设置', () => {
  const scene = sceneFor({ source: 'custom', image, size: 50, opacity: 100 });
  assert.equal(scene.patterns.image, image);
  assert.equal(scene.patterns.opacity, 1);
  assert.equal(scene.patterns.design, undefined);
});
