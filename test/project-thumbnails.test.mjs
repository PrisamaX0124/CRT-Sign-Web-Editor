import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const filename = fileURLToPath(new URL('../js/projects/thumbnails.js', import.meta.url));
const source = readFileSync(filename, 'utf8');
function loadThumbnails(browser = {}) {
  runInNewContext(source, browser, { filename });
  return browser.SignProjectThumbnails;
}
const { thumbnailSize } = loadThumbnails();

test('宽标识保留完整牌面和比例，短站台图沿用实际比例', () => {
  const wide = thumbnailSize({ width: 4000, height: 200 }, false);
  assert.equal(wide.width, 384);
  assert.equal(wide.height, 19);
  assert.equal(wide.viewBox, '0 0 4000 200');
  assert.equal(wide.cropped, false);
  const short = thumbnailSize({ width: 192, height: 96 }, true);
  assert.equal(short.width / short.height, 2);
  assert.equal(short.cropped, false);
});

test('超长单列和双列纵向线路图按原比例裁切上部', () => {
  for (const width of [384, 640]) {
    const thumbnail = thumbnailSize({ width, height: 8192 }, true);
    assert.equal(thumbnail.width, 88);
    assert.equal(thumbnail.height, 176);
    assert.equal(thumbnail.viewBox, '0 0 ' + width + ' ' + width * 2);
    assert.equal(thumbnail.cropped, true);
  }
});

function createPreview(readThumbnail, readProject) {
  const pending = new Map(), revoked = [];
  const dialog = { open: true };
  let timer = 0, animations = 0, draws = 0;
  const frame = {
    dataset: {},
    image: undefined,
    append(image) { this.image = image; },
    querySelector: () => frame.image,
  };
  const { create } = loadThumbnails({
    AbortController,
    URL: {
      createObjectURL: () => 'blob:缩略图',
      revokeObjectURL: address => revoked.push(address),
    },
    document: {
      createElement: () => Object.assign(new EventTarget(), { remove() { frame.image = undefined; } }),
    },
    EditorMotion: { fadeIn() { animations++; } },
    setTimeout(callback) { pending.set(++timer, callback); return timer; },
    clearTimeout: identifier => pending.delete(identifier),
  });
  const preview = create({
    dialog, getStore: () => ({ readThumbnail, read: readProject }),
    readState: project => project.data, draw() { draws++; throw new Error('测试不需要绘制'); },
  });
  const metadata = { id: 'project', contentRevision: 2 };
  return {
    frame, dialog, revoked, preview,
    show() { preview.synchronize(new Map([[frame, metadata]])); },
    hide() { preview.synchronize(new Map()); },
    get draws() { return draws; },
    get animations() { return animations; },
    get waiting() { return pending.size; },
    async run() {
      const [identifier, callback] = pending.entries().next().value;
      pending.delete(identifier);
      callback();
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

test('有相同内容版本的缓存时直接显示图片，移除卡片便释放图片地址', async () => {
  let reads = 0;
  const view = createPreview(async () => { reads++; return { contentRevision: 2, version: 1, image: {} }; });
  view.show();
  await view.run();
  view.frame.image.dispatchEvent(new Event('load'));
  assert.equal(view.frame.dataset.thumbnailState, 'ready');
  assert.equal(view.animations, 1);
  view.show();
  assert.equal(view.waiting, 0);
  assert.equal(reads, 1);
  assert.equal(view.draws, 0);
  view.hide();
  assert.equal(view.frame.image, undefined);
  assert.deepEqual(view.revoked, ['blob:缩略图']);
});

test('弹窗关闭后取消等待中的缓存读取，晚返回的旧图片不会插入页面', async () => {
  let complete;
  const view = createPreview(() => new Promise(resolve => { complete = resolve; }));
  view.show();
  await view.run();
  view.dialog.open = false;
  view.preview.stop();
  complete({ contentRevision: 2, version: 1, image: {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.frame.image, undefined);
  assert.equal(view.waiting, 0);
});

test('内容变动时放弃旧任务，无法绘制的项目保留占位且本次不重复绘制', async () => {
  const stale = createPreview(async () => undefined, async () => ({ contentRevision: 3 }));
  stale.show();
  await stale.run();
  assert.equal(stale.draws, 0);
  assert.equal(stale.waiting, 0);

  const failed = createPreview(async () => undefined, async () => ({ contentRevision: 2 }));
  failed.show();
  await failed.run();
  assert.equal(failed.draws, 1);
  assert.equal(failed.frame.dataset.thumbnailState, 'unavailable');
  failed.show();
  assert.equal(failed.waiting, 0);
});
