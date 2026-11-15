/* Modified by PrisamaX0124, 2026-10-05: guidance sign and platform editor enhancements; see docs/fork-changes.md. */
/**
 * render.js 纯几何函数测试（Node）
 * 使用确定性假测量器：width = ceil(len(text) × size × 0.9)
 */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = (p) => (0, eval)(readFileSync(new URL(p, import.meta.url), 'utf8'));
load('../js/core.js');
load('../js/state.js');
load('../js/render.js');

const S = globalThis.SignState;
const R = globalThis.SignRender;
const Core = globalThis.SignCore;

test('多行灰框：共享分割线总厚度等于外缘，奇数宽度也不加倍', () => {
  for (const fw of [1, 7, 12]) {
    const rows = [0, 1, 2].map((i) => R.rowFrameRects(1000, i * 100, 100, fw, i === 0, i === 2));
    assert.equal(rows[0][2].height, fw);
    assert.equal(rows[2][3].height, fw);
    for (let i = 0; i < 2; i++) {
      const bottom = rows[i][3], top = rows[i + 1][2];
      assert.equal(bottom.y + bottom.height, top.y, '相邻两半无缝衔接');
      assert.equal(bottom.height + top.height, fw, '共享分割线不加倍');
    }
    rows.forEach((rects) => assert.equal(rects[0].width, fw));
  }
  const single = R.rowFrameRects(1000, 0, 100, 12, true, true);
  assert.equal(single[2].height, 12);
  assert.equal(single[3].height, 12);
});

const measure = (text, family, weight, size) => Math.ceil(String(text).length * size * 0.9);
// 假墨区度量：按字体族校准的解剖比例（与渲染层排版解剖常数一致，Node/浏览器同值）
measure.ascent = (text, family, weight, size) =>
  Math.ceil(size * (family === Core.FONT_ZH ? 0.80 : family === Core.FONT_NUM ? 0.70 : 0.72));
measure.descent = (text, family, weight, size) =>
  size * (family === Core.FONT_ZH ? 0.09 : 0.21);
measure.ink = (text, family, weight, size) => ({
  abl: -0.05 * size,
  abr: 0.85 * size,
  adv: 0.9 * size,
});

test('contentBox 比例换算像素', () => {
  const box = R.contentBox({ top: 0.2, right: 0.1, bottom: 0.2, left: 0.1 }, 100);
  assert.equal(box.t, 20);
  assert.equal(box.r, 10);
  assert.equal(box.b, 20);
  assert.equal(box.l, 10);
  assert.equal(box.size, 60);
});

test('arrowGeometry left 方向坐标（sign_jr 移植）', () => {
  const s = 60, t = 15;
  const geo = R.arrowGeometry(s, t, 'left');
  const k = t / (2 * Math.SQRT2);
  assert.deepEqual(geo.head1, [[0, 30], [15, 30], [45, 0], [30, 0]]);
  assert.deepEqual(geo.head2, [[0, 30], [15, 30], [45, 60], [30, 60]]);
  // 箭柄为四点多边形
  assert.ok(Math.abs(geo.shaft[0][0] - t / 2) < 1e-9 && Math.abs(geo.shaft[0][1] - (30 - k)) < 1e-9);
  assert.ok(Math.abs(geo.shaft[1][0] - s) < 1e-9 && Math.abs(geo.shaft[1][1] - (30 - k)) < 1e-9);
  assert.ok(Math.abs(geo.shaft[2][0] - s) < 1e-9 && Math.abs(geo.shaft[2][1] - (30 + k)) < 1e-9);
  assert.ok(Math.abs(geo.shaft[3][0] - t / 2) < 1e-9 && Math.abs(geo.shaft[3][1] - (30 + k)) < 1e-9);
});

test('arrowGeometry up 方向坐标', () => {
  const s = 60, t = 15;
  const geo = R.arrowGeometry(s, t, 'up');
  const k = t / (2 * Math.SQRT2);
  assert.deepEqual(geo.head1, [[30, 0], [30, 15], [0, 45], [0, 30]]);
  assert.ok(Math.abs(geo.shaft[0][0] - (30 - k)) < 1e-9 && Math.abs(geo.shaft[0][1] - t / 2) < 1e-9);
  assert.ok(Math.abs(geo.shaft[2][1] - s) < 1e-9);
});

test('arrowGeometry 斜向：箭尖落在盒角、几何不越界', () => {
  const tips = {
    'left-up': [0, 0],
    'right-up': [60, 0],
    'right-down': [60, 60],
    'left-down': [0, 60],
  };
  Object.keys(tips).forEach((d) => {
    const geo = R.arrowGeometry(60, 15, d);
    const tip = geo.head1[0];
    assert.ok(Math.abs(tip[0] - tips[d][0]) < 1e-9 && Math.abs(tip[1] - tips[d][1]) < 1e-9,
      d + ' 箭尖应为盒角，实际 ' + tip);
    const all = geo.head1.concat(geo.head2, geo.shaft);
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    assert.ok(Math.min(...xs) >= -1e-9 && Math.max(...xs) <= 60 + 1e-9, d + ' x 越界');
    assert.ok(Math.min(...ys) >= -1e-9 && Math.max(...ys) <= 60 + 1e-9, d + ' y 越界');
  });
});

test('八个方向元素宽度一致', () => {
  const dirs = ['left', 'up', 'right', 'down', 'left-up', 'right-up', 'right-down', 'left-down'];
  const widths = dirs.map((d) => R.computeElementWidth(S.createElement('arrow', { direction: d }), 100, measure));
  widths.forEach((w, i) => assert.ok(Math.abs(w - widths[0]) < 1e-9, '方向宽度不一致: ' + dirs[i]));
});

test('箭头宽度 = 内容尺寸 + 左右内边距', () => {
  const el = S.createElement('arrow');
  assert.equal(R.computeElementWidth(el, 100, measure), 100);
  const el2 = S.createElement('arrow', { padding: { left: 0.05, right: 0.05 } });
  assert.equal(R.computeElementWidth(el2, 100, measure), 70);
});

test('双语文本字号与宽度', () => {
  const el = S.createElement('bilingual-text', { textZh: '站名', textEn: 'Station' });
  const w = R.computeElementWidth(el, 100, measure);
  const bi = R.bilingualMetrics('站名', 'Station', 60, measure, false);
  assert.ok(Math.abs(bi.zhSize * R.CJK_FACE - 0.582 * 60) < 0.01);  // 中文墨高 = 0.58s（字面高意图）
  assert.ok(Math.abs(bi.enSize * (R.EN_CAP + R.EN_DESC) - 0.57 * 0.582 * 60) < 0.05); // 英文行 = 0.57×中文墨高
  assert.equal(bi.zhW, 69);   // ceil(2 × 37.9565 × 0.9)
  assert.equal(bi.enW, 135);  // ceil(7 × 21.4 × 0.9)
  assert.equal(w, 135 + 40);
  // 基线 = 解剖锚定：墨区顶（内容顶 + 顶部引导）+ 中文字面高；英文 cap 顶 = 中文墨区底 + 间隙
  assert.ok(Math.abs(bi.zhBase - (0.036 * 60 + measure.ascent('站名', Core.FONT_ZH, 400, bi.zhSize))) < 1e-9);
  assert.ok(Math.abs(bi.enBase - (bi.zhBase + measure.descent('站名', Core.FONT_ZH, 400, bi.zhSize) + R.ZH_EN_GAP * 60 + measure.ascent('Station', Core.FONT_EN, 400, bi.enSize))) < 1e-6);
});

test('大号双语文本按两行完整墨区在内容盒内垂直居中', () => {
  for (const bold of [false, true]) {
    const el = S.createElement('bilingual-text', {
      textZh: '中心广场', textEn: 'Central Plaza', bold,
      padding: { top: 0.15, bottom: 0.25 },
    });
    const mt = R.elementMetrics(el, 192, measure);
    const top = mt.zhBase - measure.ascent(el.props.textZh, Core.FONT_ZH, mt.weight, mt.zhSize);
    const bottom = mt.enBase + measure.descent(el.props.textEn, Core.FONT_EN, mt.weight, mt.enSize);
    assert.ok(Math.abs(top + bottom - mt.pad.size) < 1e-9);
    assert.equal(mt.zhSize, mt.pad.size * R.ZH_FONT_RATIO);
    assert.equal(mt.enSize, mt.pad.size * R.EN_FONT_RATIO);
  }
});

test('大数字字号 1.3 倍、宽度含内边距', () => {
  const el = S.createElement('big-number', { text: '4' });
  const mt = R.elementMetrics(el, 100, measure);
  assert.equal(mt.fontSize, 78);            // 60 × 1.3
  assert.equal(mt.textW, 71);               // ceil(1 × 78 × 0.9)
  assert.equal(mt.width, 71 + 40);
  assert.equal(mt.font, Core.FONT_NUM, '大文本使用Frutiger字体栈');
  assert.ok(Math.abs(mt.base - (20 + 0.036 * 60 + measure.ascent('4', Core.FONT_NUM, 400, 78))) < 1e-9);
});

test('大数字多位数：中段墨区紧排、左右墨区间距光学相等', () => {
  const el = S.createElement('big-number', { text: '14' });
  const mt = R.elementMetrics(el, 100, measure);
  // 中段紧排：相邻数字间距与数字线路的墨区间距一致（「1」不再因字距显得松散）
  const nl = R.elementMetrics(
    S.createElement('number-line', { lines: [{ number: '14', color: '#000000' }] }),
    100, measure);
  assert.deepEqual(mt.digits.map(d => d.ch), ['1', '4']);
  assert.ok(Math.abs((mt.digits[1].x - mt.digits[0].x) -
                     (nl.entries[0].digits[1].x - nl.entries[0].digits[0].x)) < 1e-9);
  // 光学居中：首字形左字距与末字形右字距之差被平分——
  // 「1」的左字距大、「4」的右字距小，整体平移后左右墨区间距相等
  const ink1 = measure.ink('1', Core.FONT_NUM, 400, 78);
  const ink4 = measure.ink('4', Core.FONT_NUM, 400, 78);
  const leftGap = mt.digits[0].x - ink1.adv / 2 - ink1.abl;   // 首位墨区到盒左缘
  const lastInkRight = mt.digits[1].x - ink4.adv / 2 + ink4.abr;
  const rightGap = mt.textW - lastInkRight;                    // 盒右缘到末位墨区
  assert.ok(Math.abs(leftGap - rightGap) < 1e-9,
    '左右墨区间距相等 ' + leftGap + ' vs ' + rightGap);
  assert.ok(leftGap > 0 && rightGap > 0, '两侧间距为正');
  // 宽度 = 两位的画布前进宽（光学平移不改变盒宽）
  assert.ok(Math.abs(mt.textW - ink1.adv * 2) < 1e-9);
  assert.equal(mt.width, mt.textW + 40);
  assert.equal(mt.fontSize, 78);
  assert.ok(Math.abs(mt.base - (20 + 0.036 * 60 + measure.ascent('14', Core.FONT_NUM, 400, 78))) < 1e-9);
  // 单位数：墨区在自身前进宽内同样光学居中（左字距 = 右字距）
  const one = R.elementMetrics(S.createElement('big-number', { text: '1' }), 100, measure);
  assert.equal(one.textW, measure('1', Core.FONT_NUM, 400, 78));
  const oneInkLeft = one.digits[0].x - ink1.adv / 2 - ink1.abl;
  const oneInkRight = one.digits[0].x - ink1.adv / 2 + ink1.abr;
  assert.ok(Math.abs(oneInkLeft - (one.textW - oneInkRight)) < 1e-9, '单位数墨区居中');
});

test('数字线路：色条宽、出血高度、单/双位前进量、标签位置', () => {
  const el1 = S.createElement('number-line', { lines: [{ number: '1', color: '#E3002B' }] });
  const mt1 = R.elementMetrics(el1, 100, measure);
  assert.ok(Math.abs(mt1.entries[0].stripeW - 60 * 10 / 28) < 1e-9);
  assert.equal(mt1.stripeH, 80);            // 色条从内容顶出血到元素底
  assert.equal(mt1.entries[0].advance, 60); // 单位数字前进一个内容尺寸
  assert.equal(mt1.entries[0].digits[0].x, 30);
  assert.equal(mt1.entries[0].fontSize, 78);
  const labelW = Math.max(Math.ceil(2 * 45 * 0.6325 * 0.9), Math.ceil(4 * 45 * 0.35625 * 0.9));
  assert.equal(mt1.label.width, labelW);
  assert.ok(Math.abs(mt1.labelX - (20 + 60 * 10 / 28 + 60)) < 1e-9);

  const el2 = S.createElement('number-line', {
    lines: [{ number: '1', color: '#E3002B' }, { number: '12', color: '#461D84' }],
  });
  const mt2 = R.elementMetrics(el2, 100, measure);
  // 墨区排版：advance = M + Σ(墨宽+墨间距) − 末位间距
  const w12 = measure.ink('2', Core.FONT_NUM, 400, 78);
  const inkW = w12.abr + w12.abl;
  const m12 = (60 - w12.adv) / 2 - w12.abl;
  const g12 = -w12.abl + (w12.adv - w12.abr);
  assert.ok(Math.abs(mt2.entries[1].advance - (m12 + 2 * (inkW + g12) - g12 + m12)) < 1e-9);
});

test('数字线路：数字墨区顶与「号线」标签墨区顶对齐', () => {
  const el = S.createElement('number-line', { lines: [{ number: '3', color: '#E3002B' }] });
  const mt = R.elementMetrics(el, 100, measure);
  const labelTop = 20 + mt.label.zhBase - mt.label.zhAscent;
  assert.ok(Math.abs(mt.entries[0].base -
    (labelTop + measure.ascent('3', Core.FONT_NUM, 400, 78))) < 1e-9);
});

test('两位数字：墨区排版，首位墨区与单位数同位、「1」无特殊规则', () => {
  const el = S.createElement('number-line', { lines: [{ number: '14', color: '#461D84' }] });
  const mt = R.elementMetrics(el, 100, measure);
  const e = mt.entries[0];
  assert.equal(e.font, Core.FONT_NUM);      // 常规 Frutiger
  const ink = measure.ink('4', Core.FONT_NUM, 400, 78);
  const M = (60 - ink.adv) / 2 - ink.abl;   // 基准墨边距
  const g = -ink.abl + (ink.adv - ink.abr); // 墨区间距
  assert.equal(e.digits[0].ch, '1');
  assert.ok(Math.abs(e.digits[0].x - (M + ink.adv / 2 + ink.abl)) < 1e-9); // 首位墨左 = M
  assert.equal(e.digits[1].ch, '4');
  assert.ok(Math.abs(e.digits[1].x - (M + (ink.abr + ink.abl) + g + ink.adv / 2 + ink.abl)) < 1e-9);
  assert.ok(Math.abs(e.advance - (M + 2 * (ink.abr + ink.abl) + g + M)) < 1e-9);
  // 墨区顶与「号线」对齐
  const labelTop = 20 + mt.label.zhBase - mt.label.zhAscent;
  assert.ok(Math.abs(e.base - (labelTop + measure.ascent('14', Core.FONT_NUM, 400, 78))) < 1e-9);
});

test('bilingualAlignX：对齐基准为纯文本区宽度', () => {
  const label = { width: 200, zhW: 120, enW: 80 };
  const left = R.bilingualAlignX(label, 50, 'left', 2);
  assert.equal(left.zhX, 50);
  assert.equal(left.enX, 52);
  const right = R.bilingualAlignX(label, 50, 'right', 2);
  assert.equal(right.zhX, 50 + 200 - 120);        // 最宽文本右缘 = x + width
  assert.equal(right.enX, 50 + 200 - 80 - 2);
  const center = R.bilingualAlignX(label, 50, 'center', 2);
  assert.equal(center.zhX, 50 + 40);
  assert.equal(center.enX, 50 + 60);
});

test('双语文本 metrics：textW 为纯文本宽，width 含内边距', () => {
  const el = S.createElement('bilingual-text', { textZh: '站名', textEn: 'Station' });
  const mt = R.elementMetrics(el, 100, measure);
  assert.equal(mt.textW, Math.max(mt.zhW, mt.enW));
  assert.equal(mt.width, mt.textW + mt.pad.l + mt.pad.r);
});

test('小号双语文本：字号与出口 Exit 标签一致', () => {
  const small = S.createElement('small-bilingual-text', { textZh: '出口', textEn: 'Exit' });
  const exit = S.createElement('exit', { code: '1' });
  const smallMt = R.elementMetrics(small, 100, measure);
  const exitMt = R.elementMetrics(exit, 100, measure);
  assert.equal(smallMt.zhSize, exitMt.label.zhSize);
  assert.equal(smallMt.enSize, exitMt.label.enSize);
  assert.equal(smallMt.zhBase, exitMt.label.zhBase);
  assert.equal(smallMt.enBase, exitMt.label.enBase);
  assert.ok(smallMt.zhSize < R.elementMetrics(
    S.createElement('bilingual-text', { textZh: '出口', textEn: 'Exit' }), 100, measure).zhSize);
});

test('文本线路：贯穿色条 + 大字占位 + 线/英文名标签', () => {
  const el = S.createElement('text-line', { text: '环', textEn: 'Loop Line' });
  const mt = R.elementMetrics(el, 100, measure);
  const s = 60;                                   // 内容尺寸 = 100 − 上下 padding
  assert.ok(Math.abs(mt.stripeW - s * 10 / 28) < 1e-9);  // 与数字线路同宽色条
  assert.equal(mt.stripeH, 80);                   // 色条从内容顶贯穿到行底
  assert.equal(mt.fontSize, s);                   // 与数字线路的数字同视觉高度
  assert.equal(mt.textW, measure('环', Core.FONT_ZH, 400, s));
  const labelW = Math.max(Math.ceil(1 * 45 * 0.6325 * 0.9), Math.ceil(9 * 45 * 0.35625 * 0.9));
  assert.equal(mt.label.width, labelW);           // 线 / Loop Line
  // 环与色条、环与「线」标签间距相等（各占一个 gap）
  assert.ok(Math.abs(mt.textX - (20 + mt.stripeW) - s / 8) < 1e-9);
  assert.ok(Math.abs(mt.labelX - (mt.textX + mt.textW) - s / 8) < 1e-9);
  assert.equal(mt.width, 20 + mt.stripeW + s / 8 + mt.textW + s / 8 + labelW + 20);
});

test('文本线路：大字墨区顶与「线」标签墨区顶对齐', () => {
  const el = S.createElement('text-line', { text: '环', textEn: 'Loop Line' });
  const mt = R.elementMetrics(el, 100, measure);
  const labelTop = 20 + mt.label.zhBase - mt.label.zhAscent;
  assert.ok(Math.abs(mt.base -
    (labelTop + measure.ascent('环', Core.FONT_ZH, 400, 60))) < 1e-9);
});

test('文本线路：线路名下沉默认开启', () => {
  const el = S.createElement('text-line', { text: '环', textEn: 'Loop Line' });
  assert.equal(el.props.nameSink, true);
  assert.equal(R.elementMetrics(el, 100, measure).sink, true);
  // 缺省属性的历史数据按开启处理（向后兼容）
  const raw = {
    id: 'legacy', type: 'text-line',
    props: { padding: { top: 0.2, right: 0.2, bottom: 0.2, left: 0.2 } },
  };
  assert.equal(R.elementMetrics(raw, 100, measure).sink, true);
});

test('文本线路：关闭下沉 = 「线」同级字号完整显示（不加「线」后缀）', () => {
  const el = S.createElement('text-line', {
    text: '机场联络线', textEn: 'Airport Link Line', nameSink: false,
  });
  const mt = R.elementMetrics(el, 100, measure);
  const s = 60;
  // 字号与下沉模式尾部的「线 / 英文名」标签完全一致（盒高 0.75s 的双语标签）
  const sink = R.elementMetrics(
    S.createElement('text-line', { text: '环', textEn: 'Airport Link Line' }), 100, measure);
  assert.equal(mt.sink, false);
  assert.equal(mt.label.zhSize, sink.label.zhSize);
  assert.equal(mt.label.enSize, sink.label.enSize);
  assert.ok(Math.abs(mt.label.zhSize - s * 0.75 * R.ZH_FONT_RATIO) < 1e-9); // 非站名级字号
  assert.equal(mt.label.zhW, measure('机场联络线', Core.FONT_ZH, 400, mt.label.zhSize)); // 中文按输入全文测量
  assert.ok(mt.label.enBase > mt.label.zhBase);   // 英文基线在中文之下
  var labelInkTop = 0.036 * s; // 首行墨区顶（全文本类统一引导线）
  var labelZhBase = labelInkTop + measure.ascent('机场联络线', Core.FONT_ZH, 400, mt.label.zhSize);
  assert.equal(mt.label.enBase, labelZhBase + measure.descent('机场联络线', Core.FONT_ZH, 400, mt.label.zhSize) + R.ZH_EN_GAP * s + measure.ascent('Airport Link Line', Core.FONT_EN, 400, mt.label.enSize));
  // 色条贯穿与色条→文字间距不变
  assert.ok(Math.abs(mt.stripeW - s * 10 / 28) < 1e-9);
  assert.equal(mt.stripeH, 80);
  assert.equal(mt.gap, s / 8);
  assert.equal(mt.labelX, 20 + mt.stripeW + mt.gap);
  assert.equal(mt.width, 20 + mt.stripeW + s / 8 + mt.label.width + 20);
});

test('数字线路右对齐：色块移至标签右侧、仅渲染第 1 条线路', () => {
  const el = S.createElement('number-line', {
    lines: [{ number: '5', color: '#0094D8' }, { number: '9', color: '#E3002B' }],
    align: 'right',
  });
  const mt = R.elementMetrics(el, 100, measure);
  const s = 60;
  assert.equal(mt.labelAlign, 'right');
  assert.equal(mt.entries.length, 1);             // 右对齐仅渲染第 1 条线路
  assert.equal(mt.entries[0].digitsX, 20);        // 编号从内容左缘起排（不再有前置色条）
  assert.equal(mt.entries[0].advance, 60);
  const stripeW = s * 10 / 28;
  const labelW = Math.max(Math.ceil(2 * 45 * 0.6325 * 0.9), Math.ceil(4 * 45 * 0.35625 * 0.9));
  assert.equal(mt.labelX, 20 + 60);               // 标签紧跟编号（编号 advance 含尾随墨边距）
  // 「标签 → 色块」间距 = 左对齐时「色块 → 数字」的墨区边距 M（单位数字槽内居中边距）
  const inkAdv = 0.9 * 78, inkAbl = -0.05 * 78;   // 假墨区（fontSize = 78）
  const margin = (s - inkAdv) / 2 - inkAbl;
  assert.ok(Math.abs(mt.entries[0].stripeX - (mt.labelX + labelW + margin)) < 1e-9);
  assert.ok(Math.abs(mt.width - (mt.labelX + labelW + margin + stripeW + 20)) < 1e-9);
  // 数据未破坏：左对齐（默认）下两条线路完整渲染
  const left = R.elementMetrics(
    S.createElement('number-line', {
      lines: [{ number: '5', color: '#0094D8' }, { number: '9', color: '#E3002B' }],
    }), 100, measure);
  assert.equal(left.entries.length, 2);
  assert.ok(Math.abs(left.entries[0].stripeX - 20) < 1e-9);          // 左对齐：色条紧贴内容左缘
  assert.ok(Math.abs(left.entries[0].advance - 60) < 1e-9);
  assert.ok(Math.abs(left.width - (20 + 2 * (stripeW + 60) + labelW + 20)) < 1e-9);
});

test('数字线路右对齐：多位数的标签间距用基准墨边距 M', () => {
  const el = S.createElement('number-line', {
    lines: [{ number: '14', color: '#461D84' }],
    align: 'right',
  });
  const mt = R.elementMetrics(el, 100, measure);
  const ink3 = measure.ink('3', Core.FONT_NUM, 400, 78);
  const M = (60 - ink3.adv) / 2 - ink3.abl;       // 基准墨边距（首位墨区锚定，与左对齐一致）
  const labelW = Math.max(Math.ceil(2 * 45 * 0.6325 * 0.9), Math.ceil(4 * 45 * 0.35625 * 0.9));
  assert.ok(Math.abs(mt.entries[0].stripeX - (mt.labelX + labelW + M)) < 1e-9);
});

test('数字线路左对齐：entries 携带绝对坐标（色条在编号前）', () => {
  const el = S.createElement('number-line', {
    lines: [{ number: '1', color: '#E3002B' }, { number: '12', color: '#461D84' }],
  });
  const mt = R.elementMetrics(el, 100, measure);
  const stripeW = 60 * 10 / 28;
  assert.equal(mt.entries[0].stripeX, 20);
  assert.equal(mt.entries[0].digitsX, 20 + stripeW);
  assert.ok(Math.abs(mt.entries[1].stripeX - (20 + stripeW + 60)) < 1e-9);
  assert.ok(Math.abs(mt.entries[1].digitsX - (20 + 2 * stripeW + 60)) < 1e-9);
  assert.equal(mt.labelAlign, 'left');
});

test('文字线路右对齐：色块移至右缘、标签盒内右对齐（宽为左对齐镜像）', () => {
  const el = S.createElement('text-line', { text: '环', textEn: 'Loop Line', align: 'right' });
  const mt = R.elementMetrics(el, 100, measure);
  const s = 60;
  const stripeW = s * 10 / 28;
  const textW = measure('环', Core.FONT_ZH, 400, s);
  assert.equal(mt.labelAlign, 'right');
  assert.equal(mt.textX, 20);                     // 大字墨区盒贴内容左缘
  assert.equal(mt.labelX, 20 + textW + s / 8);
  assert.ok(Math.abs(mt.stripeX - (mt.labelX + mt.label.width + s / 8)) < 1e-9);
  assert.ok(Math.abs(mt.stripeX + stripeW + 20 - mt.width) < 1e-9);
  // 镜像对称：与左对齐总宽一致
  const left = R.elementMetrics(S.createElement('text-line', { text: '环', textEn: 'Loop Line' }), 100, measure);
  assert.ok(Math.abs(mt.width - left.width) < 1e-9);
});

test('文字线路平铺右对齐：完整线路名在左、色块在右', () => {
  const el = S.createElement('text-line', {
    text: '机场联络线', textEn: 'Airport Link Line', nameSink: false, align: 'right',
  });
  const mt = R.elementMetrics(el, 100, measure);
  assert.equal(mt.sink, false);
  assert.equal(mt.labelAlign, 'right');
  assert.equal(mt.labelX, 20);                    // 完整线路名贴内容左缘
  assert.ok(Math.abs(mt.stripeX - (20 + mt.label.width + mt.gap)) < 1e-9);
  assert.ok(Math.abs(mt.width - (mt.stripeX + mt.stripeW + 20)) < 1e-9);
});

test('出口右对齐：编号移至「出口」右侧、基线不变、宽为镜像；出入口不受 align 影响', () => {
  const exitR = S.createElement('exit', { code: '1', align: 'right' });
  const exitL = S.createElement('exit', { code: '1' });
  const mtR = R.elementMetrics(exitR, 100, measure);
  const mtL = R.elementMetrics(exitL, 100, measure);
  assert.equal(mtR.labelAlign, 'right');
  assert.equal(mtR.labelX, 20);                   // 标签移到内容左缘
  assert.ok(Math.abs(mtR.codeCenterX - (20 + mtR.label.width + mtR.gap + mtR.codeW / 2)) < 1e-9);
  assert.equal(mtR.codeBase, mtL.codeBase);       // 编号基线不变
  assert.ok(Math.abs(mtR.width - mtL.width) < 1e-9); // 镜像对称
  // 出入口（entrance）不支持内容对齐：align=right 不生效
  const enR = R.elementMetrics(S.createElement('entrance', { code: 'C', align: 'right' }), 100, measure);
  const enL = R.elementMetrics(S.createElement('entrance', { code: 'C' }), 100, measure);
  assert.equal(enR.labelAlign, 'left');
  assert.equal(enR.codeCenterX, enL.codeCenterX);
  assert.equal(enR.width, enL.width);
});

test('出入口/出口：编号宽度（末位墨区右缘 + M₃）+ 1/8 间隙 + 标签', () => {
  const el = S.createElement('entrance', { code: 'C' });
  const mt = R.elementMetrics(el, 100, measure);
  const inkC = measure.ink('C', Core.FONT_NUM, 400, 78);
  const ink3 = measure.ink('3', Core.FONT_NUM, 400, 78);
  const M = (60 - ink3.adv) / 2 - ink3.abl;
  // codeW = 末位墨区右缘 + M₃（标签侧间距与数字线路一致）
  const codeW = mt.codeX + mt.codeChars[0].x - inkC.adv / 2 + inkC.abr - mt.codeX + M;
  assert.ok(Math.abs(mt.codeW - codeW) < 1e-9, 'codeW=' + mt.codeW);
  assert.equal(mt.gap, M);
  assert.equal(mt.width, 20 + mt.codeW + mt.label.width + 20);
});

test('空白占位宽度 = 行高 × 比例', () => {
  const el = S.createElement('space', { widthRatio: 0.6 });
  assert.equal(R.computeElementWidth(el, 100, measure), 60);
});

test('图标：正方形宽度 = 内容尺寸 + 左右内边距', () => {
  const el = S.createElement('icon', {
    padding: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
  });
  assert.equal(R.computeElementWidth(el, 100, measure), 100);
});

test('computeRowWidth 求和', () => {
  const row = {
    id: 'r',
    elements: [
      S.createElement('space', { widthRatio: 0.5 }),
      S.createElement('space', { widthRatio: 0.25 }),
    ],
  };
  assert.equal(R.computeRowWidth(row, 100, measure), 75);
});

test('动态宽度 = 最宽行（空牌至少一个行高）', () => {
  const sign = S.createSign();
  sign.widthMode = 'dynamic';
  assert.equal(R.computeSignWidth(sign, measure), 192); // 一行空行
  let s2 = S.addElement(sign, sign.rows[0].id,
    S.createElement('space', { widthRatio: 1.5 }));
  assert.equal(R.computeSignWidth(s2, measure), 288);
});

test('layoutSign 行 y 与元素 x 累计', () => {
  let sign = S.createSign();
  sign.rowHeight = 100;
  sign = S.addRow(sign);
  const a = S.createElement('space', { widthRatio: 0.5 });
  const b = S.createElement('space', { widthRatio: 0.25 });
  sign = S.addElement(sign, sign.rows[0].id, a);
  sign = S.addElement(sign, sign.rows[0].id, b);
  const layout = R.layoutSign(sign, measure);
  assert.equal(layout.height, 200);
  assert.equal(layout.rows[0].y, 0);
  assert.equal(layout.rows[1].y, 100);
  assert.equal(layout.rows[0].elements[0].x, 0);
  assert.equal(layout.rows[0].elements[1].x, 50);
  assert.equal(layout.rows[0].elements[1].width, 25);
  assert.equal(layout.rows[0].contentWidth, 75);
});

test('固定宽度：元素三车道对齐（左流式/居中成组/右贴边）', () => {
  let sign = S.createSign();
  sign.width = 1000;
  sign.rowHeight = 100;
  const a = S.createElement('space', { widthRatio: 0.2, elementAlign: 'left' });   // 20
  const b = S.createElement('space', { widthRatio: 0.3, elementAlign: 'center' }); // 30
  const c = S.createElement('space', { widthRatio: 0.1, elementAlign: 'right' });  // 10
  sign = S.addElement(sign, sign.rows[0].id, a);
  sign = S.addElement(sign, sign.rows[0].id, b);
  sign = S.addElement(sign, sign.rows[0].id, c);
  const slots = R.layoutSign(sign, measure).rows[0].elements;
  assert.equal(slots[0].x, 0);                       // 贴左从左缘排
  assert.ok(Math.abs(slots[1].x - (1000 - 30) / 2) < 1e-9); // 居中成组
  assert.ok(Math.abs(slots[2].x - (1000 - 10)) < 1e-9);     // 贴右从右缘排
});

test('动态宽度忽略元素对齐，整体左起排列', () => {
  let sign = S.createSign();
  sign.widthMode = 'dynamic';
  sign.rowHeight = 100;
  const a = S.createElement('space', { widthRatio: 0.2, elementAlign: 'right' });
  const b = S.createElement('space', { widthRatio: 0.3 });
  sign = S.addElement(sign, sign.rows[0].id, a);
  sign = S.addElement(sign, sign.rows[0].id, b);
  const slots = R.layoutSign(sign, measure).rows[0].elements;
  assert.equal(slots[0].x, 0);
  assert.equal(slots[1].x, 20);
});

test('数字线路右对齐：「1」与元素左缘的间距恒定（不随位数变化）', () => {
  // 右对齐编号的左缘为外侧：单位「1」与多位首位数字的墨区都锚定基准墨边距 M，
  // 到元素左缘的间距不随位数变化（与左对齐的色条侧同一套锚定）
  const dbl = R.elementMetrics(
    S.createElement('number-line', { lines: [{ number: '14', color: '#000000' }], align: 'right' }),
    100, measure);
  const ink1 = measure.ink('1', Core.FONT_NUM, 400, 78);
  const ink3 = measure.ink('3', Core.FONT_NUM, 400, 78);
  const M = (60 - ink3.adv) / 2 - ink3.abl;
  const dblInkLeft = dbl.entries[0].digitsX + dbl.entries[0].digits[0].x - ink1.adv / 2 - ink1.abl;
  assert.ok(Math.abs(dblInkLeft - (dbl.entries[0].digitsX + M)) < 1e-9,
    '十位墨区 = 盒左缘 + M ' + dblInkLeft);
  // 单位「1」同位（两位数不相对单位数位移）
  const single = R.elementMetrics(
    S.createElement('number-line', { lines: [{ number: '1', color: '#000000' }], align: 'right' }),
    100, measure);
  const singleInkLeft = single.entries[0].digitsX + single.entries[0].digits[0].x - ink1.adv / 2 - ink1.abl;
  assert.ok(Math.abs(singleInkLeft - dblInkLeft) < 1e-9,
    '单位「1」与「11」首位墨区同位 ' + singleInkLeft + ' vs ' + dblInkLeft);
  // 右缘（标签侧）同样为 M：advance − 末位墨区右缘 = M
  const lastInk = measure.ink('4', Core.FONT_NUM, 400, 78);
  const lastInkRight = dbl.entries[0].digitsX + dbl.entries[0].digits[1].x - lastInk.adv / 2 + lastInk.abr;
  assert.ok(Math.abs(dbl.entries[0].advance - (lastInkRight - dbl.entries[0].digitsX)) < 1e-9 ? false
    : Math.abs(dbl.entries[0].advance - (lastInkRight - dbl.entries[0].digitsX) - M) < 1e-6,
    'advance = 末位墨区右缘 + M');
});

test('出口编号：混排墨区策略与大数字一致（斜杠不与数字重叠）', () => {
  // 与大数字同一策略：整串逐字墨区间距（斜杠/字母与相邻数字之间同样保持 g），
  // 首位墨区锚定自身字距边距 lsb，末位保留字距右缘——盒边距不随内容变化
  const ref = R.elementMetrics(S.createElement('big-number', { text: '1/2/11/3' }), 100, measure);
  const ex = R.elementMetrics(S.createElement('exit', { code: '1/2/11/3' }), 100, measure);
  assert.equal(ex.codeChars.length, 8);
  assert.deepEqual(ex.codeChars.map(c => c.ch), ref.digits.map(d => d.ch));
  ex.codeChars.forEach((c, i) => {
    assert.ok(Math.abs(c.x - ref.digits[i].x) < 1e-9, '逐字坐标与大数字一致 #' + i);
  });
  // 末位墨区右缘 + M₃（标签侧间距与数字线路一致）
  const ink3w = measure.ink('3', Core.FONT_NUM, 400, 78);
  const M3 = (60 - ink3w.adv) / 2 - ink3w.abl;
  const refLastInkRight = ref.textW - (ink3w.adv - ink3w.abr); // 末字符为 '3'
  assert.ok(Math.abs(ex.codeW - (refLastInkRight + M3)) < 1e-9,
    'codeW = 末位墨区右缘 + M₃ ' + ex.codeW);
  // 相邻字符墨区间距 = g（斜杠与数字之间不再重叠）
  const ink3 = measure.ink('3', Core.FONT_NUM, 400, 78);
  const g = -ink3.abl + (ink3.adv - ink3.abr); // lsb₃ + rsb₃
  for (let i = 1; i < ex.codeChars.length; i++) {
    const inkPrev = measure.ink(ex.codeChars[i - 1].ch, Core.FONT_NUM, 400, 78);
    const inkCur = measure.ink(ex.codeChars[i].ch, Core.FONT_NUM, 400, 78);
    const inkRightPrev = ex.codeChars[i - 1].x - inkPrev.adv / 2 + inkPrev.abr;
    const inkLeftCur = ex.codeChars[i].x - inkCur.adv / 2 - inkCur.abl;
    assert.ok(Math.abs(inkLeftCur - inkRightPrev - g) < 1e-6, '相邻墨区间距 g #' + i);
  }
  // 单字符：居中于自身前进宽；末位墨区右缘 + M₃（与数字线路标签间距一致）
  const c1 = R.elementMetrics(S.createElement('exit', { code: 'C' }), 100, measure);
  assert.equal(c1.codeChars.length, 1);
  assert.ok(Math.abs(c1.codeChars[0].x - 71 / 2) < 1e-9);
  const inkC = measure.ink('C', Core.FONT_NUM, 400, 78);
  const ink3C = measure.ink('3', Core.FONT_NUM, 400, 78);
  const cInkRight = c1.codeX + c1.codeChars[0].x - inkC.adv / 2 + inkC.abr;
  const cM = (60 - ink3C.adv) / 2 - ink3C.abl;
  assert.ok(Math.abs(c1.codeW - (cInkRight - c1.codeX + cM)) < 1e-9,
    'codeW = 墨区右缘 + M₃ ' + c1.codeW);
  // '14' 同样走该策略（首位墨区 = 盒左缘 + lsb₁，与单位数盒边距一致）
  const num = R.elementMetrics(S.createElement('exit', { code: '14' }), 100, measure);
  const ink1 = measure.ink('1', Core.FONT_NUM, 400, 78);
  const inkLeft = num.codeX + num.codeChars[0].x - ink1.adv / 2 - ink1.abl;
  assert.ok(Math.abs(inkLeft - (num.codeX + -ink1.abl)) < 1e-9, '首位墨区 = 盒左缘 + lsb₁');
});
