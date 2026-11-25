import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const source = new URL('../js/editor-preferences.js', import.meta.url);

function makePreferences(stored, dark = false) {
  const values = new Map(Object.entries(stored || {}));
  const listeners = {};
  const media = { matches: dark, addEventListener(type, listener) { listeners.media = listener; } };
  const root = { dataset: {} };
  const window = {
    document: { documentElement: root },
    get localStorage() { return this.storage; },
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    matchMedia: () => media,
    addEventListener(type, listener) { listeners[type] = listener; },
  };
  runInNewContext(readFileSync(source, 'utf8'), { window, Set }, { filename: fileURLToPath(source) });
  return { preferences: window.EditorPreferences, window, values, listeners, media, root };
}

test('空设置、历史数据和错误数据都使用有效的界面设置', () => {
  const { preferences, root } = makePreferences({ 'public-editor-preferences': '{坏数据' }, true);
  assert.equal(root.dataset.editorTheme, 'dark');
  assert.equal(root.dataset.canvasBackground, 'dots');
  assert.equal(root.dataset.editorMotion, 'system');
  assert.equal(preferences.read().showTutorial, true);
  preferences.save({ theme: 'light', canvas: 'unknown', motion: 'reduced', showTutorial: 'false' });
  assert.deepEqual({ ...preferences.read() }, { theme: 'light', canvas: 'dots', motion: 'reduced', showTutorial: true });
});

test('保存与恢复设置会立即更新界面，系统切换只影响跟随系统的主题', () => {
  const { preferences, root, media, listeners, values } = makePreferences();
  media.matches = true;
  listeners.media();
  assert.equal(root.dataset.editorTheme, 'dark');
  assert(preferences.save({ theme: 'light', canvas: 'grid', motion: 'reduced', showTutorial: false }));
  listeners.media();
  assert.equal(root.dataset.editorTheme, 'light');
  assert.equal(root.dataset.canvasBackground, 'grid');
  assert.equal(JSON.parse(values.get('public-editor-preferences')).showTutorial, false);
  preferences.reset();
  assert.equal(root.dataset.editorTheme, 'dark');
  assert.equal(root.dataset.canvasBackground, 'dots');
});

test('只处理相关的跨页面保存和清除事件，并通知设置页面更新', () => {
  const { preferences, listeners, values, root } = makePreferences();
  let updates = 0;
  preferences.subscribe(() => updates++);
  values.set('public-editor-preferences', '{"theme":"dark","canvas":"plain"}');
  listeners.storage({ key: 'project' });
  assert.equal(root.dataset.editorTheme, 'light');
  listeners.storage({ key: 'public-editor-preferences' });
  assert.equal(root.dataset.editorTheme, 'dark');
  assert.equal(root.dataset.canvasBackground, 'plain');
  values.clear();
  listeners.storage({ key: null });
  assert.equal(root.dataset.canvasBackground, 'dots');
  assert.equal(updates, 2);
});

test('三个教程独立记录，浏览器禁止写入时仍可在当前页面使用', () => {
  const { preferences, window, values, root } = makePreferences();
  assert.equal(preferences.tutorialSeen('guidance'), false);
  assert(preferences.markTutorialSeen('guidance'));
  assert.equal(preferences.tutorialSeen('transfer'), false);
  assert.equal(preferences.tutorialSeen('platform'), false);
  const reopened = makePreferences(Object.fromEntries(values));
  assert.equal(reopened.preferences.tutorialSeen('guidance'), true);
  window.storage = null;
  assert.equal(preferences.save({ theme: 'dark' }), false);
  assert.equal(root.dataset.editorTheme, 'dark');
  assert.equal(preferences.markTutorialSeen('transfer'), false);
  assert.equal(preferences.tutorialSeen('transfer'), true);
  assert.equal(preferences.tutorialSeen('platform'), false);
});
