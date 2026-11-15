import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
for (const file of ['core', 'platform/reference', 'platform/vertical-reference', 'platform/state', 'platform/route', 'platform/hanging', 'platform/vertical', 'platform/render']) {
  (0, eval)(readFileSync(new URL('../js/' + file + '.js', import.meta.url), 'utf8'));
}
const S = globalThis.PlatformState, R = globalThis.PlatformRender;
const measure = (text, family, weight, size) => String(text).length * size * .9;
measure.ink = (text, family, weight, size) => ({ abl: -size * .05, abr: measure(text, family, weight, size) - size * .05 });
measure.ascent = (text, family, weight, size) => size * .8;
measure.descent = (text, family, weight, size) => size * .1;
const role = (scene, name) => scene.nodes.filter(node => node.attrs['data-role'] === name);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, message);

function makeState(count, variant, direction, verticalSwapped, currentIndex, height = 768) {
  const base = S.replaceStations(S.create(), Array.from({ length: count }, (_, index) => ({
    id: 'endpoint-' + index, code: String(index + 1), zh: '站点' + index, en: 'Station ' + index, transfers: []
  })));
  return S.settings(S.setVerticalVariant(base, variant), {
    mode: 'vertical', direction, verticalSwapped, currentId: base.stations[currentIndex].id,
    sizes: { ...base.sizes, vertical: { width: variant === 'double' ? 640 : 384, height } }
  });
}

for (const variant of ['left', 'right', 'double']) for (const direction of [-1, 1]) for (const swapped of [false, true]) {
  test(`纵向端点 ${variant} direction=${direction} swapped=${swapped}：终到全灰直角，始发整条线路色`, () => {
    for (const count of [2, 11, 50]) for (const height of [128, 768]) for (const currentIndex of [0, count - 1]) {
      const state = makeState(count, variant, direction, swapped, currentIndex, height);
      const before = S.serialize(state), scene = R.metrics(state, measure);
      assert.deepEqual(scene.columns.map(column => column.direction), variant === 'double'
        ? [direction * (swapped ? -1 : 1), -direction * (swapped ? -1 : 1)] : [direction]);
      scene.columns.forEach((column, index) => {
        const bar = role(scene, 'vertical-bar')[index];
        const active = role(scene, 'vertical-active-bar').find(node => node.attrs.x === bar.attrs.x);
        const tail = role(scene, 'vertical-tail').find(node => node.attrs['data-column-side'] === column.side);
        const terminal = currentIndex === (column.direction === 1 ? count - 1 : 0);
        if (terminal) {
          assert.equal(bar.tag, 'rect', '终到后竖带应为直角矩形');
          assert.equal(bar.attrs.fill, state.muted, '终到后全条竖带应为已驶过灰色');
          assert.equal(active, undefined, '终到后不应保留本站外侧彩色短条');
          assert.equal(tail, undefined, '终到后不应保留彩色斜切端头');
          near(bar.attrs.y, column.positions.at(-1) - 40 * column.unit, '终到直角竖带仍须延伸到顶端40单位');
          near(bar.attrs.y + bar.attrs.height, column.positions[0] + 40 * column.unit, '终到直角竖带仍须延伸到底端40单位');
        } else {
          assert(active, '始发时应有线路色竖带');
          assert.equal(active.attrs.fill, state.color);
          near(active.attrs.y, bar.attrs.y, '始发时顶部延伸段不应露灰');
          near(active.attrs.y + active.attrs.height, bar.attrs.y + bar.attrs.height, '始发时底部延伸段不应露灰');
          assert(tail, '始发时前方斜切端头仍应保留');
          assert.equal(tail.attrs.fill, state.color);
        }
        const currentKey = 'vertical:' + column.side + ':' + state.currentId;
        assert.equal(scene.nodes.find(node => node.attrs['data-element-key'] === currentKey && node.attrs['data-role'] === 'vertical-badge').attrs.fill, state.color, '端点本站圆标保留线路色');
        assert.equal(scene.nodes.find(node => node.attrs['data-element-key'] === currentKey && node.attrs['data-role'] === 'vertical-current-arrow').attrs['data-direction'], column.direction, '端点提示箭头仍沿该列行车方向');
      });
      assert.equal(S.serialize(state), before, '端点排版不得修改状态');
    }
  });
}

test('纵向仅一站：两方向、三版式及交换均为灰色直角竖带，不生成活动短条或斜尾', () => {
  for (const variant of ['left', 'right', 'double']) for (const direction of [-1, 1]) for (const swapped of [false, true]) {
    const state = makeState(1, variant, direction, swapped, 0), scene = R.metrics(state, measure);
    assert.equal(role(scene, 'vertical-active-bar').length, 0);
    assert.equal(role(scene, 'vertical-tail').length, 0);
    assert.equal(role(scene, 'vertical-bar').length, scene.columns.length);
    scene.columns.forEach((column, index) => {
      const bar = role(scene, 'vertical-bar')[index];
      assert.equal(bar.tag, 'rect');
      assert.equal(bar.attrs.fill, state.muted);
      near(bar.attrs.y, column.positions[0] - 40 * column.unit, '单站竖带顶部延伸40单位');
      near(bar.attrs.height, 80 * column.unit, '单站竖带两端合计80单位');
    });
  }
});
