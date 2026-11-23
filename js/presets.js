(function (global) {
  'use strict';

  const state = global.SignState;
  const legacyKey = 'public-sign-presets';

  function list() {
    return global.App.state?.presets || [];
  }

  function get(identifier) {
    return list().find(preset => preset.id === identifier);
  }

  function save(name, rowId) {
    return global.App.update(project => state.savePreset(project, name, rowId));
  }

  async function promptSave(rowId) {
    const app = global.App;
    const activation = app.projects?.activation;
    if (rowId && !app.state.rows.find(row => row.id === rowId)?.elements.length) {
      global.SignUI.toast('空行不能保存为预设', 'warning');
      return;
    }
    const name = await global.SignUI.promptDialog(rowId ? '为这一行起个名字。' : '为当前标识牌起个名字。',
      '保存到本项目预设', '', '如：站台方向牌');
    if (name === null || activation !== app.projects?.activation) return;
    if (!name.trim()) { global.SignUI.toast('请填写预设名称', 'warning'); return; }
    if (save(name, rowId)) global.SignUI.toast('已保存预设「' + name.trim().slice(0, 80) + '」', 'success');
  }

  function remove(identifier) {
    return global.App.update(project => state.removePreset(project, identifier));
  }

  function apply(identifier, rowId) {
    const preset = get(identifier);
    if (!preset) return false;
    return global.App.update(project => state.applyPreset(project, identifier, rowId), null, { replaceProject: preset.kind === 'board' });
  }

  function readLegacy(source) {
    if (!source) return [];
    const records = JSON.parse(source);
    if (!Array.isArray(records)) throw new Error('旧版预设列表有误');
    const { presets, ...board } = state.createSign();
    const valid = records.filter(record => typeof record?.name === 'string' && record.name.trim() &&
      Array.isArray(record.elements) && record.elements.some(element => state.ELEMENT_TYPES.includes(element?.type)));
    if (records.length && !valid.length) throw new Error('旧版预设没有可读取的行');
    return state.deserializePresets(valid.map(record => ({
      id: record.id, name: record.name, kind: 'legacy-row',
      board: { ...board, rows: [state.createRow(record.elements)] },
    })));
  }

  function migrateLegacy(project) {
    const records = readLegacy(global.localStorage.getItem(legacyKey));
    if (!records.length) return null;
    const identifiers = new Set(project.presets.map(preset => preset.id));
    const additions = records.filter(record => !identifiers.has(record.id));
    return additions.length ? { ...project, presets: [...project.presets, ...additions] } : project;
  }

  global.SignPresets = { list, get, save, promptSave, remove, apply, readLegacy, migrateLegacy };
})(typeof window !== 'undefined' ? window : globalThis);
