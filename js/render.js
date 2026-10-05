/* Modified by PrisamaX0124, 2026-10-05: guidance sign and platform editor enhancements; see docs/fork-changes.md. */
/**
 * render.js — SVG 渲染引擎（ADR-0001）
 *
 * 每个元素类型 = 一个 metrics 函数（纯几何，Node 可测）+ 一个绘制函数。
 * metrics 输入 (element, rowHeight, measure)，输出宽度与全部绘制坐标；
 * 绘制函数消费 metrics 生成 SVG DOM 片段。二者共用同一套公式，保证布局所见即所得。
 *
 * 关键比例均移植自 sign_jr.py（PRD 指定参考实现）：
 *   双语文本字号  size × 506/800（中）/ × 285/800（英）
 *   大文本/编号   size × 1.3，使用Frutiger，无字形时回退MiSans
 *   线路色条宽    size × 10/28
 *   箭头          双 45° 梯形箭头头 + 矩形箭柄（柄厚 = thickness/√2）
 */
(function (global) {
  'use strict';

  var Core = global.SignCore;
  var HAS_DOM = typeof document !== 'undefined' && document.createElementNS;

  // ─── 布局常量（相对内容尺寸 s 的比例）──────────────────────

  var ZH_FONT_RATIO = 506 / 800;   // 0.6325  中文字号，保留参考实现的比例
  var EN_FONT_RATIO = 285 / 800;   // 0.35625 英文字号，保留参考实现的比例
  var NUM_FONT_RATIO = 1.3;        // 大文本/编号字号
  var STRIPE_RATIO = 10 / 28;      // 线路色条宽
  var LABEL_BOX_RATIO = 0.75;      // 组合元素尾部双语标签的内容盒高
  var EN_ALIGN_OFFSET = 1 / 30;    // 英文左右对齐时的额外缩进

  // ─── 墨区锚定与参考实现的解剖常数 ──────────────────────────
  // 首行墨区顶距内容顶的引导（全文本类统一 → 同顶内边距时墨区顶齐平，基线按各自上伸部推导）
  var INK_TOP_LEADING = 0.036;
  // 下列字体解剖值仅用于参考比例校验；当前基线由 measure.ascent/descent 得出。
  var CJK_FACE = 0.92;   // 思源黑体字面高（墨区上伸+下伸，实测 站）
  var CJK_ASC = 0.84;    // 思源黑体墨区上伸
  var CJK_DESC = 0.08;   // 思源黑体墨区下伸
  var ZH_EN_GAP = 0.123; // 中文墨区底 → 英文 cap 顶（实测现布局）
  var EN_ASC = 0.74;     // Helvetica 墨区上伸（含上伸部）
  var EN_CAP = 0.72;     // Helvetica cap 高
  var EN_DESC = 0.21;    // Helvetica 下伸
  var NUM_ASC = 0.70;    // Frutiger 数字/大写墨区上伸

  // ─── 通用盒模型 ────────────────────────────────────────────

  /** 比例 padding → 像素，并给出内容盒 */
  function contentBox(padding, rowHeight) {
    var t = padding.top * rowHeight;
    var r = padding.right * rowHeight;
    var b = padding.bottom * rowHeight;
    var l = padding.left * rowHeight;
    return { t: t, r: r, b: b, l: l, top: t, size: rowHeight - t - b };
  }

  // ─── 箭头几何（sign_jr.Arrow 坐标移植 + 斜向旋转）─────────

  /**
   * 轴向箭头（left/right/up/down）三块形状，箭盒为 size²：
   *   head: 两个四边形（polygon 点数组），shaft: 四点多边形
   * 箭头头为两条 45° 平行四边形笔画（视觉笔画宽 = thickness/√2），箭柄等厚衔接。
   */
  function axisArrowGeometry(size, thickness, direction) {
    var c = size / 2;
    var k = thickness / (2 * Math.SQRT2); // 箭柄半厚 = thickness/√2 / 2
    var head1, head2, shaft;
    if (direction === 'left') {
      head1 = [[0, c], [thickness, c], [thickness + c, 0], [c, 0]];
      head2 = [[0, c], [thickness, c], [thickness + c, size], [c, size]];
      shaft = [
        [thickness / 2, c - k], [size, c - k], [size, c + k], [thickness / 2, c + k],
      ];
    } else if (direction === 'right') {
      head1 = [[size, c], [size - thickness, c], [size - thickness - c, 0], [size - c, 0]];
      head2 = [[size, c], [size - thickness, c], [size - thickness - c, size], [size - c, size]];
      shaft = [
        [0, c - k], [size - thickness / 2, c - k], [size - thickness / 2, c + k], [0, c + k],
      ];
    } else if (direction === 'up') {
      head1 = [[c, 0], [c, thickness], [0, thickness + c], [0, c]];
      head2 = [[c, 0], [c, thickness], [size, thickness + c], [size, c]];
      shaft = [
        [c - k, thickness / 2], [c + k, thickness / 2], [c + k, size], [c - k, size],
      ];
    } else { // down
      head1 = [[c, size], [c, size - thickness], [0, size - thickness - c], [0, size - c]];
      head2 = [[c, size], [c, size - thickness], [size, size - thickness - c], [size, size - c]];
      shaft = [
        [c - k, 0], [c + k, 0], [c + k, size - thickness / 2], [c - k, size - thickness / 2],
      ];
    }
    return { head1: head1, head2: head2, shaft: shaft };
  }

  // 斜向 = 轴对齐基底（左/右）在虚拟盒（长 √2s − t）内构建后旋转 ±45°，
  // 箭尖精确锚在内容盒角上；头部远角恰好触及盒缘，几何不越界。
  var DIAGONAL_ARROW = {
    'left-up': { base: 'left', phi: 45, corner: [0, 0] },
    'right-up': { base: 'right', phi: -45, corner: [1, 0] },
    'right-down': { base: 'right', phi: 45, corner: [1, 1] },
    'left-down': { base: 'left', phi: -45, corner: [0, 1] },
  };

  function arrowGeometry(size, thickness, direction) {
    var diag = DIAGONAL_ARROW[direction];
    if (!diag) return axisArrowGeometry(size, thickness, direction);
    var L = size * Math.SQRT2 - thickness;
    var g = axisArrowGeometry(L, thickness, diag.base);
    var phi = diag.phi * Math.PI / 180;
    var cos = Math.cos(phi), sin = Math.sin(phi);
    var cl = L / 2;
    var tip = diag.base === 'left' ? [0, cl] : [L, cl];
    function rel(p) {
      var dx = p[0] - cl, dy = p[1] - cl;
      return [dx * cos - dy * sin, dx * sin + dy * cos];
    }
    var tipRot = rel(tip);
    var ox = diag.corner[0] * size - tipRot[0];
    var oy = diag.corner[1] * size - tipRot[1];
    function rot(p) {
      var q = rel(p);
      return [q[0] + ox, q[1] + oy];
    }
    return {
      head1: g.head1.map(rot),
      head2: g.head2.map(rot),
      shaft: g.shaft.map(rot),
    };
  }

  // ─── 双语标签（组合元素内部复用：号线/出入口/出口/线）─────

  /**
   * 双语标签测量。boxSize 为本标签自身的内容尺寸（非行高）。
   * cs 为宿主元素的内容尺寸：标签墨区顶 = 内容顶 + INK_TOP_LEADING×cs（与其他文本类统一）。
   * 返回 { width, zhSize, enSize, zhBase, enBase, zhAbl, zhAbr, enAbl, enAbr }
   */
  function bilingualMetrics(textZh, textEn, boxSize, measure, bold, cs) {
    var weight = bold ? 700 : 400;
    var content = cs || boxSize;
    var zhSize = boxSize * ZH_FONT_RATIO;
    var enSize = boxSize * EN_FONT_RATIO;
    var zhW = measure(textZh, Core.FONT_ZH, weight, zhSize);
    var enW = measure(textEn, Core.FONT_EN, weight, enSize);
    var zhInk = measure.ink(textZh, Core.FONT_ZH, weight, zhSize);
    var enInk = measure.ink(textEn, Core.FONT_EN, weight, enSize);
    // 垂直解剖锚定：zh 墨区顶 = 内容顶 + 顶部引导；en 墨区顶 = zh 墨区底 + 间隙
    var zhAscent = measure.ascent(textZh, Core.FONT_ZH, weight, zhSize);
    var zhDescent = measure.descent(textZh, Core.FONT_ZH, weight, zhSize);
    var enAscent = measure.ascent(textEn, Core.FONT_EN, weight, enSize);
    var zhBase = INK_TOP_LEADING * content + zhAscent;
    var enBase = zhBase + zhDescent + ZH_EN_GAP * content + enAscent;
    return {
      width: Math.max(zhW, enW),
      zhSize: zhSize,
      enSize: enSize,
      zhW: zhW,
      enW: enW,
      zhBase: zhBase,
      enBase: enBase,
      zhAbl: zhInk.abl, zhAbr: zhInk.abr,
      enAbl: enInk.abl, enAbr: enInk.abr,
      weight: weight,
      zhAscent: zhAscent,
      zhDescent: zhDescent,
      enAscent: enAscent,
    };
  }

  // ─── 各元素 metrics（纯函数：宽度 + 绘制坐标）──────────────

  function arrowMetrics(el, h, m) {
    var p = contentBox(el.props.padding, h);
    var s = p.size;
    var th = Core.clamp(el.props.thicknessRatio, 0.05, 0.95) * s;
    var geo = arrowGeometry(s, th, el.props.direction);
    return { pad: p, size: s, geo: geo, width: s + p.l + p.r, offset: { x: p.l, y: p.t } };
  }

  function bilingualTextMetrics(el, h, m) {
    return standaloneBilingualMetrics(el, h, m, 1);
  }

  // 小号双语文本复用出口/出入口标签的 0.75 倍内容盒字号，
  // 但保留独立文本元素自己的内边距、对齐和颜色。
  function smallBilingualTextMetrics(el, h, m) {
    return standaloneBilingualMetrics(el, h, m, LABEL_BOX_RATIO);
  }

  function standaloneBilingualMetrics(el, h, m, boxRatio) {
    var p = contentBox(el.props.padding, h);
    var bi = bilingualMetrics(el.props.textZh, el.props.textEn, p.size * boxRatio, m, el.props.bold, p.size);
    // 大号两行文字按完整墨区居中。真实字面高（含英文下伸部）可能超过内容盒，
    // 顶部引导线会使整组文字偏下；小号仍沿用组合标签的顶对齐。
    if (boxRatio === 1) {
      var tops = [], bottoms = [];
      if (el.props.textZh.trim()) {
        tops.push(bi.zhBase - bi.zhAscent);
        bottoms.push(bi.zhBase + bi.zhDescent);
      }
      if (el.props.textEn.trim()) {
        tops.push(bi.enBase - bi.enAscent);
        bottoms.push(bi.enBase + m.descent(el.props.textEn, Core.FONT_EN, bi.weight, bi.enSize));
      }
      if (tops.length) {
        var shift = (p.size - Math.max.apply(null, bottoms) - Math.min.apply(null, tops)) / 2;
        bi.zhBase += shift;
        bi.enBase += shift;
      }
    }
    bi.pad = p;
    bi.textW = bi.width;
    bi.width = bi.width + p.l + p.r;
    return bi;
  }

  function bigNumberMetrics(el, h, m) {
    var p = contentBox(el.props.padding, h);
    var size = p.size * NUM_FONT_RATIO;
    var text = String(el.props.text == null ? '' : el.props.text);
    // 垂直解剖锚定：数字墨区顶（cap 顶）= 内容顶 + 顶部引导（与双语文本墨区顶统一）
    var font = Core.FONT_NUM;
    var base = p.t + INK_TOP_LEADING * p.size + m.ascent(text, font, 400, size);
    var t = inkTextLayout(text, p.size, size, m, font, 'lsb');
    // 光学居中：首末字形的字距边距不对称（「1」左空大、「2」右空小），
    // 整体平移使左右墨区间距相等——独立文本元素的边界即视觉边界
    var optical = (t.firstInkLeft - (t.textW - t.lastInkRight)) / 2;
    return {
      pad: p, font: font, fontSize: size, textW: t.textW,
      digits: t.chars.map(function (d) { return { ch: d.ch, x: d.x - optical }; }),
      base: base,
      width: t.textW + p.l + p.r,
    };
  }

  /**
   * 数字组墨区布局：所有间距按字形墨区（而非等宽字距）计算，视觉节奏一致。
   * - 首位墨区左缘锚定在基准墨边距 M（参考数字「3」在单位数槽位中的自然墨边距，
   *   即 (s − adv₃)/2 + lsb₃），任意线路号与色条（或标签）的视觉间距一致——
   *   「1」墨区窄，不再因字距居中而显得离色条更远；
   * - 相邻数字的墨区间距固定为 g = lsb₃ + rsb₃（「1」不再需要特殊削减规则）；
   * - 槽位 advance = 末位墨区右缘 + M，右侧留白与左侧对称。
   * 单位数字同样两侧各留 M（即"只有一位数字的运行"）——「1」与色条、与「号线」
   * 标签的间距不随位数变化。返回 { digits:[{ch,x}], advance }，
   * x 相对色条右缘（或编号盒左缘），配合 text-anchor=middle。
   */
  function digitLayout(num, s, fontSize, m, font) {
    font = font || Core.FONT_NUM;
    var chars = num.split('');
    if (chars.length < 2) {
      if (chars.length === 0) return { digits: [], advance: s, margin: 0 };
      // 单位数字 = 只有一位数字的运行：墨区左右两侧各留基准墨边距 M（按「3」校准），
      // 与多位的首位/末位完全一致——「1」与色条、与「号线」标签的间距不随位数变化
      // （旧的光学居中使「1」的两侧间距与两位数不一致）
      var ink = m.ink(chars[0], font, 400, fontSize);
      var ref = m.ink('3', font, 400, fontSize);
      var margin = (s - ref.adv) / 2 - ref.abl;
      var inkW = ink.abr + ink.abl;
      return {
        digits: [{ ch: chars[0], x: margin + ink.adv / 2 + ink.abl }],
        advance: margin * 2 + inkW,
        margin: margin,
      };
    }
    var ref = m.ink('3', font, 400, fontSize);
    var margin = (s - ref.adv) / 2 - ref.abl;   // (s−adv₃)/2 + lsb₃
    var gap = (-ref.abl) + (ref.adv - ref.abr); // lsb₃ + rsb₃
    var inkLeft = margin;
    var digits = chars.map(function (ch) {
      var ink = m.ink(ch, font, 400, fontSize);
      var x = inkLeft + ink.adv / 2 + ink.abl;  // 墨左缘 → anchor=middle 绘制点
      inkLeft += (ink.abr + ink.abl) + gap;     // 墨宽 + 固定墨区间距
      return { ch: ch, x: x };
    });
    return { digits: digits, advance: inkLeft - gap + margin, margin: margin };
  }

  /**
   * 墨区文本排版（大文本策略，全文本类元素共用）：
   * 多位文本逐字按墨区间距 g 紧排；单字符按自身前进宽居中。
   * edge='lsb'：首位墨区锚定自身字距边距 lsb、末位保留字距右缘——独立文本
   *   （大文本/编号/文本线路大字），盒边距不随内容变化；
   * edge='margin'：首位/末位墨区各留基准墨边距 M（紧贴色条等实体对象）——数字线路。
   * font 为测量/绘制字体栈（数字用 FONT_NUM，中文用 FONT_ZH）。
   * 返回 { chars:[{ch,x}], textW, margin }，x 相对文本盒左缘。
   */
  function inkTextLayout(text, slotSize, fontSize, m, font, edge) {
    if (!text) {
      return {
        chars: [], textW: edge === 'margin' ? slotSize : 0, margin: 0,
        firstInkLeft: edge === 'margin' ? slotSize : 0,
        lastInkRight: edge === 'margin' ? slotSize : 0,
      };
    }
    if (text.length === 1 && edge !== 'margin') {
      var wOnly = m(text, font, 400, fontSize);
      var inkOnly = m.ink(text, font, 400, fontSize);
      return {
        chars: [{ ch: text, x: wOnly / 2 }], textW: wOnly, margin: 0,
        firstInkLeft: wOnly / 2 - inkOnly.adv / 2 - inkOnly.abl,
        lastInkRight: wOnly / 2 - inkOnly.adv / 2 + inkOnly.abr,
      };
    }
    var layout = digitLayout(text, slotSize, fontSize, m, font);
    if (edge === 'margin') {
      return {
        chars: layout.digits, textW: layout.advance, margin: layout.margin,
        firstInkLeft: layout.margin,
        lastInkRight: layout.advance - layout.margin,
      };
    }
    var firstInk = m.ink(text.charAt(0), font, 400, fontSize);
    var shift = -firstInk.abl - layout.margin;
    var chars = layout.digits.map(function (d) { return { ch: d.ch, x: d.x + shift }; });
    var lastInk = m.ink(text.charAt(text.length - 1), font, 400, fontSize);
    return {
      chars: chars,
      textW: chars[chars.length - 1].x + lastInk.adv / 2, // 末位前进盒右缘
      firstInkLeft: chars[0].x - firstInk.adv / 2 - firstInk.abl,
      lastInkRight: chars[chars.length - 1].x - lastInk.adv / 2 + lastInk.abr,
      margin: layout.margin,
    };
  }

  function numberLineMetrics(el, h, m) {
    var p = contentBox(el.props.padding, h);
    var s = p.size;
    var stripeW = s * STRIPE_RATIO;
    var label = bilingualMetrics('号线', 'Line', s * LABEL_BOX_RATIO, m, false, s);
    var labelTop = p.t + label.zhBase - label.zhAscent; // 「号线」墨区顶
    var right = el.props.align === 'right';
    // 右对齐仅渲染第 1 条线路（现实导视中右置牌均为单线路）；数据保留，切回左对齐恢复
    var lines = right ? (el.props.lines || []).slice(0, 1) : (el.props.lines || []);
    var layouts = lines.map(function (line) {
      var num = String(line.number || '');
      var t = inkTextLayout(num, s, s * NUM_FONT_RATIO, m, Core.FONT_NUM, 'margin');
      return {
        num: num, color: line.color, digits: t.chars, advance: t.textW,
        margin: t.margin,
        base: labelTop + m.ascent(num, Core.FONT_NUM, 400, s * NUM_FONT_RATIO),
      };
    });
    var stripesW = layouts.length * stripeW;
    var labelAlign = right ? 'right' : 'left';
    // 首条线路的墨区边距：左对齐时是「色块 → 数字」的视觉间距，
    // 右对齐时同值用于「标签 → 色块」，保证两种模式的间距一致
    var firstMargin = layouts.length ? layouts[0].margin : 0;
    var labelX, stripesX0;
    if (right) {
      labelX = p.l + layouts.reduce(function (acc, L) { return acc + L.advance; }, 0);
      stripesX0 = labelX + label.width + firstMargin;   // 色块组移至标签右侧，间距与左对齐一致
    } else {
      labelX = p.l + layouts.reduce(function (acc, L) { return acc + L.advance; }, 0) + stripesW;
      stripesX0 = p.l;
    }
    var advAcc = 0;
    var entries = layouts.map(function (L, i) {
      var e = {
        number: L.num,
        color: L.color,
        stripeW: stripeW,
        advance: L.advance,
        font: Core.FONT_NUM,
        fontSize: s * NUM_FONT_RATIO,
        base: L.base,
        digits: L.digits,
        // 数字墨区顶与「号线」墨区顶齐平
      };
      if (right) {
        e.digitsX = p.l + advAcc;                 // 编号从内容左缘起排
        e.stripeX = stripesX0 + i * stripeW;      // 色块组按线路顺序并排
      } else {
        e.stripeX = p.l + i * stripeW + advAcc;   // 每条线路：色条在前、编号在后
        e.digitsX = e.stripeX + stripeW;
      }
      advAcc += L.advance;
      return e;
    });
    return {
      pad: p, size: s, stripeH: h - p.t, entries: entries, label: label,
      labelAlign: labelAlign,
      labelX: labelX,
      stripeX: stripesX0,
      width: right ? stripesX0 + stripesW + p.r : labelX + label.width + p.r,
    };
  }

  function textLineMetrics(el, h, m) {
    var p = contentBox(el.props.padding, h);
    var s = p.size;
    var stripeW = s * STRIPE_RATIO;             // 与数字线路同宽色条
    var gap = s / 8;                            // 大字两侧等距：色条→字 = 字→标签
    var right = el.props.align === 'right';     // 内容右对齐：色块移至右缘（镜像排版）
    var labelAlign = right ? 'right' : 'left';
    var stripeX, labelX, textX, width;
    if (el.props.nameSink !== false) {          // 缺省视为开启（历史数据兼容）
      var fontSize = s;                         // 与数字线路的数字同视觉高度
      var textT = inkTextLayout(el.props.text, s, fontSize, m, Core.FONT_ZH, 'lsb');
      var textW = textT.textW;
      var textChars = textT.chars;
      var label = bilingualMetrics('线', el.props.textEn, s * LABEL_BOX_RATIO, m, false, s);
      if (right) {
        textX = p.l;                            // 大字墨区左缘贴内容左缘（逐字墨区排版）
        labelX = p.l + textW + gap;
        stripeX = labelX + label.width + gap;   // 色块移至右缘
        width = stripeX + stripeW + p.r;
      } else {
        textX = p.l + stripeW + gap;            // 大字逐字墨区排版，盒左缘 = 色条 + gap
        labelX = p.l + stripeW + gap + textW + gap;
        stripeX = p.l;
        width = p.l + stripeW + gap + textW + gap + label.width + p.r;
      }
      return {
        pad: p, size: s, sink: true,
        stripeW: stripeW, stripeH: h - p.t, stripeX: stripeX,
        fontSize: fontSize, textW: textW,
        // 大字墨区顶与「线」标签墨区顶齐平（数字线路同理）
        base: p.t + label.zhBase - label.zhAscent + m.ascent(el.props.text, Core.FONT_ZH, 400, fontSize),
        textX: textX, textChars: textChars,
        gap: gap, label: label, labelX: labelX, labelAlign: labelAlign,
        width: width,
      };
    }
    // 平铺：完整线路名与「线 / 英文名」标签同字号（同一双语标签排版，盒高 0.75s），
    // 英文在下，中文显示输入全文
    var flat = bilingualMetrics(el.props.text, el.props.textEn, s * LABEL_BOX_RATIO, m, false, s);
    if (right) {
      labelX = p.l;                             // 完整线路名贴内容左缘
      stripeX = labelX + flat.width + gap;
      width = stripeX + stripeW + p.r;
    } else {
      labelX = p.l + stripeW + gap;
      stripeX = p.l;
      width = p.l + stripeW + gap + flat.width + p.r;
    }
    return {
      pad: p, size: s, sink: false,
      stripeW: stripeW, stripeH: h - p.t, stripeX: stripeX,
      gap: gap, label: flat, labelX: labelX, labelAlign: labelAlign,
      width: width,
    };
  }

  function codeLabelMetrics(el, h, m, labelZh, labelEn, alignable) {
    var p = contentBox(el.props.padding, h);
    var s = p.size;
    var size = s * NUM_FONT_RATIO;
    var code = String(el.props.code == null ? '' : el.props.code);
    var gap = s / 8;
    var label = bilingualMetrics(labelZh, labelEn, s * LABEL_BOX_RATIO, m, false, s);
    var right = alignable && el.props.align === 'right';
    // 编号基线公式两种模式一致（内容对齐仅镜像水平次序）
    var codeBase = p.t + label.zhBase - label.zhAscent + m.ascent(code, Core.FONT_NUM, 400, size);
    // 编号墨区排版：与大文本同一策略（inkTextLayout，见其注释）；
    // 末位补基准墨边距 M₃ 且不叠加 s/8——编号↔标签的间距公式与数字线路
    // 「数字 ↔ 号线」完全一致（labelX = 盒左缘 + 编号宽，M₃ 内含于编号宽）
    var codeT = inkTextLayout(code, s, size, m, Core.FONT_NUM, 'lsb');
    var codeChars = codeT.chars;
    var ink3 = m.ink('3', Core.FONT_NUM, 400, size);
    var trailingMargin = (s - ink3.adv) / 2 - ink3.abl;
    var codeW = codeT.lastInkRight + trailingMargin;
    if (right) {
      // 右对齐为左对齐的镜像：标签侧留 M₃，编号墨区外缘齐平于右内容缘
      // （codeW 含末位 M₃，此处不再叠加）
      var rightCodeX = p.l + label.width + trailingMargin;
      return {
        pad: p, size: s, codeSize: size, codeW: codeW,
        codeBase: codeBase,
        codeCenterX: rightCodeX + codeW / 2, // 编号移至标签右侧
        codeChars: codeChars, codeX: rightCodeX,
        gap: trailingMargin, label: label, labelX: p.l, labelAlign: 'right',
        width: p.l + label.width + codeW + p.r,
      };
    }
    return {
      pad: p, size: s, codeSize: size, codeW: codeW,
      codeBase: codeBase,
      codeCenterX: p.l + codeW / 2,
      codeChars: codeChars, codeX: p.l,
      gap: trailingMargin, label: label, labelX: p.l + codeW, labelAlign: 'left',
      width: p.l + codeW + label.width + p.r,
    };
  }

  function entranceMetrics(el, h, m) {
    return codeLabelMetrics(el, h, m, '出入口', 'Entrance', false);
  }

  function exitMetrics(el, h, m) {
    return codeLabelMetrics(el, h, m, '出口', 'Exit', true);
  }

  function spaceMetrics(el, h, m) {
    return { width: el.props.widthRatio * h };
  }

  /** 图标为正方形：宽 = 内容尺寸 + 左右内边距 */
  function iconMetrics(el, h, m) {
    var p = contentBox(el.props.padding, h);
    var s = p.size;
    return { pad: p, size: s, width: s + p.l + p.r };
  }

  var METRICS_FNS = {
    'arrow': arrowMetrics,
    'bilingual-text': bilingualTextMetrics,
    'small-bilingual-text': smallBilingualTextMetrics,
    'big-number': bigNumberMetrics,
    'number-line': numberLineMetrics,
    'text-line': textLineMetrics,
    'entrance': entranceMetrics,
    'exit': exitMetrics,
    'space': spaceMetrics,
    'icon': iconMetrics,
  };

  function elementMetrics(el, rowHeight, measure) {
    var fn = METRICS_FNS[el.type];
    if (!fn) throw new Error('未知元素类型: ' + el.type);
    return fn(el, rowHeight, measure);
  }

  function computeElementWidth(el, rowHeight, measure) {
    return elementMetrics(el, rowHeight, measure).width;
  }

  function computeRowWidth(row, rowHeight, measure) {
    return row.elements.reduce(function (acc, el) {
      return acc + computeElementWidth(el, rowHeight, measure);
    }, 0);
  }

  /** 动态宽度 = 最宽一行；全空时至少一个行高 */
  function computeSignWidth(sign, measure) {
    if (sign.widthMode === 'fixed') return sign.width;
    var w = sign.rowHeight;
    for (var i = 0; i < sign.rows.length; i++) {
      w = Math.max(w, computeRowWidth(sign.rows[i], sign.rowHeight, measure));
    }
    return Math.round(w);
  }

  /** 元素对齐属性（left|center|right），非法/缺失一律视为贴左 */
  function elementAlign(el) {
    return el.props && (el.props.elementAlign === 'center' || el.props.elementAlign === 'right')
      ? el.props.elementAlign : 'left';
  }

  /**
   * 行内元素水平布局。alignEnabled（固定宽度模式）时按元素对齐分三条独立通道：
   * 贴左从左缘流式排列、贴右从右缘流式排列、居中成组；通道间可能重叠（设计之内）。
   * 动态宽度模式一律左起排列。
   */
  function layoutRowElements(row, h, measure, signWidth, alignEnabled) {
    var slots = row.elements.map(function (el) {
      return { id: el.id, width: computeElementWidth(el, h, measure) };
    });
    var centerTotal = 0;
    var i, a;
    if (alignEnabled) {
      for (i = 0; i < row.elements.length; i++) {
        if (elementAlign(row.elements[i]) === 'center') centerTotal += slots[i].width;
      }
    }
    var leftX = 0;
    var rightX = signWidth;
    var centerX = (signWidth - centerTotal) / 2;
    for (i = 0; i < row.elements.length; i++) {
      a = alignEnabled ? elementAlign(row.elements[i]) : 'left';
      if (a === 'right') {
        rightX -= slots[i].width;
        slots[i].x = rightX;
      } else if (a === 'center') {
        slots[i].x = centerX;
        centerX += slots[i].width;
      } else {
        slots[i].x = leftX;
        leftX += slots[i].width;
      }
    }
    return slots;
  }

  /** 完整布局：每行 y、每元素 x/width */
  function layoutSign(sign, measure) {
    var h = sign.rowHeight;
    var width = computeSignWidth(sign, measure);
    var height = h * sign.rows.length;
    var alignEnabled = sign.widthMode === 'fixed';
    var rows = sign.rows.map(function (row, ri) {
      var elements = layoutRowElements(row, h, measure, width, alignEnabled);
      var contentWidth = elements.reduce(function (acc, s) { return acc + s.width; }, 0);
      return { id: row.id, y: ri * h, height: h, elements: elements, contentWidth: contentWidth };
    });
    return { width: width, height: height, rows: rows };
  }

  /** 灰框几何：相邻行各承担共享分割线的一半，外缘保持完整宽度。 */
  function rowFrameRects(signWidth, rowY, rowHeight, fw, first, last) {
    var top = first ? fw : fw / 2;
    var bottom = last ? fw : fw / 2;
    return [
      { x: 0, y: rowY, width: fw, height: rowHeight },
      { x: signWidth - fw, y: rowY, width: fw, height: rowHeight },
      { x: 0, y: rowY, width: signWidth, height: top },
      { x: 0, y: rowY + rowHeight - bottom, width: signWidth, height: bottom },
    ];
  }

  // ══════════════════════════════════════════════════════════
  // SVG DOM 绘制（仅浏览器）
  // ══════════════════════════════════════════════════════════

  function mk(tag, attrs) {
    var e = document.createElementNS(Core.SVG_NS, tag);
    for (var k in attrs) {
      if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    }
    return e;
  }

  function mkText(content, attrs) {
    var t = mk('text', attrs);
    t.textContent = content;
    return t;
  }

  function polygonPoints(pts) {
    return pts.map(function (p) { return p[0].toFixed(2) + ',' + p[1].toFixed(2); }).join(' ');
  }

  /**
   * 双语双行文本的对齐 x 坐标（纯函数）。
   * label 为 bilingualMetrics 结果，其 width 必须是纯文本区宽度（不含 padding）；
   * indent 为英文左右对齐时的额外缩进像素。
   */
  function bilingualAlignX(label, x, align, indent) {
    if (align === 'left') {
      return { zhX: x, enX: x + indent };
    }
    if (align === 'right') {
      return {
        zhX: x + label.width - label.zhW,
        enX: x + label.width - label.enW - indent,
      };
    }
    return {
      zhX: x + (label.width - label.zhW) / 2,
      enX: x + (label.width - label.enW) / 2,
    };
  }

  /**
   * 通用双语双行文本绘制。
   * label: bilingualMetrics 结果；x: 文本区左缘；top: 内容盒顶部 y；
   * align: left|center|right；indentScale: 左右对齐时英文额外缩进的基数（内容尺寸 s）
   */
  function drawBilingualBox(g, textZh, textEn, label, x, top, color, align, indentScale) {
    var pos = bilingualAlignX(label, x, align, indentScale * EN_ALIGN_OFFSET);
    g.appendChild(mkText(textZh, {
      x: pos.zhX, y: top + label.zhBase,
      'font-family': Core.FONT_ZH, 'font-size': label.zhSize,
      'font-weight': label.weight, fill: color,
    }));
    g.appendChild(mkText(textEn, {
      x: pos.enX, y: top + label.enBase,
      'font-family': Core.FONT_EN, 'font-size': label.enSize,
      'font-weight': label.weight, fill: color,
    }));
  }

  // 各元素绘制函数：在局部坐标（元素盒原点）内绘制。
  // 签名 (g, el, mt)：mt 为 renderElement 已算好的该元素 metrics，
  // draw 不得再调用 metrics 函数（同一元素每次渲染只测量一次，且坐标只有一套来源）。
  var DRAW_FNS;

  function drawArrow(g, el, mt) {
    var ox = mt.offset.x, oy = mt.offset.y;
    [mt.geo.head1, mt.geo.head2, mt.geo.shaft].forEach(function (poly) {
      g.appendChild(mk('polygon', {
        points: polygonPoints(poly.map(function (p) { return [p[0] + ox, p[1] + oy]; })),
        fill: el.props.color,
      }));
    });
  }

  function drawBilingualText(g, el, mt) {
    // 对齐基准是纯文本区宽度；mt.width 已含 padding，须换回 textW 视图，
    // 否则右/居中对齐会把文字推出内容盒（越出选中虚线框）。
    var label = {
      width: mt.textW, zhW: mt.zhW, enW: mt.enW,
      zhSize: mt.zhSize, enSize: mt.enSize,
      zhBase: mt.zhBase, enBase: mt.enBase, weight: mt.weight,
    };
    drawBilingualBox(g, el.props.textZh, el.props.textEn, label, mt.pad.l, mt.pad.t,
      el.props.color, el.props.align, mt.pad.size);
  }

  function drawBigNumber(g, el, mt) {
    // 逐字按 digitLayout 的墨区坐标绘制（多位数间距紧致，单位数单字居中）
    mt.digits.forEach(function (d) {
      g.appendChild(mkText(d.ch, {
        x: mt.pad.l + d.x, y: mt.base,
        'text-anchor': 'middle',
        'font-family': mt.font, 'font-size': mt.fontSize, fill: el.props.color,
      }));
    });
  }

  function drawNumberLine(g, el, mt) {
    mt.entries.forEach(function (e) {
      g.appendChild(mk('rect', {
        x: e.stripeX, y: mt.pad.t, width: e.stripeW, height: mt.stripeH, fill: e.color,
      }));
      e.digits.forEach(function (d) {
        g.appendChild(mkText(d.ch, {
          x: e.digitsX + d.x, y: e.base,
          'text-anchor': 'middle',
          'font-family': e.font, 'font-size': e.fontSize, fill: el.props.textColor,
        }));
      });
    });
    drawBilingualBox(g, '号线', 'Line', mt.label, mt.labelX, mt.pad.t, el.props.textColor, mt.labelAlign, 0);
  }

  function drawTextLine(g, el, mt) {
    // 贯穿色条：内容顶 → 行底，同数字线路；内容右对齐时位于元素右缘
    g.appendChild(mk('rect', {
      x: mt.stripeX, y: mt.pad.t, width: mt.stripeW, height: mt.stripeH,
      fill: el.props.blockColor,
    }));
    if (!mt.sink) {
      // 平铺：完整线路名（标签级字号）+ 英文名在下，无「线」后缀
      drawBilingualBox(g, el.props.text, el.props.textEn, mt.label, mt.labelX, mt.pad.t,
        el.props.textColor, mt.labelAlign, 0);
      return;
    }
    // 大字（思源黑体）逐字墨区排版，用文字颜色而非色条对比色
    mt.textChars.forEach(function (d) {
      g.appendChild(mkText(d.ch, {
        x: mt.textX + d.x, y: mt.base,
        'text-anchor': 'middle',
        'font-family': Core.FONT_ZH, 'font-size': mt.fontSize,
        fill: el.props.textColor,
      }));
    });
    drawBilingualBox(g, '线', el.props.textEn, mt.label, mt.labelX, mt.pad.t, el.props.textColor, mt.labelAlign, 0);
  }

  function drawCodeLabel(g, el, mt, labelZh, labelEn) {
    // 多位编号逐字按墨区坐标绘制；单字符整串居中
    if (mt.codeChars.length) {
      mt.codeChars.forEach(function (d) {
        g.appendChild(mkText(d.ch, {
          x: mt.codeX + d.x, y: mt.codeBase,
          'text-anchor': 'middle',
          'font-family': Core.FONT_NUM, 'font-size': mt.codeSize, fill: el.props.color,
        }));
      });
    } else {
      g.appendChild(mkText(el.props.code, {
        x: mt.codeCenterX, y: mt.codeBase,
        'text-anchor': 'middle',
        'font-family': Core.FONT_NUM, 'font-size': mt.codeSize, fill: el.props.color,
      }));
    }
    drawBilingualBox(g, labelZh, labelEn, mt.label, mt.labelX, mt.pad.t, el.props.color, mt.labelAlign, 0);
  }

  function drawEntrance(g, el, mt) {
    drawCodeLabel(g, el, mt, '出入口', 'Entrance');
  }

  function drawExit(g, el, mt) {
    drawCodeLabel(g, el, mt, '出口', 'Exit');
  }

  function drawSpace() { /* 空白占位，无可见内容 */ }

  function drawIcon(g, el, mt) {
    var lib = global.SignIcons;
    if (!HAS_DOM || !lib) return;
    var icon = lib.get(el.props.icon);
    var color = el.props.color || '#000000';
    // 旋转功能只作用于服务设施；方向图标已有固定方向，不受该属性影响。
    var rotation = icon.cat === 'service' ? Number(el.props.rotation) : 0;
    if ([-90, 90, 180].indexOf(rotation) === -1) rotation = 0;
    var nested = mk('svg', {
      x: mt.pad.l, y: mt.pad.t, width: mt.size, height: mt.size,
      viewBox: icon.vb, preserveAspectRatio: 'xMidYMid meet',
    });
    if (rotation) {
      nested.setAttribute('transform', 'rotate(' + rotation + ' ' +
        (mt.pad.l + mt.size / 2) + ' ' + (mt.pad.t + mt.size / 2) + ')');
    }
    nested.innerHTML = icon.body.replace(/fill="black"/g, 'fill="' + color + '"');
    g.appendChild(nested);
  }

  DRAW_FNS = {
    'arrow': drawArrow,
    'bilingual-text': drawBilingualText,
    'small-bilingual-text': drawBilingualText,
    'big-number': drawBigNumber,
    'number-line': drawNumberLine,
    'text-line': drawTextLine,
    'entrance': drawEntrance,
    'exit': drawExit,
    'space': drawSpace,
    'icon': drawIcon,
  };

  /**
   * 渲染单个元素为 <g>（局部坐标）。clean=true 时不带编辑器属性与命中框（用于导出/缩略图）。
   */
  function renderElement(el, rowHeight, measure, options) {
    var opts = options || {};
    var g = mk('g', { class: 'element' });
    if (!opts.clean) {
      g.setAttribute('data-element-id', el.id);
    }
    var mt = elementMetrics(el, rowHeight, measure);
    var w = Math.max(mt.width, 1);
    // 背景与命中框宽度向上取整：与相邻元素的取整平移相互覆盖，
    // 消除同色背景元素之间的亚像素透明缝
    var boxW = Math.ceil(w);
    // 元素背景色（含 padding 区，覆盖整个元素盒）
    var bg = el.props.backgroundColor;
    if (bg) {
      g.appendChild(mk('rect', { x: 0, y: 0, width: boxW, height: rowHeight, fill: bg }));
    }
    (DRAW_FNS[el.type] || drawSpace)(g, el, mt);
    if (!opts.clean) {
      g.appendChild(mk('rect', {
        class: 'hitbox', x: 0, y: 0, width: boxW, height: rowHeight,
        fill: 'transparent', 'pointer-events': 'all',
      }));
    }
    return { node: g, width: w };
  }

  /** 标识牌灰框：消费纯几何，相邻行共享分割线厚度。
   *  渲染在所有元素之上（遮挡越界内容）；pointer-events 关闭，不拦截元素点击。 */
  function appendFrameRects(g, strips, color) {
    strips.forEach(function (s) {
      var attrs = Object.assign({ class: 'sign-frame', fill: color }, s);
      attrs['pointer-events'] = 'none';
      g.appendChild(mk('rect', attrs));
    });
  }

  /**
   * 将整个标识牌渲染进 <svg> 元素（原地清空重绘）。
   * opts: { selectedElementId, selectedElementIds, clean }
   * 返回 layout（见 layoutSign）。
   */
  function renderSignInto(svg, sign, measure, opts) {
    var options = opts || {};
    var layout = layoutSign(sign, measure);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', '0 0 ' + layout.width + ' ' + layout.height);
    svg.setAttribute('xmlns', Core.SVG_NS);
    svg.appendChild(mk('rect', {
      class: 'sign-bg', x: 0, y: 0,
      width: layout.width, height: layout.height, fill: sign.backgroundColor,
    }));
    for (var ri = 0; ri < sign.rows.length; ri++) {
      var row = sign.rows[ri];
      var rowLayout = layout.rows[ri];
      var rowG = mk('g', { class: 'sign-row' });
      if (!options.clean) rowG.setAttribute('data-row-id', row.id);
      rowG.appendChild(mk('rect', {
        class: 'row-bg', x: 0, y: rowLayout.y,
        width: layout.width, height: sign.rowHeight,
        fill: row.backgroundColor || sign.backgroundColor,
      }));
      for (var ei = 0; ei < row.elements.length; ei++) {
        var el = row.elements[ei];
        var rendered = renderElement(el, sign.rowHeight, measure, { clean: options.clean });
        // 平移向下取整：相邻元素背景边界落在整数像素上，避免抗锯齿透明缝
        rendered.node.setAttribute('transform', 'translate(' + Math.floor(rowLayout.elements[ei].x) + ',' + rowLayout.y + ')');
        if (!options.clean && (options.selectedElementId === el.id || (options.selectedElementIds || []).indexOf(el.id) >= 0)) {
          rendered.node.setAttribute('class', 'element selected');
        }
        if (!options.clean) {
          rendered.node.setAttribute('data-row-id', row.id);
        }
        rowG.appendChild(rendered.node);
      }
      // 灰框在所有元素之上（真实边框遮挡越界内容），pointer-events 关闭不影响点击
      if (sign.frameWidth > 0) {
        appendFrameRects(rowG, rowFrameRects(layout.width, rowLayout.y, sign.rowHeight, sign.frameWidth,
          ri === 0, ri === sign.rows.length - 1),
          sign.frameColor || Core.LEGACY_SIGN_FRAME_COLOR);
      }
      svg.appendChild(rowG);
    }
    return layout;
  }

  /** 生成独立 <svg> 元素（缩略图用，非交互） */
  function renderElementStandalone(el, rowHeight, measure, maxWidth) {
    var mt = elementMetrics(el, rowHeight, measure);
    var w = Math.max(mt.width, 1);
    var svg = mk('svg', {
      viewBox: '0 0 ' + w + ' ' + rowHeight,
      xmlns: Core.SVG_NS,
    });
    if (maxWidth) svg.setAttribute('width', Math.min(w, maxWidth));
    var rendered = renderElement(el, rowHeight, measure, { clean: true });
    svg.appendChild(rendered.node);
    return { node: svg, width: w, height: rowHeight };
  }

  global.SignRender = {
    ZH_FONT_RATIO: ZH_FONT_RATIO,
    EN_FONT_RATIO: EN_FONT_RATIO,
    NUM_FONT_RATIO: NUM_FONT_RATIO,
    INK_TOP_LEADING: INK_TOP_LEADING,
    CJK_ASC: CJK_ASC,
    CJK_DESC: CJK_DESC,
    CJK_FACE: CJK_FACE,
    EN_CAP: EN_CAP,
    EN_DESC: EN_DESC,
    ZH_EN_GAP: ZH_EN_GAP,
    NUM_ASC: NUM_ASC,
    STRIPE_RATIO: STRIPE_RATIO,
    contentBox: contentBox,
    arrowGeometry: arrowGeometry,
    bilingualMetrics: bilingualMetrics,
    bilingualAlignX: bilingualAlignX,
    elementMetrics: elementMetrics,
    computeElementWidth: computeElementWidth,
    computeRowWidth: computeRowWidth,
    computeSignWidth: computeSignWidth,
    layoutSign: layoutSign,
    rowFrameRects: rowFrameRects,
    renderElement: renderElement,
    renderSignInto: renderSignInto,
    renderElementStandalone: renderElementStandalone,
  };
})(typeof window !== 'undefined' ? window : globalThis);
