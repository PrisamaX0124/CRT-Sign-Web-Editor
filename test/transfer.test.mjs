import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const context = { atob };
for (const path of [
  'js/core.js', 'js/icons.js', 'js/directions.js', 'assets/platform-patterns.js', 'js/platform/patterns.js',
  'js/transfer/state.js', 'js/transfer/render.js',
]) {
  const filename = fileURLToPath(new URL('../' + path, import.meta.url));
  runInNewContext(readFileSync(filename, 'utf8'), context, { filename });
}
const { TransferState: state, TransferRender: render } = context;
const measure = {
  ink(text, family, weight, size) {
    return { abl: -size * 0.08, abr: [...text].length * size * 0.75 };
  },
  ascent(text, family, weight, size) { return size * 0.78; },
  descent(text, family, weight, size) { return size * 0.14; },
};
const initial = state.create();
const content = (scene, role) => scene.nodes.filter(node => node.attributes['data-role'] === role);
const values = nodes => Array.from(nodes, node => node.text);
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

test('两种版式各自保留线路、箭头、分组、颜色、尺寸和底纹', () => {
  const guidance = state.changeLine(initial, 'first', { name: '12', color: '#123', linePattern: { source: 'line-6' } });
  const changed = state.changeDirection(state.settings(guidance, { city: 'beijing', width: 480 }), 'upper', 'right-up');
  const separate = state.settings(changed, { mode: 'separate' });
  assert.deepEqual(state.board(separate), initial.boards.separate);
  const separateEdit = state.settings(separate, { arrangement: '1+2' });
  const returned = state.settings(separateEdit, { mode: 'guidance' });
  assert.deepEqual(state.board(returned), state.board(changed));
  assert.equal(state.board(returned).width, 480);
  assert.equal(state.board(returned).directions.upper, 'right-up');
  assert.equal(state.board(returned).lines[0].linePattern.source, 'line-6');
  assert.equal(initial.boards.guidance.lines[0].name, '1');
  assert.equal(state.changeLine(initial, 'missing', { name: '5' }), initial);
  assert.equal(state.changeDirection(initial, 'lower', 'left'), initial);
  assert.equal(state.changeDirection(initial, 'upper', ['left']), initial);
  assert.equal(state.settings(initial, { mode: 'unknown' }), initial);
});

test('线路名可匹配城市配色，改色后继续编辑名称可重新按线路取色', () => {
  const customized = state.changeLine(initial, 'first', { color: '#abcdef' });
  assert.equal(state.board(customized).lines[0].color, '#ABCDEF');
  const renamed = state.changeLine(customized, 'first', { name: ' ６号线 ' });
  assert.equal(state.board(renamed).lines[0].color, context.SignCore.lineColorFor('6', 'chongqing').bg);
  const unknown = state.changeLine(renamed, 'first', { name: '自定义线路' });
  assert.equal(state.board(unknown).lines[0].color, state.board(renamed).lines[0].color);
  const changedCity = state.settings(renamed, { city: 'beijing' });
  assert.equal(state.board(changedCity).lines[0].color, context.SignCore.lineColorFor('6', 'beijing').bg);
  assert.equal(state.board(renamed).city, 'chongqing');
});

test('新版存档往返保留两个版式，异常尺寸、分组、箭头和底纹恢复可用值', () => {
  let changed = state.settings(initial, { mode: 'separate', arrangement: '1+2', width: 99999 });
  changed = state.changeLine(changed, 'third', { linePattern: { source: 'line-2', size: 215, opacity: -5 } });
  assert.equal(state.board(changed).width, 6144);
  assert.equal(state.board(changed).lines[2].linePattern.size, 200);
  assert.equal(state.board(changed).lines[2].linePattern.opacity, 0);
  assert.equal(state.serialize(state.deserialize(state.serialize(changed))), state.serialize(changed));
  const repaired = state.deserialize(JSON.stringify({ ...initial, mode: ['separate'], boards: { guidance: {
    arrangement: '1+2', width: 1, city: 'unknown', directions: { upper: ['down'] },
    lines: [null, { name: 'a'.repeat(99), color: 'red' }],
  } } }));
  const board = state.board(repaired);
  assert.equal(board.width, 192);
  assert.equal(board.city, 'chongqing');
  assert.equal(repaired.mode, 'guidance');
  assert.equal(board.arrangement, '2');
  assert.equal(board.directions.upper, 'up');
  assert.equal(board.lines[0].name, '1');
  assert.equal(board.lines[1].name.length, 40);
  for (const invalid of ['null', '{}', '{"kind":"transfer-sign","version":3}', '损坏']) {
    assert.throws(() => state.deserialize(invalid));
  }
});

test('旧存档的线路和共用底纹带到两个版式，之后可以逐条改动', () => {
  const legacy = {
    kind: 'transfer-sign', version: 1, mode: 'separate', lineCount: 1, width: 600, city: 'chongqing',
    direction: 'left-up', lines: [{ name: '5', color: '#123456', direction: 'up' }, { name: '9', direction: 'down' }],
    linePattern: { enabled: true, source: 'custom', size: 127, opacity: 48, image },
  };
  const migrated = state.deserialize(JSON.stringify(legacy));
  assert.equal(migrated.mode, 'separate');
  assert.equal(state.board(migrated).arrangement, '1');
  assert.equal(migrated.boards.guidance.arrangement, '1');
  assert.equal(migrated.boards.guidance.directions.upper, 'left-up');
  assert.equal(state.board(migrated).directions.upper, 'up');
  assert.equal(state.board(migrated).directions.lower, 'down');
  assert.equal(state.board(migrated).width, 600);
  assert.equal(state.board(migrated).lines[0].color, '#123456');
  assert.equal(migrated.boards.guidance.lines[1].linePattern.image, image);
  const edited = state.changeLine(migrated, 'second', { linePattern: { source: 'line-2' } });
  assert.equal(state.board(edited).lines[0].linePattern.source, 'custom');
  assert.equal(migrated.boards.guidance.lines[1].linePattern.opacity, 48);
  assert.equal(state.board(edited).lines[2].linePattern.enabled, false);
});

test('版式 A 双线路共用箭头，编号用导向标识的常规字重，改单线路可恢复第二条', () => {
  const project = state.changeLine(initial, 'second', { name: '9', color: '#123' });
  const scene = render.layout(project, measure);
  const bands = content(scene, 'line-band');
  assert.equal(scene.width, 768);
  assert.equal(scene.height, 1024);
  assert.equal(content(scene, 'direction-arrow').length, 1);
  assert.deepEqual(values(content(scene, 'line-number')), ['1/9']);
  assert.ok(content(scene, 'line-number').every(node => node.attributes['font-family'] === context.SignCore.FONT_NUM &&
    node.attributes['font-weight'] === 400));
  assert.equal(scene.usedFonts.num400, true);
  assert.equal(bands[1].attributes.fill, '#112233');
  assert.ok(bands[0].attributes.y + bands[0].attributes.height < bands[1].attributes.y);
  const single = state.settings(project, { arrangement: '1' });
  assert.equal(content(render.layout(single, measure), 'line-band').length, 1);
  assert.equal(state.board(state.settings(single, { arrangement: '2' })).lines[1].name, '9');
});

test('版式 B 的双线路、单线路和两种三线路分组各有正确的文字、色带和箭头', () => {
  const separate = state.settings(initial, { mode: 'separate' });
  for (const [arrangement, labels, groups] of [
    ['1', ['1'], ['upper']],
    ['1+1', ['1', '10'], ['upper', 'lower']],
    ['1+2', ['1', '10/6'], ['upper', 'lower', 'lower']],
    ['2+1', ['1/10', '6'], ['upper', 'upper', 'lower']],
  ]) {
    const project = state.settings(separate, { arrangement });
    const scene = render.layout(project, measure);
    const lines = content(scene, 'line-band').map(node => node.attributes);
    const numbers = content(scene, 'line-number');
    const arrows = content(scene, 'direction-arrow');
    assert.deepEqual(values(numbers), labels);
    assert.deepEqual(Array.from(lines, attributes => attributes['data-group']), groups);
    assert.equal(scene.elements.filter(element => element.kind === 'line').length, groups.length);
    assert.equal(scene.elements.filter(element => element.kind === 'label').length, labels.length);
    assert.deepEqual(Array.from(arrows, arrow => arrow.attributes['data-direction']), labels.length === 2 ? ['left', 'right'] : ['left']);
    if (groups.length < 3) assert.ok(numbers[0].bounds.top + numbers[0].bounds.height < lines[0].y);
    assert.ok(arrows[0].bounds.left < numbers[0].bounds.left);
    if (labels.length === 2) {
      const last = lines.at(-1);
      assert.ok(numbers[1].bounds.top > last.y + last.height);
      assert.ok(arrows[1].bounds.left > numbers[1].bounds.left + numbers[1].bounds.width);
      assert.equal(numbers[0].attributes['font-size'], numbers[1].attributes['font-size']);
    }
    if (groups.length === 3) {
      const upperBands = lines.filter(line => line['data-group'] === 'upper');
      const lowerBands = lines.filter(line => line['data-group'] === 'lower');
      for (const [index, bands] of [upperBands, lowerBands].entries()) {
        const last = bands.at(-1);
        for (const item of [numbers[index], arrows[index]]) {
          assert.ok(item.bounds.top > last.y + last.height, '箭头和文字应在本组色带下方');
          const nextBand = index === 0 ? lowerBands[0].y : 1024;
          assert.ok(item.bounds.top + item.bounds.height < nextBand, '箭头和文字不可伸进下一组');
        }
      }
      const reversed = state.changeDirection(state.changeDirection(project, 'upper', 'right'), 'lower', 'left');
      const moved = content(render.layout(reversed, measure), 'direction-arrow');
      assert.deepEqual(moved.map(node => node.bounds.left), arrows.map(node => node.bounds.left));
    }
  }
});

test('三种双组样式可逐组左对齐、居中或右对齐，色带和另一组位置保持原样', () => {
  for (const arrangement of ['1+1', '2+1', '1+2']) {
    const project = state.settings(initial, { mode: 'separate', arrangement });
    const original = render.layout(project, measure);
    for (const group of ['upper', 'lower']) {
      for (const alignment of ['left', 'center', 'right']) {
        const edited = state.changeAlignment(project, group, alignment);
        const scene = render.layout(edited, measure);
        const parts = scene.elements.filter(element => element.identifier === group);
        const left = Math.min(...parts.map(({ bounds }) => bounds.left));
        const right = Math.max(...parts.map(({ bounds }) => bounds.left + bounds.width));
        assert.ok(Math.abs(alignment === 'left' ? left - 52 : alignment === 'right' ? right - 716 : (left + right) / 2 - 384) < 1e-8);
        assert.deepEqual(content(scene, 'line-band'), content(original, 'line-band'));
        assert.deepEqual(scene.elements.filter(element => element.identifier !== group),
          original.elements.filter(element => element.identifier !== group));
      }
    }
  }
});

test('对齐随样式和分组独立保存，旧存档沿用原有位置', () => {
  const separate = state.settings(initial, { mode: 'separate' });
  const older = JSON.parse(state.serialize(separate));
  delete older.boards.separate.alignments;
  const restored = state.deserialize(JSON.stringify(older));
  const double = state.changeAlignment(restored, 'upper', 'right');
  const triple = state.settings(double, { arrangement: '1+2' });
  assert.deepEqual(Array.from(state.groups(triple), group => group.alignment), ['left', 'right']);
  const edited = state.changeAlignment(triple, 'lower', 'center');
  const saved = state.deserialize(state.serialize(edited));
  assert.deepEqual(Array.from(state.groups(saved), group => group.alignment), ['left', 'center']);
  assert.deepEqual(Array.from(state.groups(state.settings(saved, { arrangement: '1+1' })), group => group.alignment),
    ['right', 'center']);
  assert.equal(state.changeAlignment(saved, 'lower', ['left']), saved);
  assert.equal(state.changeAlignment(saved, 'third', 'left'), saved);
  assert.equal(state.changeAlignment(initial, 'upper', 'right'), initial);
  older.boards.separate.alignments = { '1+1': { upper: 'outside', lower: 'left' } };
  assert.deepEqual(Array.from(state.groups(state.deserialize(JSON.stringify(older))), group => group.alignment), ['center', 'left']);
});

test('三种样式的箭头可逐组置左或置右，箭头方向、整组对齐和另一组不受影响', () => {
  for (const arrangement of ['1+1', '1+2', '2+1']) {
    for (const group of ['upper', 'lower']) {
      const project = state.changeAlignment(state.settings(initial, { mode: 'separate', arrangement }), group, 'right');
      const original = render.layout(project, measure);
      for (const position of ['left', 'right']) {
        const changed = state.changeArrowPosition(project, group, position);
        const edited = state.changeDirection(changed, group, 'left-up');
        const scene = render.layout(edited, measure);
        const arrow = scene.elements.find(element => element.key === 'arrow:' + group).bounds;
        const label = scene.elements.find(element => element.key === 'label:' + group).bounds;
        assert.ok(position === 'left' ? arrow.left + arrow.width < label.left : label.left + label.width < arrow.left);
        assert.ok(Math.abs(Math.max(arrow.left + arrow.width, label.left + label.width) - 716) < 1e-8);
        assert.equal(state.groups(edited).find(item => item.identifier === group).direction, 'left-up');
        assert.deepEqual(scene.elements.filter(element => element.identifier !== group),
          original.elements.filter(element => element.identifier !== group));
      }
    }
  }
});

test('箭头位置随样式保存，旧存档的双线箭头依据原方向恢复位置', () => {
  const separate = state.settings(initial, { mode: 'separate' });
  const older = JSON.parse(state.serialize(separate));
  delete older.boards.separate.arrowPositions;
  older.boards.separate.directions = { upper: 'right-up', lower: 'left' };
  const restored = state.deserialize(JSON.stringify(older));
  assert.deepEqual(Array.from(state.groups(restored), group => group.arrowPosition), ['right', 'left']);
  const triple = state.settings(restored, { arrangement: '1+2' });
  const edited = state.changeArrowPosition(triple, 'upper', 'right');
  const saved = state.deserialize(state.serialize(edited));
  assert.deepEqual(Array.from(state.groups(saved), group => group.arrowPosition), ['right', 'right']);
  assert.deepEqual(Array.from(state.groups(state.settings(saved, { arrangement: '2+1' })), group => group.arrowPosition), ['left', 'right']);
  assert.equal(state.changeArrowPosition(saved, 'lower', 'center'), saved);
  assert.equal(state.changeArrowPosition(saved, 'third', 'left'), saved);
  assert.equal(state.changeArrowPosition(initial, 'upper', 'right'), initial);
});

test('右对齐时每列双语文字的墨区右沿对齐，左对齐时各自的左沿对齐', () => {
  const project = state.settings(initial, { mode: 'separate', arrangement: '2+1' });
  for (const alignment of ['right', 'left']) {
    const scene = render.layout(state.changeAlignment(project, 'upper', alignment), measure);
    const textNodes = scene.nodes.filter(node => node.element?.key === 'label:upper');
    const chinese = textNodes.filter(node => node.attributes['data-role'] === 'label-chinese');
    const english = textNodes.filter(node => node.attributes['data-role'] === 'label-english');
    const edge = node => node.bounds.left + (alignment === 'right' ? node.bounds.width : 0);
    assert.equal(chinese.length, 2);
    assert.ok(chinese.every((node, index) => Math.abs(edge(node) - edge(english[index])) < 1e-8));
  }
});

test('双语文字的中文墨区顶端与数字齐平，英文使用同一基线并留足行距', () => {
  for (const [mode, arrangement] of [['guidance', '2'], ['separate', '1+1'], ['separate', '1+2'], ['separate', '2+1']]) {
    const scene = render.layout(state.settings(initial, { mode, arrangement }), measure);
    for (const number of content(scene, 'line-number')) {
      const texts = scene.nodes.filter(node => node.element?.key === number.element.key);
      const chinese = texts.filter(node => node.attributes['data-role'] === 'label-chinese');
      const english = texts.filter(node => node.attributes['data-role'] === 'label-english');
      assert.ok(chinese.every(node => node.bounds.top === number.bounds.top));
      assert.equal(english[0].attributes.y, english[1].attributes.y);
      const chineseBottom = Math.max(...chinese.map(node => node.bounds.top + node.bounds.height));
      assert.ok(english.every(node => node.bounds.top - chineseBottom >= chinese[0].attributes['font-size'] * 0.18));
    }
  }
});

test('导向标识的十二种箭头与较长的线路名称在两种版式内都能完整显示', () => {
  const icons = Object.entries(context.SignIcons.ALL).filter(([, icon]) => icon.cat === 'arrows');
  assert.equal(Object.keys(state.directions).length, icons.length);
  for (const mode of ['guidance', 'separate']) {
    const project = state.changeLine(state.settings(initial, { mode }), 'first', { name: '环线'.repeat(20) });
    for (const [name, icon] of icons) {
      const direction = name.slice('arrow_'.length).replaceAll('_', '-');
      const edited = state.changeDirection(project, 'upper', direction);
      const scene = render.layout(edited, measure);
      const arrow = content(scene, 'direction-arrow')[0];
      assert.equal(arrow.attributes['data-direction'], direction);
      assert.equal(arrow.attributes.viewBox, icon.vb);
      assert.equal(arrow.markup.match(/d="([^"]+)"/)[1], icon.body.match(/d="([^"]+)"/)[1]);
      assert.equal(content(scene, 'line-name').length, 1);
      for (const { bounds } of scene.elements) {
        assert.ok(bounds.left >= 0 && bounds.top >= 0);
        assert.ok(bounds.left + bounds.width <= 768 && bounds.top + bounds.height <= 1024);
      }
    }
  }
});

test('转弯箭头能按组保存，旧有直向箭头的设置保持原方向', () => {
  const guidance = state.changeDirection(initial, 'upper', 'ahead-right');
  let project = state.settings(guidance, { mode: 'separate', arrangement: '1+2' });
  project = state.changeDirection(state.changeDirection(project, 'upper', 'left-down'), 'lower', 'back-left');
  const restored = state.deserialize(state.serialize(project));
  assert.equal(restored.boards.guidance.directions.upper, 'ahead-right');
  assert.deepEqual(Array.from(content(render.layout(restored, measure), 'direction-arrow'),
    node => node.attributes['data-direction']), ['left-down', 'back-left']);
});

test('清空线路名称时保留换乘提示，名称与编号混用时补全号线', () => {
  const empty = state.changeLine(initial, 'first', { name: '' });
  const single = render.layout(state.settings(empty, { arrangement: '1' }), measure);
  assert.deepEqual(values(content(single, 'label-chinese')), ['换乘']);
  assert.deepEqual(values(content(single, 'label-english')), ['Transfer']);
  assert.equal(content(single, 'line-name').length, 0);
  assert.equal(single.usedFonts.num400, false);
  const named = render.layout(state.changeLine(initial, 'first', { name: '环线' }), measure);
  assert.deepEqual(values(content(named, 'line-name')), ['环线 / 10号线']);
});

test('三条色带能同时使用自动纹样、手动纹样和自定义图片，隐藏后保留各自设置', () => {
  let project = state.settings(initial, { mode: 'separate', arrangement: '1+2' });
  assert.equal(render.layout(project, measure).patterns.length, 0);
  for (const [identifier, linePattern] of [
    ['first', { source: 'automatic' }],
    ['second', { source: 'line-6', opacity: 45 }],
    ['third', { source: 'custom', image, size: 150, opacity: 44 }],
  ]) project = state.changeLine(project, identifier, { linePattern });
  const [automatic, manual, custom] = render.layout(project, measure).patterns;
  assert.equal(automatic.design.name, '1号线');
  assert.equal(Object.values(automatic.sizes)[0], 110 * 256 / 647);
  assert.equal(manual.design.name, '6号线');
  assert.notEqual(automatic.inkColor, manual.inkColor);
  assert.equal(custom.image, image);
  assert.equal(custom.opacity, 0.44);
  assert.ok(Object.values(custom.sizes)[0] > 100);
  assert.equal(render.layout(state.settings(project, { arrangement: '1+1' }), measure).patterns.length, 2);
  assert.equal(render.layout(state.settings(project, { city: 'beijing' }), measure).patterns.length, 2);
  assert.equal(state.board(project).lines[2].linePattern.image, image);
  const transparent = state.changeLine(project, 'second', { linePattern: { source: 'line-6', opacity: 0 } });
  assert.equal(render.layout(transparent, measure).patterns.length, 2);
});
