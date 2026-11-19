import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const managerPath = new URL('../js/projects/manager.js', import.meta.url);
const platformPath = new URL('../js/platform/projects.js', import.meta.url);
function editor() {
  let state = { line: '1', lineName: '一号线', color: '#123456', stations: [{ id: 'station', transfers: [1, 2] }], adjustments: { station: { x: 4 } }, linePattern: { image: '底纹' } };
  const records = new Map(), settings = new Map(), events = [];
  let number = 0, fail = false, pause;
  const browser = { setTimeout, clearTimeout, structuredClone, PlatformState: { create: () => structuredClone(state), serialize: JSON.stringify, deserialize: JSON.parse }, SignCore: { uuid: () => 'project-' + ++number } };
  runInNewContext(readFileSync(managerPath, 'utf8'), browser, { filename: fileURLToPath(managerPath) });
  runInNewContext(readFileSync(platformPath, 'utf8'), browser, { filename: fileURLToPath(platformPath) });
  const copy = value => value && structuredClone(value);
  const store = {
    async hasMigration() { return settings.has('migration'); },
    async initialize(legacy) {
      if (fail) throw new Error('空间不足');
      if (legacy && !settings.has('migration')) { records.set(legacy.id, copy(legacy)); settings.set('migration', legacy.id); }
      if (!records.size) { const record = browser.PlatformProjects.record('未命名项目', state); records.set(record.id, record); }
      const current = records.get(settings.get('current')) || [...records.values()][0];
      settings.set('current', current.id); return copy(current);
    },
    async list() { return [...records.values()].map(copy); },
    async read(id) { return copy(records.get(id)); },
    async write(record, expected, select = false) {
      if (pause) { const wait = pause; pause = null; await wait; }
      if (fail) throw new Error('空间不足');
      const previous = records.get(record.id);
      if ((previous?.revision ?? null) !== expected) throw browser.PlatformProjects.conflictError();
      records.set(record.id, copy(record)); if (select) settings.set('current', record.id); return copy(record);
    },
    async select(id, revision) { if (fail) throw new Error('写入失败'); if (records.get(id)?.revision !== revision) throw browser.PlatformProjects.conflictError(); settings.set('current', id); },
    async remove(id, revision, replacement) { if (fail) throw new Error('删除失败'); if (records.get(id)?.revision !== revision) throw browser.PlatformProjects.conflictError(); records.delete(id); if (replacement) { records.set(replacement.id, copy(replacement)); settings.set('current', replacement.id); } },
  };
  const manager = browser.PlatformProjects.createManager({ store, getState: () => state, applyState: value => { state = value; events.push('open'); }, onStatus: (...value) => events.push(value), onCurrent() {}, delay: 10000 });
  return { manager, store, records, settings, events, browser, edit(name) { state = { ...state, lineName: name }; manager.schedule(); }, get state() { return state; }, set fail(value) { fail = value; }, hold() { let finish; pause = new Promise(resolve => { finish = resolve; }); return finish; } };
}

test('旧存档迁移只创建一份项目，工程内容和旧原文保持完整', async () => {
  const app = editor(), original = JSON.stringify(app.state);
  await app.manager.initialize(original);
  assert.equal(app.records.size, 1);
  assert.deepEqual(JSON.parse([...app.records.values()][0].data), JSON.parse(original));
  await app.manager.initialize(original);
  assert.equal(app.records.size, 1);
});

test('迁移和保存失败时保留当前内容，禁止切换', async () => {
  const app = editor(); app.fail = true;
  await assert.rejects(app.manager.initialize(JSON.stringify(app.state)), /空间不足/);
  assert.equal(app.records.size, 0);
  app.fail = false; await app.manager.initialize();
  const first = app.manager.current.id;
  await app.manager.create('第二份'); const second = app.manager.current.id;
  app.edit('未保存'); app.fail = true;
  await assert.rejects(app.manager.open(first), /空间不足/);
  assert.equal(app.manager.current.id, second);
  assert.equal(app.state.lineName, '未保存');
  app.fail = false; await app.manager.flush();
});

test('连续编辑及排队切换按项目保存，较早写入不会覆盖后来的编辑', async () => {
  const app = editor(); await app.manager.initialize(); const first = app.manager.current.id;
  await app.manager.create('第二份'); const second = app.manager.current.id;
  app.edit('第一笔'); const finish = app.hold(); const save = app.manager.flush();
  await new Promise(resolve => setImmediate(resolve)); app.edit('最后一笔'); finish();
  await save;
  await Promise.all([app.manager.open(first), app.manager.open(second), app.manager.open(first)]);
  assert.equal(JSON.parse(app.records.get(second).data).lineName, '最后一笔');
  assert.equal(app.manager.current.id, first);
  assert.equal(app.state.lineName, '一号线');
});

test('复制完整工程后独立编辑，重命名、删除和刷新恢复当前项目', async () => {
  const app = editor(); await app.manager.initialize(); const original = app.manager.current;
  await app.manager.duplicate(original.id, '副本'); const duplicate = app.manager.current.id;
  assert.notEqual(duplicate, original.id);
  assert.deepEqual(JSON.parse(app.records.get(duplicate).data), JSON.parse(original.data));
  app.edit('独立修改'); await app.manager.flush();
  assert.equal(JSON.parse(app.records.get(original.id).data).lineName, '一号线');
  await app.manager.rename(duplicate, '改名'); assert.equal(app.manager.current.name, '改名');
  await app.manager.initialize(); assert.equal(app.manager.current.id, duplicate);
  await app.manager.remove(duplicate); assert.equal(app.manager.current.id, original.id);
  await app.manager.remove(original.id); assert.equal(app.records.size, 1);
  assert.notEqual(app.manager.current.id, original.id);
});

test('导入创建新项目，切换清空临时状态通过统一入口执行', async () => {
  const app = editor(); await app.manager.initialize(); const first = app.manager.current.id;
  const imported = { ...app.state, lineName: '导入线路' };
  await app.manager.create('导入', imported);
  assert.equal(app.records.size, 2); assert.notEqual(app.manager.current.id, first);
  assert.equal(app.state.lineName, '导入线路');
  await app.manager.open(first); assert.equal(app.state.lineName, '一号线');
  assert.equal(app.events.filter(value => value === 'open').length, 3);
});

test('同项目其他标签页写入后禁止覆盖，允许把本页修改另存副本', async () => {
  const app = editor(); await app.manager.initialize(); const first = app.manager.current.id;
  app.records.get(first).revision++;
  await assert.rejects(app.manager.check(), /其他窗口/);
  app.edit('本页修改'); await assert.rejects(app.manager.flush(), /其他窗口/);
  await app.manager.duplicate(first, '冲突备份');
  assert.notEqual(app.manager.current.id, first);
  assert.equal(app.state.lineName, '本页修改');
  assert.equal(app.records.get(first).revision, 2);
});

test('损坏的项目不能打开或覆盖，仍可读取原文用于备份', async () => {
  const app = editor(); await app.manager.initialize(); const first = app.manager.current.id;
  app.records.set('broken', { id: 'broken', revision: 1, name: '损坏', data: '{' });
  await assert.rejects(app.manager.open('broken'));
  assert.equal(app.manager.current.id, first);
  assert.equal((await app.store.read('broken')).data, '{');
});

test('已迁移后旧原文损坏也不重复解析；未迁移的损坏原文保持原样', async () => {
  const app = editor(); const original = JSON.stringify(app.state);
  await app.manager.initialize(original);
  await app.manager.initialize('{');
  assert.equal(app.records.size, 1);
  const another = editor(); await assert.rejects(another.manager.initialize('{'));
  assert.equal(another.records.size, 0);
  await another.manager.initialize(); const current = another.manager.current.id;
  await another.manager.initialize('{');
  assert.equal(another.manager.current.id, current);
  assert.equal(another.settings.has('migration'), false);
  assert.match(another.events.at(-1)[1], /旧版自动存档损坏/);
});

test('项目资料损坏时不采用默认资料覆盖原文', async () => {
  const app = editor(); await app.manager.initialize();
  const value = app.manager.current;
  app.records.set('broken', { ...value, id: 'broken', revision: '错误版本' });
  await assert.rejects(app.manager.open('broken'), /资料损坏/);
  assert.equal(app.records.get('broken').data, value.data);
});

test('删除其他项目不改变当前工程，删除失败不改当前标识，最后一份会换成默认工程', async () => {
  const app = editor(); await app.manager.initialize(); const first = app.manager.current.id;
  await app.manager.create('第二份'); const second = app.manager.current.id;
  await app.manager.remove(first); assert.equal(app.manager.current.id, second);
  app.fail = true; await assert.rejects(app.manager.remove(second), /删除失败/);
  assert.equal(app.manager.current.id, second); assert.equal(app.records.size, 1);
  app.fail = false; await app.manager.remove(second); assert.equal(app.records.size, 1);
  assert.notEqual(app.manager.current.id, second);
});

test('名称不能为空；丢失项目及未保存工程不会被切换操作丢弃', async () => {
  const app = editor(); await app.manager.initialize(); const first = app.manager.current.id;
  await assert.rejects(app.manager.rename(first, '   '), /项目名称/);
  await assert.rejects(app.manager.create(''), /项目名称/);
  await assert.rejects(app.manager.open('missing'), /已被删除/);
  await assert.rejects(app.manager.remove('missing'), /已被删除/);
  assert.equal(app.manager.current.id, first);
  const temporary = editor(); temporary.edit('临时修改');
  await assert.rejects(temporary.manager.flush(), /尚未打开/);
});

test('确认重新打开后载入其他窗口的内容，再次编辑可以保存', async () => {
  const app = editor(); await app.manager.initialize(); const first = app.manager.current.id;
  const record = app.records.get(first); record.revision++; record.data = JSON.stringify({ ...app.state, lineName: '其他窗口' });
  await assert.rejects(app.manager.flush(), /其他窗口/);
  await app.manager.reload(); assert.equal(app.state.lineName, '其他窗口');
  app.edit('重新编辑'); await app.manager.flush();
  assert.equal(app.manager.pending, false);
  app.edit('重新编辑'); await app.manager.flush(); assert.equal(app.manager.pending, false);
});

test('共用存储按编辑器选择数据库、默认工程和列表资料，拒绝另一种工程', async () => {
  const { browser } = editor();
  const opened = [];
  browser.SignProjectStore = { open(factory, name, conflict, makeDefault) { opened.push([factory, name, makeDefault()]); } };
  const guidance = browser.SignProjects.createLibrary({
    databaseName: 'guidance-projects',
    legacyKey: 'guidance-legacy',
    legacyName: '旧导向项目',
    createDefault: () => ({ rows: [{ elements: [] }] }),
    serialize: JSON.stringify,
    deserialize: source => {
      const project = JSON.parse(source);
      if (!Array.isArray(project.rows)) throw new Error('请选择导向标识项目');
      return project;
    },
    describe: project => ({ rowCount: project.rows.length }),
  });
  const factory = {};
  browser.PlatformProjects.openStore(factory);
  guidance.openStore(factory);
  assert.equal(opened[0][1], 'public-platform-projects');
  assert.equal(opened[1][1], 'guidance-projects');
  assert.equal(opened[1][2].rowCount, 1);
  assert.equal(opened[1][2].stationCount, undefined);
  assert.equal(guidance.legacyKey, 'guidance-legacy');
  assert.throws(() => guidance.readState(opened[0][2]), /项目内容损坏/);
});
