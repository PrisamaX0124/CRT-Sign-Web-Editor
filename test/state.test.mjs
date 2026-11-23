/* Modified by PrisamaX0124, 2026-10-05: guidance sign and platform editor enhancements; see docs/fork-changes.md. */
/**
 * state.js / core.js 单元测试（Node 原生测试框架）
 * 运行：node --test test/
 */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext, runInThisContext } from 'node:vm';
import assert from 'node:assert/strict';

// 保留脚本路径，覆盖率报告才能列出被测文件。
const load = (path) => {
  const filename = fileURLToPath(new URL(path, import.meta.url));
  runInThisContext(readFileSync(filename, 'utf8'), { filename });
};
load('../js/core.js');
load('../js/state.js');

const Core = globalThis.SignCore;
const S = globalThis.SignState;

// ─── core ─────────────────────────────────────────────────

test('normalizeHex 规范化十六进制颜色', () => {
  assert.equal(Core.normalizeHex('#ff0000'), '#FF0000');
  assert.equal(Core.normalizeHex('#f00'), '#FF0000');
  assert.equal(Core.normalizeHex(' #AbC123 '), '#ABC123');
  assert.equal(Core.normalizeHex('red'), null);
  assert.equal(Core.normalizeHex('#12345'), null);
});

test('contrastTextColor 按亮度选黑/白', () => {
  assert.equal(Core.contrastTextColor('#000000'), '#FFFFFF');
  assert.equal(Core.contrastTextColor('#FFFFFF'), '#000000');
  assert.equal(Core.contrastTextColor('#E3002B'), '#FFFFFF');
  assert.equal(Core.contrastTextColor('#FCD600'), '#000000');
});

test('lineColorFor 查询上海线路色', () => {
  assert.deepEqual(Core.lineColorFor('1'), { line: '1', bg: '#E3002B', fg: '#FFFFFF' });
  assert.deepEqual(Core.lineColorFor(3), { line: '3', bg: '#FCD600', fg: '#000000' }); // 数字宽松匹配
  assert.equal(Core.lineColorFor('99'), null);
});

test('LINE_COLORS 覆盖 23 条线路（1–23 全量）', () => {
  assert.equal(Core.LINE_COLORS.length, 23);
  assert.deepEqual(Core.LINE_COLORS.map((c) => c.line),
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
      '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23']);
});

test('lineColorFor(city)：重庆/成都线路色查询，缺省与非法城市回退上海', () => {
  assert.equal(Core.lineColorFor('3', 'chongqing').bg, '#003DA5');
  assert.equal(Core.lineColorFor('15', 'chongqing').bg, '#0057B7');
  assert.equal(Core.lineColorFor('28', 'chongqing').bg, '#0057B7'); // 潘通2935C 共用
  assert.equal(Core.lineColorFor('29', 'chongqing').bg, '#FF585D');
  assert.equal(Core.lineColorFor('2', 'chengdu').bg, '#EB5A35');
  assert.equal(Core.lineColorFor('33', 'chengdu').bg, '#8EDD65');
  assert.equal(Core.lineColorFor('24', 'chengdu'), null);          // 成都无 24/25/31 号线
  assert.equal(Core.lineColorFor('1', 'shanghai').bg, '#E3002B');
  assert.equal(Core.lineColorFor('1').bg, '#E3002B');              // 缺省城市 = 上海
  assert.equal(Core.lineColorFor('1', 'nowhere').bg, '#E3002B');   // 非法城市回退上海
});

test('citySwatches：三城色板去重合并 + 通用色收尾', () => {
  const sh = Core.citySwatches('shanghai');
  assert.equal(sh.length, 23 + 7 + 4);                // 线路 + 城市附加（市域线等）+ 通用（出口黄/灰/黑/白）
  assert.equal(sh[0].bg, '#E3002B');
  assert.deepEqual(sh.slice(-4).map((c) => c.name), ['出口黄', '灰', '黑', '白']);

  const cq = Core.citySwatches('chongqing');
  assert.equal(cq.length, 24 + 1 + 4);                // 29 条数字线路去重为 24 色 + 环线 + 通用
  const panto = cq.filter((c) => c.bg === '#0057B7'); // 潘通2935C 共用色只出现一次
  assert.equal(panto.length, 1);
  assert.equal(panto[0].name, '潘通2935C蓝');
  assert.ok(cq.some((c) => c.name === '环线' && c.bg === '#F2A900'));

  const cd = Core.citySwatches('chengdu');
  assert.equal(cd.length, 30 + 19 + 4);               // 30 条数字线路 + S 线/蓉2 附加 + 通用
  assert.ok(cd.some((c) => c.name === '蓉2号线' && c.bg === '#7F9F3A'));
  assert.ok(cd.some((c) => c.name === 'S1线/新都金堂线' && c.bg === '#A4D65E'));

  [sh, cq, cd].forEach((sw) => {
    const bgs = sw.map((c) => c.bg);
    assert.equal(new Set(bgs).size, bgs.length, '色板内颜色两两唯一');
  });
});

test('sanitize：编号/线路类元素 align 仅 left|right，双语文本 align 不受影响', () => {
  const sign = {
    rows: [{
      id: 'r',
      elements: [
        { id: 'a', type: 'text-line', props: { align: 'right' } },
        { id: 'b', type: 'number-line', props: { align: 'center' } },
        { id: 'c', type: 'exit', props: { align: 'right' } },
        { id: 'd', type: 'exit', props: {} },
        { id: 'e', type: 'bilingual-text', props: { align: 'center' } },
      ],
    }],
  };
  const out = S.deserializeSign(JSON.stringify(sign));
  const [a, b, c, d, e] = out.rows[0].elements;
  assert.equal(a.props.align, 'right');     // 合法值保留
  assert.equal(b.props.align, 'left');      // 非法值归 left
  assert.equal(c.props.align, 'right');
  assert.equal(d.props.align, 'left');      // 缺省补 left
  assert.equal(e.props.align, 'center');    // 双语文本的三档对齐不受影响
});

test('灰框：默认关闭，deserialize 收敛到 0..512 并取整', () => {
  assert.equal(S.createSign().frameWidth, 0);           // 默认不显示
  const okVal = S.deserializeSign(JSON.stringify({
    rows: [{ id: 'r', elements: [] }], frameWidth: 24.6,
  }));
  assert.equal(okVal.frameWidth, 25);                   // 取整
  const neg = S.deserializeSign(JSON.stringify({
    rows: [{ id: 'r', elements: [] }], frameWidth: -5,
  }));
  assert.equal(neg.frameWidth, 0);                      // 负值归 0
  const huge = S.deserializeSign(JSON.stringify({
    rows: [{ id: 'r', elements: [] }], frameWidth: 99999,
  }));
  assert.equal(huge.frameWidth, 512);                   // 上限收敛
  const missing = S.deserializeSign(JSON.stringify({ rows: [{ id: 'r', elements: [] }] }));
  assert.equal(missing.frameWidth, 0);                  // 旧存档缺省关闭
});

test('灰框颜色：新标识牌使用深灰，旧项目保留原有灰色，合法颜色规范化', () => {
  assert.equal(S.createSign().frameColor, '#4A4A4A');
  const legacy = { rows: [{ id: 'r', elements: [] }], frameWidth: 12 };
  assert.equal(S.deserializeSign(legacy).frameColor, '#808080');
  assert.equal(S.deserializeSign({ ...legacy, frameColor: 'invalid' }).frameColor, '#808080');
  assert.equal(S.deserializeSign({ ...legacy, frameColor: '#123abc' }).frameColor, '#123ABC');
});

// ─── 工厂 ─────────────────────────────────────────────────

test('行背景色：独立不可变更新，排序、添加、序列化与恢复继承', () => {
  const sign = S.addRow(S.createSign());
  const id = sign.rows[0].id;
  const colored = S.updateRowSettings(sign, id, { backgroundColor: '#123abc' });
  assert.equal(colored.rows[0].backgroundColor, '#123ABC');
  assert.equal(sign.rows[0].backgroundColor, null);
  assert.equal(colored.rows[1], sign.rows[1]);
  const globalChange = S.updateSignSettings(colored, { backgroundColor: '#FFFF00' });
  assert.equal(globalChange.rows[0].backgroundColor, '#123ABC');
  assert.equal(globalChange.rows[1].backgroundColor, null);
  const moved = S.moveRow(globalChange, 0, 1);
  assert.equal(moved.rows[1].id, id);
  assert.equal(moved.rows[1].backgroundColor, '#123ABC');
  const added = S.addRow(moved);
  assert.equal(added.rows[2].backgroundColor, null);
  assert.deepEqual(S.deserializeSign(S.serializeSign(added)), added);
  const reset = S.updateRowSettings(added, id, { backgroundColor: null });
  assert.equal(reset.rows[1].backgroundColor, null);
  assert.equal(added.rows[1].backgroundColor, '#123ABC');
  assert.equal(S.updateRowSettings(sign, 'missing', { backgroundColor: '#000000' }), sign);
});

test('行背景色：旧存档缺省与非法值继承整牌，合法颜色规范化', () => {
  const sign = S.deserializeSign({ backgroundColor: '#556677', rows: [
    { id: 'legacy', elements: [] },
    { id: 'invalid', backgroundColor: 'invalid', elements: [] },
    { id: 'valid', backgroundColor: '#abc', elements: [] },
  ] });
  assert.deepEqual(sign.rows.map((row) => row.backgroundColor), [null, null, '#AABBCC']);
});

test('createSign 返回正确的初始状态', () => {
  const sign = S.createSign();
  assert.equal(sign.widthMode, 'fixed');
  assert.equal(sign.width, 2048);
  assert.equal(sign.rowHeight, 192);
  assert.equal(sign.aspectLocked, false);
  assert.equal(sign.backgroundColor, '#FFFFFF');
  assert.equal(sign.rows.length, 1);
  assert.deepEqual(sign.rows[0].elements, []);
  assert.match(sign.rows[0].id, /.+/);
});

test('createElement 各类型默认值齐全，padding 深合并', () => {
  const a = S.createElement('arrow', { direction: 'right', padding: { left: 0.05 } });
  assert.equal(a.props.direction, 'right');
  assert.equal(a.props.thicknessRatio, 0.25);
  assert.equal(a.props.padding.left, 0.05);
  assert.equal(a.props.padding.top, 0.2); // 未指定的方向保留默认

  const nl = S.createElement('number-line');
  assert.deepEqual(nl.props.lines, [{ number: '1', color: '#E4002B' }]); // 默认重庆 1 号线红

  const sp = S.createElement('space');
  assert.equal(sp.props.widthRatio, 0.5);
  assert.equal(sp.props.backgroundColor, null); // 空白占位默认透明，可选背景色
  assert.equal(sp.props.paddingAuto, false);    // 空白占位不参与相邻自动内边距
  const bn = S.createElement('big-number');
  assert.equal(bn.props.paddingAuto, true);     // 其余类型默认开启相邻自动内边距

  const sb = S.createElement('small-bilingual-text');
  assert.equal(sb.props.textZh, '站名');
  assert.equal(sb.props.textEn, 'Station');
  assert.equal(sb.props.paddingAuto, true);
});

test('createElement 生成唯一 id', () => {
  const a = S.createElement('space');
  const b = S.createElement('space');
  assert.notEqual(a.id, b.id);
});

// ─── 行操作 ───────────────────────────────────────────────

test('addRow 默认追加末尾，可指定位置', () => {
  const s0 = S.createSign();
  const s1 = S.addRow(s0);
  assert.equal(s1.rows.length, 2);
  assert.equal(s0.rows.length, 1); // 不可变
  const s2 = S.addRow(s1, 0);
  assert.equal(s2.rows.length, 3);
  assert.notEqual(s2.rows[0].id, s1.rows[0].id);
});

test('deleteRow 删除指定行，最后一行不可删', () => {
  const s0 = S.createSign();
  const s1 = S.addRow(s0);
  const s2 = S.deleteRow(s1, s1.rows[0].id);
  assert.equal(s2.rows.length, 1);
  assert.equal(s2.rows[0].id, s1.rows[1].id);
  const s3 = S.deleteRow(s2, s2.rows[0].id);
  assert.equal(s3.rows.length, 1); // 保持不变
  assert.equal(s3, s2);            // 原样返回同一引用
});

test('moveRow 重排，非法下标为 no-op', () => {
  const s0 = S.createSign();
  let s = s0;
  for (let i = 0; i < 2; i++) s = S.addRow(s);
  const ids = s.rows.map((r) => r.id);
  const moved = S.moveRow(s, 2, 0);
  assert.deepEqual(
    moved.rows.map((r) => r.id),
    [ids[2], ids[0], ids[1]],
  );
  assert.equal(S.moveRow(s, 1, 1), s);
  assert.equal(S.moveRow(s, -1, 0), s);
});

// ─── 元素操作 ─────────────────────────────────────────────

test('addElement 添加到指定行，原状态不变', () => {
  const s0 = S.createSign();
  const s1 = S.addRow(s0);
  const el = S.createElement('arrow');
  const s2 = S.addElement(s1, s1.rows[1].id, el);
  assert.equal(s2.rows[1].elements.length, 1);
  assert.equal(s2.rows[0].elements.length, 0);
  assert.equal(s1.rows[1].elements.length, 0); // 不可变
  const s3 = S.addElement(s2, s2.rows[1].id, S.createElement('space'), 0);
  assert.equal(s3.rows[1].elements[0].type, 'space');
});

test('deleteElement 按 id 全牌删除', () => {
  let s = S.createSign();
  s = S.addRow(s);
  const a = S.createElement('arrow');
  const b = S.createElement('exit');
  s = S.addElement(s, s.rows[0].id, a);
  s = S.addElement(s, s.rows[1].id, b);
  const s2 = S.deleteElement(s, a.id);
  assert.equal(s2.rows[0].elements.length, 0);
  assert.equal(s2.rows[1].elements.length, 1);
});

test('moveElement 同行向后排序（gap 语义）', () => {
  let s = S.createSign();
  const rowId = s.rows[0].id;
  const A = S.createElement('space');
  const B = S.createElement('space');
  const C = S.createElement('space');
  s = S.addElement(s, rowId, A).valueOf();
  s = S.addElement(s, rowId, B);
  s = S.addElement(s, rowId, C);
  // 把 A（下标 0）移到 C 之后的间隙（gap 3）
  const s2 = S.moveElement(s, A.id, rowId, 3);
  assert.deepEqual(
    s2.rows[0].elements.map((e) => e.id),
    [B.id, C.id, A.id],
  );
});

test('moveElement 同行向前排序（gap 语义）', () => {
  let s = S.createSign();
  const rowId = s.rows[0].id;
  const [A, B, C] = [S.createElement('space'), S.createElement('space'), S.createElement('space')];
  s = S.addElement(S.addElement(S.addElement(s, rowId, A), rowId, B), rowId, C);
  // 把 C（下标 2）移到 A 前的间隙（gap 0）
  const s2 = S.moveElement(s, C.id, rowId, 0);
  assert.deepEqual(
    s2.rows[0].elements.map((e) => e.id),
    [C.id, A.id, B.id],
  );
});

test('moveElement 同行原地 gap（no-op 结果）', () => {
  let s = S.createSign();
  const rowId = s.rows[0].id;
  const [A, B] = [S.createElement('space'), S.createElement('space')];
  s = S.addElement(S.addElement(s, rowId, A), rowId, B);
  const s2 = S.moveElement(s, A.id, rowId, 1); // A 后面的间隙
  assert.deepEqual(
    s2.rows[0].elements.map((e) => e.id),
    [A.id, B.id],
  );
});

test('moveElement 跨行移动', () => {
  let s = S.createSign();
  s = S.addRow(s);
  const A = S.createElement('space');
  s = S.addElement(s, s.rows[0].id, A);
  const target = s.rows[1].id;
  const s2 = S.moveElement(s, A.id, target, 0);
  assert.equal(s2.rows[0].elements.length, 0);
  assert.deepEqual(
    s2.rows[1].elements.map((e) => e.id),
    [A.id],
  );
});

test('updateElementProps 浅合并 + padding 深合并 + 不可变', () => {
  let s = S.createSign();
  const A = S.createElement('arrow');
  s = S.addElement(s, s.rows[0].id, A);
  const before = JSON.stringify(s);
  const s2 = S.updateElementProps(s, A.id, {
    direction: 'up',
    padding: { top: 0.3 },
  });
  assert.equal(s2.rows[0].elements[0].props.direction, 'up');
  assert.equal(s2.rows[0].elements[0].props.padding.top, 0.3);
  assert.equal(s2.rows[0].elements[0].props.padding.left, 0.2); // 其余方向不变
  assert.equal(JSON.stringify(s), before); // 原状态未被修改
});

test('updateElementProps 更新 number-line 单条线路颜色', () => {
  let s = S.createSign();
  const nl = S.createElement('number-line');
  s = S.addElement(s, s.rows[0].id, nl);
  const lines = [{ number: '2', color: '#82BF25' }, { number: '10', color: '#C6AFD4' }];
  const s2 = S.updateElementProps(s, nl.id, { lines });
  assert.deepEqual(s2.rows[0].elements[0].props.lines, lines);
});

// ─── 设置 ─────────────────────────────────────────────────

test('updateSignSettings 普通更新', () => {
  const s = S.updateSignSettings(S.createSign(), { rowHeight: 320 });
  assert.equal(s.rowHeight, 320);
  assert.equal(s.width, 2048); // 未锁定时宽度不变
});

test('宽度快捷 1–15：每格256px，与行高独立，切换固定宽度且不可变', () => {
  const sign = S.updateSignSettings(S.createSign(), { rowHeight: 320, widthMode: 'dynamic' });
  const before = JSON.stringify(sign);
  for (let units = 1; units <= 15; units++) {
    const next = S.setSignWidthUnits(sign, units);
    assert.equal(next.width, 256 * units);
    assert.equal(next.rowHeight, 320);
    assert.equal(next.widthMode, 'fixed');
    assert.equal(S.signWidthUnits(next), units);
  }
  assert.equal(JSON.stringify(sign), before);
  assert.equal(S.signWidthUnits(sign), null);
  assert.equal(S.signWidthUnits(S.updateSignSettings(sign, { widthMode: 'fixed', width: 1500 })), null);
  for (const invalid of [0, 16, 3.5, NaN, '3', null]) {
    assert.equal(S.setSignWidthUnits(sign, invalid), sign);
  }
});

test('选择宽度格数关闭比例锁，之后修改行高不改变宽度格数', () => {
  const sign = S.updateSignSettings(S.createSign(), { aspectLocked: true });
  const next = S.setSignWidthUnits(sign, 15);
  assert.equal(next.width, 3840);
  assert.equal(next.rowHeight, 192);
  assert.equal(next.aspectLocked, false);
  const resized = S.updateSignSettings(next, { rowHeight: 128 });
  assert.equal(resized.width, 3840);
  assert.equal(S.signWidthUnits(resized), 15);
});

test('宽度格数：32px/192px/2048px行高的1格与15格均可保存再导入', () => {
  for (const [rowHeight, units] of [[32, 1], [32, 15], [192, 1], [192, 15], [2048, 1], [2048, 15]]) {
    const sign = S.setSignWidthUnits(S.updateSignSettings(S.createSign(), { rowHeight }), units);
    assert.equal(sign.width, 256 * units);
    assert.deepEqual(S.deserializeSign(S.serializeSign(sign)), sign);
  }
});

test('灰框颜色更新、清空与项目往返保留所选颜色', () => {
  const sign = S.createSign();
  const next = S.updateSignSettings(sign, { frameWidth: 10, frameColor: '#112233' });
  assert.equal(sign.frameColor, '#4A4A4A');
  assert.equal(next.frameColor, '#112233');
  assert.equal(S.clearSign(next).frameColor, '#112233');
  assert.deepEqual(S.deserializeSign(S.serializeSign(next)), next);
});

test('锁定宽高比：改行高 → 宽度等比缩放', () => {
  let s = S.updateSignSettings(S.createSign(), { rowHeight: 256 });
  s = S.updateSignSettings(s, { aspectLocked: true });
  const s2 = S.updateSignSettings(s, { rowHeight: 128 });
  assert.equal(s2.width, 1024);
  assert.equal(s2.rowHeight, 128);
});

test('锁定宽高比：改宽度 → 行高等比缩放', () => {
  let s = S.updateSignSettings(S.createSign(), { rowHeight: 256 });
  s = S.updateSignSettings(s, { aspectLocked: true });
  const s2 = S.updateSignSettings(s, { width: 4096 });
  assert.equal(s2.rowHeight, 512);
  assert.equal(s2.width, 4096);
});

test('clearSign 保留设置，恢复一行空白', () => {
  let s = S.createSign();
  s = S.addRow(s);
  s = S.addElement(s, s.rows[0].id, S.createElement('arrow'));
  const s2 = S.clearSign(s);
  assert.equal(s2.rows.length, 1);
  assert.equal(s2.rows[0].elements.length, 0);
  assert.equal(s2.rowHeight, s.rowHeight);
  assert.equal(s2.backgroundColor, s.backgroundColor);
});

// ─── 序列化 ───────────────────────────────────────────────

test('serialize → deserialize 往返一致', () => {
  let s = S.createSign();
  s = S.addRow(s);
  const el = S.createElement('number-line', {
    lines: [{ number: '3', color: '#FCD600' }, { number: '4', color: '#461D84' }],
  });
  s = S.addElement(s, s.rows[0].id, el);
  s = S.addElement(s, s.rows[1].id, S.createElement('bilingual-text', { textZh: '世纪大道', textEn: 'Century Avenue' }));
  s = S.updateSignSettings(s, { widthMode: 'dynamic', backgroundColor: '#000000' });

  const json = S.serializeSign(s);
  const back = S.deserializeSign(json);
  assert.deepEqual(back, s);
});

test('deserialize 拒绝非法结构', () => {
  assert.throws(() => S.deserializeSign('not json'), Error);
  assert.throws(() => S.deserializeSign({ sign: { rows: 'x' } }), /导向标识项目/);
  assert.throws(() => S.deserializeSign({ sign: { rows: [] } }), /至少需要一行/);
});

test('导向项目文件兼容未标版本的旧项目，并拒绝错误的版号或行结构', () => {
  const sign = S.createSign();
  assert.deepEqual(S.deserializeSign(JSON.stringify(sign)), sign);
  assert.deepEqual(S.deserializeSign(S.serializeSign(sign)), sign);
  assert.throws(() => S.deserializeSign(JSON.stringify({ version: 2, sign })), /只支持版本 1/);
  assert.throws(() => S.deserializeSign('{"sign":{"rows":[{}]}}'), /第 1 行/);
  assert.throws(() => S.deserializeSign('{"kind":"platform-sign","stations":[]}'), /导向标识项目/);
});

test('deserialize 宽容修补：未知元素剔除、缺失 props 补默认、颜色规范化', () => {
  const bad = {
    sign: {
      widthMode: 'weird', width: 999999, rowHeight: -5,
      rows: [
        {
          id: 'r1',
          elements: [
            { id: 'e1', type: 'arrow', props: { direction: 'up', color: 'bogus' } },
            { id: 'e2', type: 'unknown-type' },
          ],
        },
      ],
    },
  };
  const s = S.deserializeSign(bad);
  assert.equal(s.widthMode, 'fixed');
  assert.equal(s.width, 2048);
  assert.equal(s.rowHeight, 192);
  assert.equal(s.rows[0].elements.length, 1);
  const el = s.rows[0].elements[0];
  assert.equal(el.type, 'arrow');
  assert.equal(el.props.direction, 'up');
  assert.equal(el.props.color, '#000000'); // 非法颜色回退默认
  assert.equal(el.props.thicknessRatio, 0.25); // 缺失补默认
});

test('新建出口时背景透明', () => {
  const exit = S.createElement('exit');
  assert.equal(exit.props.backgroundColor, null);
});

test('项目导入保留显式出口背景色，规范颜色并兼容透明的旧出口', () => {
  const project = S.deserializeSign({
    rows: [{ id: 'row', elements: [
      { id: 'exit', type: 'exit', props: { code: 'C', align: 'right', color: '#222222', backgroundColor: '#abc' } },
      { id: 'entrance', type: 'entrance', props: { backgroundColor: '#F7D917' } },
      { id: 'transparent-exit', type: 'exit', props: { code: 'D' } },
      { id: 'invalid-exit', type: 'exit', props: { code: 'E', backgroundColor: '无效颜色' } },
    ] }],
  });
  const [exit, entrance, transparent, invalid] = project.rows[0].elements;
  assert.equal(exit.props.backgroundColor, '#AABBCC');
  assert.equal(exit.props.code, 'C');
  assert.equal(exit.props.align, 'right');
  assert.equal(exit.props.color, '#222222');
  assert.equal(entrance.props.backgroundColor, '#F7D917');
  assert.equal(transparent.props.backgroundColor, null);
  assert.equal(invalid.props.backgroundColor, null);
  assert.deepEqual(S.deserializeSign(S.serializeSign(project)), project);
});

test('复制粘贴出口保留选定的背景色和编号', () => {
  const project = S.createSign();
  const original = S.createElement('exit', { code: 'D', backgroundColor: '#F7D917' });
  const source = S.addElement(project, project.rows[0].id, original);
  const clipboard = S.serializeElements(source, [original.id]);
  const pasted = S.pasteElements(project, clipboard, project.rows[0].id);
  const [exit] = pasted.rows[0].elements;
  assert.equal(exit.props.backgroundColor, '#F7D917');
  assert.equal(exit.props.code, 'D');
  assert.notEqual(exit.id, original.id);
  assert.equal(project.rows[0].elements.length, 0);
});

test('读取和应用预设时保留出口背景色和其他元素颜色', () => {
  const stored = JSON.stringify([{
    id: 'older-preset', name: '旧预设', elements: [
      { id: 'exit', type: 'exit', props: { code: 'E', backgroundColor: '#F7D917' } },
      { id: 'entrance', type: 'entrance', props: { backgroundColor: '#F7D917' } },
    ],
  }]);
  const filename = fileURLToPath(new URL('../js/presets.js', import.meta.url));
  const browser = { SignCore: Core, SignState: S, localStorage: { getItem: () => stored } };
  runInNewContext(readFileSync(filename, 'utf8'), browser, { filename });
  const presets = browser.SignPresets.readLegacy(stored);
  const applied = S.applyPreset({ ...S.createSign(), presets }, 'older-preset');
  const [exit, entrance] = applied.rows.at(-1).elements;
  assert.equal(exit.props.backgroundColor, '#F7D917');
  assert.equal(exit.props.code, 'E');
  assert.notEqual(exit.id, 'exit');
  assert.equal(entrance.props.backgroundColor, '#F7D917');
});

test('padding：左右可 >1（≤8），上下仍 ≤1', () => {
  const s = S.deserializeSign({
    sign: {
      rows: [{
        id: 'r',
        elements: [{ id: 'e', type: 'space', props: { padding: { left: 3.5, right: 9, top: 0.5, bottom: 2 } } }],
      }],
    },
  });
  const p = s.rows[0].elements[0].props.padding;
  assert.equal(p.left, 3.5);
  assert.equal(p.right, 8);   // 超上限截断
  assert.equal(p.top, 0.5);
  assert.equal(p.bottom, 1);  // 上下 clamp 到 1（超限截断而非丢弃）
});

test('元素对齐：默认 left，非法值归一为 left', () => {
  const s = S.deserializeSign({
    sign: {
      rows: [{
        id: 'r',
        elements: [
          { id: 'e1', type: 'space', props: {} },
          { id: 'e2', type: 'space', props: { elementAlign: 'right' } },
          { id: 'e3', type: 'space', props: { elementAlign: 'diagonal' } },
        ],
      }],
    },
  });
  const els = s.rows[0].elements;
  assert.equal(els[0].props.elementAlign, 'left');
  assert.equal(els[1].props.elementAlign, 'right');
  assert.equal(els[2].props.elementAlign, 'left');
});

test('icon：icon id 非字符串回退默认', () => {
  const s = S.deserializeSign({
    sign: { rows: [{ id: 'r', elements: [{ id: 'e', type: 'icon', props: { icon: 42 } }] }] },
  });
  assert.equal(s.rows[0].elements[0].type, 'icon');
  assert.equal(s.rows[0].elements[0].props.icon, 'elevator');
});

test('icon：旋转角度只接受 -90/0/90/180', () => {
  const s = S.deserializeSign({
    sign: {
      rows: [{
        id: 'r',
        elements: [
          { id: 'e1', type: 'icon', props: { rotation: -90 } },
          { id: 'e2', type: 'icon', props: { rotation: 90 } },
          { id: 'e3', type: 'icon', props: { rotation: 180 } },
          { id: 'e4', type: 'icon', props: { rotation: 45 } },
        ],
      }],
    },
  });
  const rotations = s.rows[0].elements.map((el) => el.props.rotation);
  assert.deepEqual(rotations, [-90, 90, 180, 0]);
});

test('deserialize 修补 number-line.lines 垃圾数据（非数组崩溃回归）', () => {
  // 历史 bug：lines 为字符串/对象时 numberLineMetrics 调 .map 直接抛错，整牌渲染崩溃
  const notArray = S.deserializeSign({
    sign: { rows: [{ id: 'r', elements: [{ id: 'e', type: 'number-line', props: { lines: '12' } }] }] },
  });
  assert.deepEqual(notArray.rows[0].elements[0].props.lines,
    [{ number: '1', color: '#E4002B' }]);      // 非数组回退默认线路

  const dirty = S.deserializeSign({
    sign: {
      rows: [{
        id: 'r',
        elements: [{
          id: 'e', type: 'number-line',
          props: {
            lines: [{ number: 42 }, { number: '2', color: 'bogus' }, 'junk'],
          },
        }],
      }],
    },
  });
  assert.deepEqual(dirty.rows[0].elements[0].props.lines,
    [{ number: '42', color: '#424A52' }, { number: '2', color: '#424A52' }]);
  // 空数组合法（面板可移除全部线路），不得被改写
  const empty = S.deserializeSign({
    sign: { rows: [{ id: 'r', elements: [{ id: 'e', type: 'number-line', props: { lines: [] } }] }] },
  });
  assert.deepEqual(empty.rows[0].elements[0].props.lines, []);
});

test('deserialize 收敛数值属性：widthRatio / thicknessRatio', () => {
  const s = S.deserializeSign({
    sign: {
      rows: [{
        id: 'r',
        elements: [
          { id: 'a', type: 'space', props: { widthRatio: 'x' } },
          { id: 'b', type: 'space', props: { widthRatio: -3 } },
          { id: 'c', type: 'space', props: { widthRatio: 99 } },
          { id: 'd', type: 'arrow', props: { thicknessRatio: 5 } },
          { id: 'f', type: 'arrow', props: { thicknessRatio: 'oops' } },
        ],
      }],
    },
  });
  const els = s.rows[0].elements;
  assert.equal(els[0].props.widthRatio, 0.5);    // 非数值回默认
  assert.equal(els[1].props.widthRatio, 0);      // 负值收敛 0
  assert.equal(els[2].props.widthRatio, 8);      // 超上限截断（与面板一致）
  assert.equal(els[3].props.thicknessRatio, 0.95);
  assert.equal(els[4].props.thicknessRatio, 0.25);
});

test('deserialize 枚举属性：arrow.direction 与双语文本 align 归一', () => {
  const s = S.deserializeSign({
    sign: {
      rows: [{
        id: 'r',
        elements: [
          { id: 'a', type: 'arrow', props: { direction: 'sideways' } },
          { id: 'b', type: 'bilingual-text', props: { align: 'justify' } },
          { id: 'c', type: 'small-bilingual-text', props: { align: 'justify' } },
        ],
      }],
    },
  });
  assert.equal(s.rows[0].elements[0].props.direction, 'left');
  assert.equal(s.rows[0].elements[1].props.align, 'center');
  assert.equal(s.rows[0].elements[2].props.align, 'center');
});

test('deserialize 文本属性强制字符串、颜色属性规范化', () => {
  const s = S.deserializeSign({
    sign: {
      rows: [{
        id: 'r',
        elements: [
          { id: 'a', type: 'bilingual-text', props: { textZh: 123, textEn: null, bold: 'yes' } },
          { id: 'b', type: 'small-bilingual-text', props: { textZh: 123, textEn: null, bold: 'yes' } },
          { id: 'c', type: 'big-number', props: { text: { bad: 1 } } },
          { id: 'd', type: 'exit', props: { code: 9 } },
          { id: 'e', type: 'text-line', props: { text: '环', textColor: 'junk', blockColor: 'junk' } },
          { id: 'f', type: 'number-line', props: { lines: [], textColor: 'junk' } },
        ],
      }],
    },
  });
  const [a, b, c, d, e, f] = s.rows[0].elements;
  assert.equal(a.props.textZh, '123');
  assert.equal(a.props.textEn, 'Station');       // null 回默认（渲染层空串安全）
  assert.equal(a.props.bold, true);              // 布尔化
  assert.equal(b.props.textZh, '123');
  assert.equal(b.props.textEn, 'Station');
  assert.equal(b.props.bold, true);
  assert.equal(c.props.text, '[object Object]'); // 非字符串强制 String，不崩溃
  assert.equal(d.props.code, '9');
  assert.equal(e.props.textColor, '#000000');
  assert.equal(e.props.blockColor, '#F2A900');
  assert.equal(f.props.textColor, '#000000');
});

test('deserialize 重复 id 重新生成（行与元素分别去重）', () => {
  const s = S.deserializeSign({
    sign: {
      rows: [
        { id: 'dup', elements: [{ id: 'x', type: 'space' }, { id: 'x', type: 'space' }] },
        { id: 'dup', elements: [] },
      ],
    },
  });
  const rowIds = s.rows.map((r) => r.id);
  assert.equal(new Set(rowIds).size, 2);
  const elIds = s.rows[0].elements.map((e) => e.id);
  assert.equal(new Set(elIds).size, 2);
});

test('findElement 全牌搜索', () => {
  let s = S.createSign();
  s = S.addRow(s);
  const el = S.createElement('entrance');
  s = S.addElement(s, s.rows[1].id, el);
  const found = S.findElement(s, el.id);
  assert.equal(found.rowId, s.rows[1].id);
  assert.equal(found.index, 0);
  assert.equal(found.element.type, 'entrance');
  assert.equal(S.findElement(s, 'nope'), null);
});

// ─── 相邻自动内边距 ───────────────────────────────────────

test('paddingAuto：deserialize 仅显式 true 保留，缺省钉住（旧存档不被动改）', () => {
  const on = S.deserializeSign({
    sign: { rows: [{ id: 'r', elements: [{ id: 'e', type: 'big-number', props: { paddingAuto: true } }] }] },
  });
  assert.equal(on.rows[0].elements[0].props.paddingAuto, true);
  const legacy = S.deserializeSign({
    sign: { rows: [{ id: 'r', elements: [{ id: 'e', type: 'big-number' }] }] },
  });
  assert.equal(legacy.rows[0].elements[0].props.paddingAuto, false);
  const junk = S.deserializeSign({
    sign: { rows: [{ id: 'r', elements: [{ id: 'e', type: 'big-number', props: { paddingAuto: 'yes' } }] }] },
  });
  assert.equal(junk.rows[0].elements[0].props.paddingAuto, false);
});

test('applyPaddingAuto：相邻折减、外侧保持、space 不算邻居', () => {
  let sign = S.createSign();
  sign = S.updateSignSettings(sign, { width: 1000 });
  const A = S.createElement('big-number', { text: '1' });
  const SP = S.createElement('space', { widthRatio: 0.3 });
  const B = S.createElement('big-number', { text: '2' });
  sign = S.addElement(sign, sign.rows[0].id, A);
  sign = S.addElement(sign, sign.rows[0].id, SP);
  sign = S.addElement(sign, sign.rows[0].id, B);
  sign = S.applyPaddingAuto(sign);
  const els = sign.rows[0].elements;
  assert.equal(els[0].props.padding.right, 0.2);   // 右邻是 space → 不折减
  assert.equal(els[2].props.padding.left, 0.2);    // 左邻是 space → 不折减
  assert.equal(els[0].props.padding.left, 0.2);    // 外侧保持默认
  assert.equal(els[2].props.padding.right, 0.2);
});

test('applyPaddingAuto：相邻折减两侧、外侧保持', () => {
  let sign = S.createSign();
  sign = S.updateSignSettings(sign, { width: 1000 });
  const C = S.createElement('big-number', { text: '3' });
  const D = S.createElement('bilingual-text', { textZh: '甲', textEn: 'A' });
  sign = S.addElement(sign, sign.rows[0].id, C);
  sign = S.addElement(sign, sign.rows[0].id, D);
  sign = S.applyPaddingAuto(sign);
  const els = sign.rows[0].elements;
  assert.equal(els[0].props.padding.right, 0.1);
  assert.equal(els[0].props.padding.left, 0.2);
  assert.equal(els[1].props.padding.left, 0.1);
  assert.equal(els[1].props.padding.right, 0.2);
  // 删除邻居 → 自动侧恢复默认
  sign = S.deleteElement(sign, D.id);
  sign = S.applyPaddingAuto(sign);
  assert.equal(sign.rows[0].elements[0].props.padding.right, 0.2);
});

test('applyPaddingAuto：贴右通道左右映射按视觉方向翻转', () => {
  let sign = S.createSign();
  sign = S.updateSignSettings(sign, { width: 1000 });
  const RA = S.createElement('big-number', { text: '3', elementAlign: 'right' });
  const RB = S.createElement('big-number', { text: '4', elementAlign: 'right' });
  sign = S.addElement(sign, sign.rows[0].id, RA);
  sign = S.addElement(sign, sign.rows[0].id, RB);
  sign = S.applyPaddingAuto(sign);
  const els = sign.rows[0].elements;
  // 视觉 [RB][RA]：RA 的视觉左邻是 RB，右邻无；RB 相反
  assert.equal(els[0].props.padding.left, 0.1);
  assert.equal(els[0].props.padding.right, 0.2);
  assert.equal(els[1].props.padding.right, 0.1);
  assert.equal(els[1].props.padding.left, 0.2);
});

test('applyPaddingAuto：钉住元素不折减', () => {
  let sign = S.createSign();
  const A = S.createElement('big-number', {
    text: '1', paddingAuto: false,
    padding: { top: 0.2, right: 0.3, bottom: 0.2, left: 0.3 },
  });
  const B = S.createElement('big-number', { text: '2' });
  sign = S.addElement(sign, sign.rows[0].id, A);
  sign = S.addElement(sign, sign.rows[0].id, B);
  sign = S.applyPaddingAuto(sign);
  const els = sign.rows[0].elements;
  assert.equal(els[0].props.padding.right, 0.3);   // 钉住不动
  assert.equal(els[1].props.padding.left, 0.1);    // 邻居存在即折减（与邻居是否钉住无关）
});

test('updateElementProps：写入左右内边距即钉住（与面板编辑一致）', () => {
  let s = S.createSign();
  const el = S.createElement('big-number', { text: '1' });
  s = S.addElement(s, s.rows[0].id, el);
  s = S.updateElementProps(s, el.id, { padding: { left: 0.3 } });
  assert.equal(s.rows[0].elements[0].props.paddingAuto, false);
  assert.equal(s.rows[0].elements[0].props.padding.left, 0.3);
  // 仅写上下不钉住
  const el2 = S.createElement('big-number', { text: '2' });
  s = S.addElement(s, s.rows[0].id, el2);
  s = S.updateElementProps(s, el2.id, { padding: { top: 0.4 } });
  assert.equal(s.rows[0].elements[1].props.paddingAuto, true);
});

test('浮动栏左右移动只交换同一行同一通道的相邻元素，且不可变', () => {
  let sign = S.createSign();
  const row = sign.rows[0].id;
  const left1 = S.createElement('big-number', { text: '1' });
  const right = S.createElement('big-number', { text: 'R', elementAlign: 'right' });
  const left2 = S.createElement('big-number', { text: '2' });
  for (const el of [left1, right, left2]) sign = S.addElement(sign, row, el);
  const before = JSON.stringify(sign);
  assert.equal(S.canMoveElementBy(sign, left1.id, -1), false);
  assert.equal(S.moveElementBy(sign, left1.id, -1), sign);
  const moved = S.moveElementBy(sign, left1.id, 1);
  assert.deepEqual(moved.rows[0].elements.map(el => el.id), [left2.id, right.id, left1.id]);
  assert.equal(JSON.stringify(sign), before);
  assert.equal(S.moveElementBy(sign, 'missing', 1), sign);
  assert.equal(S.moveElementBy(sign, left1.id, 0), sign);
});

test('浮动栏贴右通道遵循视觉左右，动态宽度按行内顺序移动', () => {
  let sign = S.createSign();
  const a = S.createElement('big-number', { text: 'A', elementAlign: 'right' });
  const b = S.createElement('big-number', { text: 'B', elementAlign: 'right' });
  sign = S.addElement(S.addElement(sign, sign.rows[0].id, a), sign.rows[0].id, b);
  assert.equal(S.canMoveElementBy(sign, a.id, 1), false);
  assert.equal(S.canMoveElementBy(sign, a.id, -1), true);
  assert.equal(S.moveElementBy(sign, a.id, -1).rows[0].elements[1].id, a.id);
  sign = S.updateSignSettings(sign, { widthMode: 'dynamic' });
  assert.equal(S.canMoveElementBy(sign, a.id, -1), false);
  assert.equal(S.moveElementBy(sign, a.id, 1).rows[0].elements[1].id, a.id);
});

test('浮动栏独立调整左右内边距，钉住自动值，不回滚其他属性，并收敛0..8', () => {
  let sign = S.createSign();
  const el = S.createElement('bilingual-text', { padding: { left: 0.1, right: 0.3 }, bold: true });
  sign = S.addElement(sign, sign.rows[0].id, el);
  const before = JSON.stringify(sign);
  const next = S.adjustElementPadding(S.adjustElementPadding(sign, el.id, 'left', 0.05), el.id, 'right', -0.05);
  const p = S.findElement(next, el.id).element.props;
  assert.equal(p.padding.left, 0.15);
  assert.equal(p.padding.right, 0.25);
  assert.equal(p.bold, true);
  assert.equal(p.paddingAuto, false);
  assert.equal(JSON.stringify(sign), before);
  assert.equal(S.findElement(S.adjustElementPadding(next, el.id, 'left', -10), el.id).element.props.padding.left, 0);
  assert.equal(S.findElement(S.adjustElementPadding(next, el.id, 'right', 10), el.id).element.props.padding.right, 8);
  for (const [id, side, delta] of [[el.id, 'top', 0.05], ['missing', 'left', 0.05], [el.id, 'left', NaN]]) {
    assert.equal(S.adjustElementPadding(sign, id, side, delta), sign);
  }
  const space = S.createElement('space');
  sign = S.addElement(sign, sign.rows[0].id, space);
  assert.equal(S.adjustElementPadding(sign, space.id, 'left', 0.05), sign);
});
