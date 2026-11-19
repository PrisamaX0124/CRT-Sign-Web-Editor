import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const filename = fileURLToPath(new URL('../js/storage.js', import.meta.url));
const source = readFileSync(filename, 'utf8');

function createProjectFiles(deserialize) {
  const browser = { Blob };
  runInNewContext(source, browser, { filename });
  const parse = deserialize || runInNewContext('JSON.parse', browser);
  const storage = browser.SignStorage;
  const input = new EventTarget();
  const projects = [];
  const notices = [];
  const notice = (message, type) => notices.push([message, type]);
  storage.bindProjectImport({ input, deserialize: parse, applyProject: project => projects.push(project), notice });
  async function select(file) {
    input.files = file ? [file] : [];
    input.value = file?.name || '';
    input.dispatchEvent(new Event('change'));
    assert.equal(input.value, '');
    await new Promise(resolve => setImmediate(resolve));
  }
  return { select, projects, notices, notice, storage, parse };
}

function projectFile(contents, name = '标识项目.json') {
  const blob = new Blob([contents], { type: 'application/json' });
  return { name, size: blob.size, text: () => blob.text() };
}

test('项目导出使用现有序列化结果，下载失败时提示原因', async () => {
  const { storage, notice, notices } = createProjectFiles();
  const downloads = [];
  storage.download = (blob, name) => downloads.push({ blob, name });
  const content = '{"name":"换乘标识"}';
  storage.exportProject(() => content, '换乘标识.json', notice);
  assert.equal(downloads[0].name, '换乘标识.json');
  assert.equal(downloads[0].blob.type, 'application/json');
  assert.equal(await downloads[0].blob.text(), content);
  assert.deepEqual(notices, [['项目 JSON 已导出', 'success']]);
  storage.exportProject(() => content, '换乘标识.json', notice, () => { throw new Error('无法下载'); });
  assert.deepEqual(notices.at(-1), ['导出失败。无法生成项目 JSON', 'error']);
});

test('导入会清空文件控件，支持再次选择同一个文件，取消时没有修改', async () => {
  const { select, projects, notices } = createProjectFiles();
  const file = projectFile('"同一份项目"');
  await select(file);
  await select();
  await select(file);
  assert.deepEqual(projects, ['同一份项目', '同一份项目']);
  assert.deepEqual(notices, [['项目已导入', 'success'], ['项目已导入', 'success']]);
});

test('读到坏 JSON 时给出中文提示，并且不会提交项目', async () => {
  const { select, projects, notices } = createProjectFiles();
  await select(projectFile('{'));
  assert.deepEqual(projects, []);
  assert.deepEqual(notices, [['导入失败。JSON 格式有误', 'error']]);
});

test('导向原有的大项目仍可以读取，其他编辑器继续检查文件大小', async () => {
  const { storage, parse } = createProjectFiles();
  const file = projectFile('"大项目"' + ' '.repeat(2 * 1024 * 1024));
  assert.equal(await storage.readProjectFile(file, parse, false), '大项目');
  await assert.rejects(storage.readProjectFile(file, parse), /不能超过 2 MB/);
});

test('后选文件校验失败时，较早选中的文件仍不能覆盖当前项目', async () => {
  const { select, projects, notices } = createProjectFiles();
  let finishRead;
  await select({ ...projectFile(''), text: () => new Promise(resolve => { finishRead = resolve; }) });
  await select(projectFile('{'));
  finishRead('"较早选择"');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(projects, []);
  assert.deepEqual(notices, [['导入失败。JSON 格式有误', 'error']]);
});

test('较早选中的文件在异步校验时失败，不会覆盖后选文件的成功提示', async () => {
  let failValidation;
  const deserialize = source => source === '较早选择'
    ? new Promise((resolve, reject) => { failValidation = reject; })
    : Promise.resolve(source);
  const { select, projects, notices } = createProjectFiles(deserialize);
  await select(projectFile('较早选择'));
  await select(projectFile('后来选择'));
  failValidation(new Error('校验失败'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(projects, ['后来选择']);
  assert.deepEqual(notices, [['项目已导入', 'success']]);
});

test('异步保存导入项目失败时只显示失败，不误报导入成功', async () => {
  const { storage, notice, notices, parse } = createProjectFiles();
  const input = new EventTarget();
  storage.bindProjectImport({ input, deserialize: parse, applyProject: async () => { throw new Error('项目写入失败'); }, notice });
  input.files = [projectFile('"有效工程"')]; input.dispatchEvent(new Event('change'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(notices, [['导入失败。项目写入失败', 'error']]);
});

test('异步写入完成时已选择其他文件，旧文件的成功提示不盖住新文件错误', async () => {
  const { storage, notice, notices, parse } = createProjectFiles();
  const input = new EventTarget(); let finish;
  storage.bindProjectImport({ input, deserialize: parse, applyProject: () => new Promise(resolve => { finish = resolve; }), notice });
  input.files = [projectFile('"较早的项目"')]; input.dispatchEvent(new Event('change'));
  await new Promise(resolve => setImmediate(resolve));
  input.files = [projectFile('{')]; input.dispatchEvent(new Event('change'));
  await new Promise(resolve => setImmediate(resolve));
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(notices, [['导入失败。JSON 格式有误', 'error']]);
});
