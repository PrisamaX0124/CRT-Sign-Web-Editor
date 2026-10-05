/* Modified by PrisamaX0124, 2026-10-05: public release data and storage separation; see docs/fork-changes.md. */
/* Modified by PrisamaX0124, 2026-10-05: guidance sign and platform editor enhancements; see docs/fork-changes.md. */
/**
 * core.js — 常量、工具函数、字体度量、文本测量
 *
 * 本文件不依赖 DOM，可在 Node 中直接加载（供单元测试使用）。
 * 领域术语见 CONTEXT.md：标识牌 (Sign) → 行 (Row) → 元素 (Element)。
 */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ─── 领域常量 ──────────────────────────────────────────────

  var EXIT_COLOR = '#F7D917';     // 出口黄（DB31 规范）
  var SUBURBAN_COLOR = '#026AA7'; // 市域机场线
  var GREY_COLOR = '#424A52';     // 灰色
  var SIGN_FRAME_COLOR = '#4A4A4A'; // 新标识牌的默认深灰框
  var LEGACY_SIGN_FRAME_COLOR = '#808080'; // 旧项目缺少灰框颜色时保留原有显示
  var SIGN_GRID_SIZE = 256;      // 服务器贴图的一格；宽度不随行高变化
  var DEFAULT_ROW_HEIGHT = 192;  // 单行标识牌默认0.75格

  // ─── 城市线路配色 ──────────────────────────────────────────
  // 硬编码不依赖运行时加载。数字线路色供「输入线路号自动配色」与选色板共用；
  // 选色板由 citySwatches(city) 派生：按颜色去重合并（重复色并入首见色块），
  // 后接城市附加色与通用色（出口黄/灰/黑/白，不随城市变化）。

  // 上海地铁线路色（源自 colors.csv）
  var SHANGHAI_LINES = [
    { line: '1',  bg: '#E3002B', fg: '#FFFFFF' },
    { line: '2',  bg: '#82BF25', fg: '#000000' },
    { line: '3',  bg: '#FCD600', fg: '#000000' },
    { line: '4',  bg: '#461D84', fg: '#FFFFFF' },
    { line: '5',  bg: '#944D9A', fg: '#FFFFFF' },
    { line: '6',  bg: '#D40068', fg: '#FFFFFF' },
    { line: '7',  bg: '#ED6F00', fg: '#000000' },
    { line: '8',  bg: '#0094D8', fg: '#FFFFFF' },
    { line: '9',  bg: '#87CAED', fg: '#000000' },
    { line: '10', bg: '#C6AFD4', fg: '#000000' },
    { line: '11', bg: '#871C2B', fg: '#FFFFFF' },
    { line: '12', bg: '#007A60', fg: '#FFFFFF' },
    { line: '13', bg: '#E999C0', fg: '#000000' },
    { line: '14', bg: '#626020', fg: '#FFFFFF' },
    { line: '15', bg: '#BCA886', fg: '#000000' },
    { line: '16', bg: '#98D1C0', fg: '#000000' },
    { line: '17', bg: '#BC796F', fg: '#FFFFFF' },
    { line: '18', bg: '#C4984F', fg: '#000000' },
    { line: '19', bg: '#F5AB78', fg: '#000000' },
    { line: '20', bg: '#009F65', fg: '#FFFFFF' },
    { line: '21', bg: '#F7AF00', fg: '#000000' },
    { line: '22', bg: '#5F376F', fg: '#FFFFFF' },
    { line: '23', bg: '#B0D478', fg: '#000000' },
  ];
  var SHANGHAI_EXTRAS = [
    { name: '机场线', bg: SUBURBAN_COLOR },
    { name: '嘉闵线', bg: '#724A57' },
    { name: '南汇线', bg: '#93ABBB' },
    { name: '示范区线', bg: '#6FB16B' },
    { name: '南枫线', bg: '#4C6DA9' },
    { name: '奉贤线', bg: '#F6AE54' },
    { name: '浦江线', bg: '#B5B5B6' },
  ];

  // 重庆地铁线路色（线网规划）。15/19–28 号线及江跳线等多条市域线共用
  // 潘通 2935C 蓝，选色板合并为一个色块（name 覆盖默认「N号线」提示）。
  var CHONGQING_LINES = [
    { line: '1',  bg: '#E4002B' },
    { line: '2',  bg: '#007A33' },
    { line: '3',  bg: '#003DA5' },
    { line: '4',  bg: '#DC8633' },
    { line: '5',  bg: '#00A3E0' },
    { line: '6',  bg: '#F67599' },
    { line: '7',  bg: '#008C95' },
    { line: '8',  bg: '#7A9A01' },
    { line: '9',  bg: '#862041' },
    { line: '10', bg: '#5F249F' },
    { line: '11', bg: '#D986BA' },
    { line: '12', bg: '#D2D755' },
    { line: '13', bg: '#B89D18' },
    { line: '14', bg: '#B94700' },
    { line: '15', bg: '#0057B7', name: '潘通2935C蓝' },
    { line: '16', bg: '#B04A5A' },
    { line: '17', bg: '#9F5CC0' },
    { line: '18', bg: '#2CD5C4' },
    { line: '19', bg: '#0057B7' },
    { line: '20', bg: '#0057B7' },
    { line: '21', bg: '#309B42' },
    { line: '22', bg: '#2F6F7A' },
    { line: '23', bg: '#93C90F' },
    { line: '24', bg: '#D7A048' },
    { line: '25', bg: '#8A75D1' },
    { line: '26', bg: '#0057B7' },
    { line: '27', bg: '#0057B7' },
    { line: '28', bg: '#0057B7' },
    { line: '29', bg: '#FF585D' },
  ];
  var CHONGQING_EXTRAS = [
    { name: '环线', bg: '#F2A900' },
  ];

  // 成都地铁线路色。无 24/25/31 号线；S 线与蓉 2 号线无法以纯数字录入
  // （线路号输入框仅收数字），归入附加色块，仅供选色。
  var CHENGDU_LINES = [
    { line: '1',  bg: '#222A8C' },
    { line: '2',  bg: '#EB5A35' },
    { line: '3',  bg: '#D5006A' },
    { line: '4',  bg: '#00AA58' },
    { line: '5',  bg: '#A23E92' },
    { line: '6',  bg: '#BE7331' },
    { line: '7',  bg: '#6DC6D6' },
    { line: '8',  bg: '#A6C214' },
    { line: '9',  bg: '#F1AD17' },
    { line: '10', bg: '#0050A3' },
    { line: '11', bg: '#8C7732' },
    { line: '12', bg: '#772583' },
    { line: '13', bg: '#C5A900' },
    { line: '14', bg: '#6F263D' },
    { line: '15', bg: '#D958A0' },
    { line: '16', bg: '#0085CA' },
    { line: '17', bg: '#80E0AA' },
    { line: '18', bg: '#006268' },
    { line: '19', bg: '#89ABE3' },
    { line: '20', bg: '#B86125' },
    { line: '21', bg: '#FFC27B' },
    { line: '22', bg: '#6AD1E3' },
    { line: '23', bg: '#DFA0C9' },
    { line: '26', bg: '#43B02A' },
    { line: '27', bg: '#00A3E0' },
    { line: '28', bg: '#9678D3' },
    { line: '29', bg: '#7C78FF' },
    { line: '30', bg: '#F67599' },
    { line: '32', bg: '#003DA5' },
    { line: '33', bg: '#8EDD65' },
  ];
  var CHENGDU_EXTRAS = [
    { name: 'S1线/新都金堂线', bg: '#A4D65E' },
    { name: 'S2线/金堂空港线', bg: '#C98BDB' },
    { name: 'S3线/资阳东线', bg: '#75787B' },
    { name: 'S4线/龙泉驿淮州线', bg: '#97D700' },
    { name: 'S5线/眉山仁寿线', bg: '#5C88DA' },
    { name: 'S6线/新津蒲江线', bg: '#A05088' },
    { name: 'S7线/新津南线', bg: '#00CC78' },
    { name: 'S8线/新津安仁线', bg: '#007CCC' },
    { name: 'S9线/温江都江堰线', bg: '#539A58' },
    { name: 'S10线/新都广汉线', bg: '#C0FA08' },
    { name: 'S11线/德阳罗江线', bg: '#737B4C' },
    { name: 'S12线/成华旌阳线', bg: '#0050A0' },
    { name: 'S13线/龙泉天府机场线', bg: '#C55C64' },
    { name: 'S14线/天府简阳线', bg: '#B8B800' },
    { name: 'S15线/东南环线', bg: '#0080FF' },
    { name: 'S16线/眉山青神线', bg: '#FF8800' },
    { name: 'S17线/资阳西线', bg: '#059370' },
    { name: 'S18线/新津北线', bg: '#00BAF8' },
    { name: '蓉2号线', bg: '#7F9F3A' },
  ];

  // 通用色：出口黄与黑白灰，不随城市变化
  var UNIVERSAL_SWATCHES = [
    { name: '出口黄', bg: EXIT_COLOR },
    { name: '灰', bg: GREY_COLOR },
    { name: '黑', bg: '#000000' },
    { name: '白', bg: '#FFFFFF' },
  ];

  var CITY_PALETTES = {
    shanghai:  { name: '上海', lines: SHANGHAI_LINES,  extras: SHANGHAI_EXTRAS },
    chongqing: { name: '重庆', lines: CHONGQING_LINES, extras: CHONGQING_EXTRAS },
    chengdu:   { name: '成都', lines: CHENGDU_LINES,   extras: CHENGDU_EXTRAS },
  };
  var PALETTE_CITY_ORDER = ['shanghai', 'chongqing', 'chengdu'];
  var DEFAULT_CITY = 'shanghai';

  // 兼容别名（历史导出，外部测试在用）
  var LINE_COLORS = SHANGHAI_LINES;
  var EXTRA_SWATCHES = SHANGHAI_EXTRAS.concat(UNIVERSAL_SWATCHES);

  // ─── 字体族 ────────────────────────────────────────────────

  var FONT_ZH = "'MiSans', 'Microsoft YaHei', sans-serif";
  var FONT_EN = FONT_ZH;
  // 大文本/编号字体栈：Frutiger优先，无字形时回退MiSans。
  var FONT_NUM = "'Frutiger', 'MiSans', Arial, sans-serif";
  var FONT_NUM_CONDENSED = "'Frutiger Condensed', 'Frutiger', Arial, sans-serif";

  // 参考实现的旧度量常数，仅保留兼容；当前基线由实际文字墨区测量计算。
  var FONT_METRICS = { zhAsc: 1.16, enAsc: 0.9277, numAsc: 0.75 };

  // 预加载编辑器实际使用的字体面；旧的编号粗体/窄体声明仅保留兼容。
  var FONT_LOAD_SPECS = [
    { css: '400 32px "MiSans"', key: 'zh400' },
    { css: '600 32px "MiSans"', key: 'zh600' },
    { css: '700 32px "MiSans"', key: 'zh700' },
    { css: '400 32px Frutiger', key: 'num400' },
  ];

  // ─── 通用工具 ──────────────────────────────────────────────

  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  var HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

  function isHexColor(s) {
    return typeof s === 'string' && HEX_RE.test(s.trim());
  }

  /** 规范化为 #RRGGBB 大写；无效输入返回 null */
  function normalizeHex(s) {
    if (!isHexColor(s)) return null;
    var h = s.trim().slice(1);
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    return '#' + h.toUpperCase();
  }

  /** 相对亮度（WCAG），输入 #RRGGBB */
  function luminance(hex) {
    var h = normalizeHex(hex) || '#000000';
    var r = parseInt(h.slice(1, 3), 16) / 255;
    var g = parseInt(h.slice(3, 5), 16) / 255;
    var b = parseInt(h.slice(5, 7), 16) / 255;
    var f = function (c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  /** 按亮度自动选择黑/白前景色，保证色块文字可读 */
  function contrastTextColor(bg) {
    return luminance(bg) > 0.45 ? '#000000' : '#FFFFFF';
  }

  /** 按线路号查询指定城市（缺省上海）的线路色；未命中返回 null */
  function lineColorFor(numberStr, city) {
    var def = CITY_PALETTES[city] || CITY_PALETTES[DEFAULT_CITY];
    var s = String(numberStr);
    for (var i = 0; i < def.lines.length; i++) {
      if (def.lines[i].line === s) return def.lines[i];
    }
    return null;
  }

  /**
   * 城市选色板（纯函数）：数字线路色按颜色去重（重复色并入首见色块，
   * 见重庆「潘通2935C蓝」），后接城市附加色与通用色。
   * 返回 [{ name, bg }]，name 用作悬浮提示。
   */
  function citySwatches(city) {
    var def = CITY_PALETTES[city] || CITY_PALETTES[DEFAULT_CITY];
    var out = [];
    var seen = {};
    function push(name, bg) {
      if (seen[bg]) return;
      seen[bg] = true;
      out.push({ name: name, bg: bg });
    }
    def.lines.forEach(function (c) { push(c.name || (c.line + '号线'), c.bg); });
    def.extras.forEach(function (c) { push(c.name, c.bg); });
    (def.universal || UNIVERSAL_SWATCHES).forEach(function (c) { push(c.name, c.bg); });
    return out;
  }

  // ─── 文本测量 ──────────────────────────────────────────────

  /**
   * 创建基于 Canvas 2D 的文本宽度测量器。
   * 返回 measure(text, family, weight, sizePx) → px 宽度；
   * measure.ascent(text, ...) → 墨区上升高（墨顶到基线），用于墨区顶对齐。
   * family 传入完整 font-family 栈（含引号）。
   */
  function createCanvasMeasurer() {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    var measure = function (text, family, weight, sizePx) {
      if (!text) return 0;
      ctx.font = weight + ' ' + sizePx + 'px ' + family;
      return Math.ceil(ctx.measureText(text).width);
    };
    // 不支持 actualBoundingBoxAscent 的环境按 0.75em 估算
    measure.ascent = function (text, family, weight, sizePx) {
      if (!text) return 0;
      ctx.font = weight + ' ' + sizePx + 'px ' + family;
      var tm = ctx.measureText(text);
      var a = tm.actualBoundingBoxAscent;
      return Math.ceil(typeof a === 'number' && a > 0 ? a : sizePx * 0.75);
    };
    /** 墨区下伸（基线以下的墨区深度，实际墨区测量） */
    measure.descent = function (text, family, weight, sizePx) {
      if (!text) return 0;
      ctx.font = weight + ' ' + sizePx + 'px ' + family;
      var tm = ctx.measureText(text);
      var d = tm.actualBoundingBoxDescent;
      return typeof d === 'number' ? d : sizePx * 0.2;
    };
    /**
     * 墨区度量：abl/abr 为墨区相对原点的左/右缘（abl 向左为正，数字通常为负 = 左字肩），
     * adv 为字距宽度。用于按墨区（而非等宽字距）设计数字间距。
     */
    measure.ink = function (text, family, weight, sizePx) {
      if (!text) return { abl: 0, abr: 0, adv: 0 };
      ctx.font = weight + ' ' + sizePx + 'px ' + family;
      var tm = ctx.measureText(text);
      var has = typeof tm.actualBoundingBoxLeft === 'number';
      return {
        abl: has ? tm.actualBoundingBoxLeft : -sizePx * 0.05,
        abr: has ? tm.actualBoundingBoxRight : sizePx * 0.85,
        adv: tm.width,
      };
    };
    return measure;
  }

  global.SignCore = {
    SVG_NS: SVG_NS,
    EXIT_COLOR: EXIT_COLOR,
    SIGN_FRAME_COLOR: SIGN_FRAME_COLOR,
    LEGACY_SIGN_FRAME_COLOR: LEGACY_SIGN_FRAME_COLOR,
    SIGN_GRID_SIZE: SIGN_GRID_SIZE,
    DEFAULT_ROW_HEIGHT: DEFAULT_ROW_HEIGHT,
    SUBURBAN_COLOR: SUBURBAN_COLOR,
    GREY_COLOR: GREY_COLOR,
    LINE_COLORS: LINE_COLORS,
    EXTRA_SWATCHES: EXTRA_SWATCHES,
    CITY_PALETTES: CITY_PALETTES,
    PALETTE_CITY_ORDER: PALETTE_CITY_ORDER,
    DEFAULT_CITY: DEFAULT_CITY,
    UNIVERSAL_SWATCHES: UNIVERSAL_SWATCHES,
    FONT_ZH: FONT_ZH,
    FONT_EN: FONT_EN,
    FONT_NUM: FONT_NUM,
    FONT_NUM_CONDENSED: FONT_NUM_CONDENSED,
    FONT_METRICS: FONT_METRICS,
    FONT_LOAD_SPECS: FONT_LOAD_SPECS,
    uuid: uuid,
    clamp: clamp,
    deepClone: deepClone,
    isHexColor: isHexColor,
    normalizeHex: normalizeHex,
    luminance: luminance,
    contrastTextColor: contrastTextColor,
    lineColorFor: lineColorFor,
    citySwatches: citySwatches,
    createCanvasMeasurer: createCanvasMeasurer,
  };
})(typeof window !== 'undefined' ? window : globalThis);
