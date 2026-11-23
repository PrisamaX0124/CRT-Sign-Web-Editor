import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const context = {};
for (const name of ['core', 'state', 'presets']) {
  const filename = fileURLToPath(new URL('../js/' + name + '.js', import.meta.url));
  runInNewContext(readFileSync(filename, 'utf8'), context, { filename });
}
const state = context.SignState;

function sample() {
  const sign = state.createSign();
  const first = sign.rows[0].id;
  const board = state.updateSignSettings(sign, {
    widthMode: 'dynamic', width: 1280, rowHeight: 256, aspectLocked: true,
    backgroundColor: '#123456', frameWidth: 9, frameColor: '#987654',
  });
  const colored = state.updateRowSettings(board, first, { backgroundColor: '#336699' });
  const withElement = state.addElement(colored, first, state.createElement('exit', { centralBg: '#FF6600' }));
  return state.addRow(withElement);
}

test('整牌预设随项目文件保存，应用时恢复样式与全部行并保留本项目的预设', () => {
  const sign = sample();
  const project = state.savePreset(sign, '整牌模板');
  const preset = project.presets[0];
  assert.equal(preset.kind, 'board');
  assert.equal(Object.hasOwn(preset.board, 'presets'), false);
  assert.equal(sign.presets.length, 0);
  const roundTrip = state.deserializeSign(state.serializeSign(project));
  assert.equal(roundTrip.presets[0].name, '整牌模板');
  const changed = state.updateSignSettings(state.clearSign(roundTrip), { aspectLocked: false, width: 600, rowHeight: 140, frameWidth: 0 });
  const restored = state.applyPreset(changed, preset.id);
  for (const key of ['widthMode', 'width', 'rowHeight', 'aspectLocked', 'backgroundColor', 'frameWidth', 'frameColor']) {
    assert.equal(restored[key], sign[key], key);
  }
  assert.equal(restored.rows.length, 2);
  assert.equal(restored.rows[0].backgroundColor, '#336699');
  assert.equal(restored.rows[0].elements[0].props.centralBg, '#FF6600');
  assert.notEqual(restored.rows[0].id, sign.rows[0].id);
  assert.notEqual(restored.rows[0].elements[0].id, sign.rows[0].elements[0].id);
  assert.equal(restored.presets, roundTrip.presets);
  assert.equal(state.removePreset(restored, preset.id).presets.length, 0);
});

test('行预设能添加新行或填入空行，并套用原牌面设置', () => {
  const sign = sample();
  const project = state.savePreset(sign, '仅一行', sign.rows[0].id);
  const preset = project.presets[0];
  assert.equal(preset.kind, 'row');
  assert.equal(preset.board.rows.length, 1);
  const changed = { ...project, width: 3840, rowHeight: 100, frameWidth: 0, backgroundColor: '#FFFFFF' };
  assert.equal(state.applyPreset(changed, preset.id, changed.rows[0].id), changed);
  const filled = state.applyPreset(changed, preset.id, changed.rows[1].id);
  assert.equal(filled.rows[1].id, changed.rows[1].id);
  assert.equal(filled.rows[1].backgroundColor, '#336699');
  assert.equal(filled.width, sign.width);
  assert.equal(filled.frameWidth, 9);
  assert.equal(filled.rows[0], changed.rows[0]);
  const appended = state.applyPreset(filled, preset.id);
  assert.equal(appended.rows.length, 3);
  assert.notEqual(appended.rows[1].elements[0].id, appended.rows[2].elements[0].id);
  assert.equal(state.savePreset(sign, '空行', sign.rows[1].id), sign);
});

test('旧版行预设保留内容，应用时沿用当前牌面和目标行颜色', () => {
  const sign = sample();
  const element = sign.rows[0].elements[0];
  const imported = context.SignPresets.readLegacy(JSON.stringify([{ id: 'legacy-row', name: '旧预设', elements: [element] }]));
  assert.equal(imported[0].kind, 'legacy-row');
  const project = { ...sign, presets: imported };
  const reopened = state.deserializeSign(state.serializeSign(project));
  const result = state.applyPreset(reopened, imported[0].id, reopened.rows[1].id);
  assert.equal(result.rows[1].elements[0].props.centralBg, '#FF6600');
  assert.equal(result.rows[1].backgroundColor, null);
  assert.equal(result.backgroundColor, sign.backgroundColor);
  assert.equal(result.frameWidth, sign.frameWidth);
});

test('项目文件会检查预设内容，重复标识会重新分配，预设中不再嵌套预设', () => {
  const project = state.savePreset(sample(), '主牌');
  const preset = project.presets[0];
  const restored = state.deserializeSign({ ...project, presets: [preset, { ...preset, board: project }] });
  assert.equal(restored.presets.length, 2);
  assert.notEqual(restored.presets[0].id, restored.presets[1].id);
  assert.equal(Object.hasOwn(restored.presets[1].board, 'presets'), false);
  assert.throws(() => state.deserializeSign({ ...project, presets: {} }), /预设列表/);
  assert.throws(() => state.deserializeSign({ ...project, presets: [{ ...preset, kind: 'row' }] }), /第 1 个预设/);
  assert.throws(() => state.deserializeSign({ ...project, presets: [{ ...preset, board: null }] }), /第 1 个预设/);
});

test('旧预设迁入后再次检查不会重复添加，无有效旧内容时不修改项目', () => {
  let source = null;
  context.localStorage = { getItem: () => source };
  const sign = sample();
  const presets = context.SignPresets;
  assert.equal(presets.migrateLegacy(sign), null);
  source = JSON.stringify([{ id: 'legacy', name: '旧条目', elements: sign.rows[0].elements }]);
  const migrated = presets.migrateLegacy(sign);
  assert.equal(migrated.presets.length, 1);
  assert.equal(presets.migrateLegacy(migrated), migrated);
  assert.equal(sign.presets.length, 0);
  assert.throws(() => presets.readLegacy('{}'), /旧版预设列表/);
  assert.throws(() => presets.readLegacy('[{"name":"空白","elements":[]}]'), /没有可读取的行/);
});
