/**
 * gen-icons.mjs — 从外部 SVG 目录生成 web-app/js/icons.js
 * 用法：node gen-icons.mjs <图标源目录>（含服务设施 *.svg 与 arrows/*.svg）
 * 处理：剥离 defs/clip-path（均为整幅矩形裁剪，视觉无操作）、fill 归一
 * （无 fill 的绘制元素补 fill="black"，#000 变体归一），渲染时 "black" 替换为元素颜色。
 * 另按 ROTATED_VARIANTS 由源图标旋转派生出更多方向变体（如出口向左/向右），
 * 避免在源 SVG 目录里重复维护同一个图形。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const NAMES = {
  // 服务设施
  elevator: '电梯', restroom: '洗手间', accessible_restroom: '无障碍洗手间',
  stairs: '楼梯', tickets: '票务', waiting: '候车室', nursing: '母婴室',
  check_in: '检票', no_entry: '禁止通行', accessible: '无障碍',
  accessible_elevator_platform: '无障碍电梯平台', accessible_passage: '无障碍通道',
  accessible_ramp: '无障碍坡道', metro: '地铁', monorail: '单轨',
  train: '列车', exit: '出口',
  exit_left: '出口（向左）', exit_right: '出口（向右）',
  // 方向箭头（12）
  arrow_up: '向上', arrow_down: '向下', arrow_left: '向左', arrow_right: '向右',
  arrow_left_up: '左上', arrow_right_up: '右上', arrow_right_down: '右下', arrow_left_down: '左下',
  arrow_ahead_left: '前方向左', arrow_ahead_right: '前方向右',
  arrow_back_left: '左行向后', arrow_back_right: '右行向后',
};
/**
 * arrows/ 文件名 → 语义 id。注意：上游源文件的命名与其图形的实际朝向并不一致
 * （如 upright.svg 画的是「前方向右」、downleft.svg 画的是「右行向后」），
 * 本映射按提交的 icons.js 视觉修正结果校准（历史提交 d864911、13f1bec），
 * 不得按文件名字面含义改动——否则再生成会翻转五个箭头的朝向。
 */
const ARROW_IDS = {
  up: 'arrow_up', down: 'arrow_down', left: 'arrow_left', right: 'arrow_right',
  leftup: 'arrow_left_up', upright: 'arrow_ahead_right', rightdown: 'arrow_right_down',
  leftdown: 'arrow_left_down', downleft: 'arrow_back_right', downright: 'arrow_back_left',
  upleft: 'arrow_ahead_left', rightup: 'arrow_right_up',
};

/**
 * 旋转派生变体：源图标 id → { 新图标 id: 顺时针角度（度） }。
 * CRT 导视标准中出口图标可整体旋转以适配不同出站方向，故由 exit 派生左右两向。
 * 角度以 viewBox 中心为旋转中心（正方形图标旋转后仍恰好占满画幅）。
 */
const ROTATED_VARIANTS = {
  exit: { exit_right: 90, exit_left: -90 },
};

function processSvg(file) {
  let svg = readFileSync(file, 'utf8');
  const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1];
  if (!vb) throw new Error('缺少 viewBox: ' + file);
  let body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  body = body.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  body = body.replace(/\s*clip-path="[^"]*"/g, '');
  body = body.replace(/<(path|rect|circle|ellipse|polygon|line)((?:(?!fill=)[^>])*?)(\/?)>/g,
    (m0, tag, attrs, slash) => `<${tag} fill="black"${attrs}${slash}>`);
  body = body.replace(/fill="#000000"/gi, 'fill="black"').replace(/fill="#000"/gi, 'fill="black"');
  if (/url\(#/.test(body)) throw new Error('存在未处理的内部引用: ' + file);
  return { vb, body };
}

/** 数值输出：4 位小数足够，且让生成物 diff 稳定 */
function fmt(v) { return String(Math.round(v * 1e4) / 1e4); }

/**
 * 把 SVG 路径 d 的全部坐标绕 viewBox 中心顺时针旋转 deg 度（纯函数，Node 可测）。
 * 仅支持绝对/相对 M/L/H/V/C 与 Z（图标源只用这些）；H/V 旋转后必然变成斜线，
 * 故统一改写成 L，输出为不含相对坐标的绝对路径。其余命令直接抛错，避免静默失真。
 */
export function rotatePathData(d, vb, deg) {
  const box = String(vb).trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || box.some((n) => !isFinite(n))) throw new Error('viewBox 无法解析: ' + vb);
  const cx = box[0] + box[2] / 2;
  const cy = box[1] + box[3] / 2;
  const phi = (deg * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  function rot(x, y) {
    const dx = x - cx, dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  }
  const toks = String(d).match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
  const parts = [];
  let i = 0, cmd = '', cur = [0, 0], start = [0, 0];
  function emit(p) { parts.push(fmt(p[0]) + ' ' + fmt(p[1]) + ' '); }
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    else if (cmd === 'M') cmd = 'L';         // 隐式重复坐标对
    else if (cmd === 'm') cmd = 'l';
    const rel = cmd !== cmd.toUpperCase();
    const c = cmd.toUpperCase();
    if (c === 'M' || c === 'L') {
      let x = Number(toks[i++]), y = Number(toks[i++]);
      if (rel) { x += cur[0]; y += cur[1]; }
      cur = [x, y];
      if (c === 'M') { start = cur; parts.push('M'); } else { parts.push('L'); }
      emit(rot(x, y));
    } else if (c === 'H' || c === 'V') {
      const v = Number(toks[i++]);
      cur = c === 'H'
        ? [rel ? cur[0] + v : v, cur[1]]
        : [cur[0], rel ? cur[1] + v : v];
      parts.push('L');                        // 旋转后水平/垂直线段多为斜线
      emit(rot(cur[0], cur[1]));
    } else if (c === 'C') {
      const pts = [];
      for (let k = 0; k < 3; k++) {
        let x = Number(toks[i++]), y = Number(toks[i++]);
        if (rel) { x += cur[0]; y += cur[1]; }
        pts.push([x, y]);
      }
      cur = pts[2];
      parts.push('C');
      pts.forEach((p) => emit(rot(p[0], p[1])));
    } else if (c === 'Z') {
      cur = start;
      parts.push('Z');
    } else {
      throw new Error('rotatePathData 不支持的命令: ' + cmd);
    }
  }
  return parts.join('').replace(/ ([A-Z])/g, '$1').trim();
}

/** 旋转 body 内所有 <path> 的 d 属性；其余标记与属性原样保留 */
export function rotateBody(body, vb, deg) {
  return String(body).replace(/(<path\b[^>]*?\bd=")([^"]*)(")/g,
    (m0, head, d, tail) => head + rotatePathData(d, vb, deg) + tail);
}

function main() {
  const srcDir = process.argv[2];
  if (!srcDir) { console.error('用法: node gen-icons.mjs <图标源目录>'); process.exit(1); }

  const icons = {};
  /** 按 ROTATED_VARIANTS 由刚载入的源图标派生方向变体（紧随源图标之后，保持库内顺序可读） */
  function addRotatedVariants(srcId, src) {
    const spec = ROTATED_VARIANTS[srcId];
    if (!spec) return;
    for (const [id, deg] of Object.entries(spec)) {
      const name = NAMES[id];
      if (!name) throw new Error('缺少中文名映射: ' + id);
      icons[id] = { name, cat: src.cat, vb: src.vb, body: rotateBody(src.body, src.vb, deg) };
    }
  }

  for (const f of readdirSync(srcDir)) {
    const full = join(srcDir, f);
    if (!statSync(full).isFile() || !f.toLowerCase().endsWith('.svg')) continue;
    const id = f.replace(/\.svg$/i, '');
    if (['arrow', 'default', 'ellipse', 'placeholder'].includes(id)) continue; // 占位/重复项跳过
    const name = NAMES[id];
    if (!name) throw new Error('缺少中文名映射: ' + id);
    const { vb, body } = processSvg(full);
    const icon = { name, cat: 'service', vb, body };
    icons[id] = icon;
    addRotatedVariants(id, icon);
  }
  const arrowsDir = join(srcDir, 'arrows');
  for (const f of readdirSync(arrowsDir)) {
    if (!f.toLowerCase().endsWith('.svg')) continue;
    const base = f.replace(/\.svg$/i, '');
    if (base === 'metro') continue; // 与根目录 metro.svg 重复
    const id = ARROW_IDS[base];
    if (!id) throw new Error('arrows 下存在未映射文件: ' + f);
    const { vb, body } = processSvg(join(arrowsDir, f));
    const icon = { name: NAMES[id], cat: 'arrows', vb, body };
    icons[id] = icon;
    addRotatedVariants(id, icon);
  }

  const header = `/**
 * icons.js — 图标库数据（由 gen-icons.mjs 从 signmaker-main/icon 生成，勿手工编辑）
 * body 为 <svg> 内部标记；渲染时 fill="black" 替换为元素颜色。
 */
`;
  const out = header +
    '(function (global) {\n  \'use strict\';\n  var ICONS = {\n' +
    Object.entries(icons).map(([id, ic]) =>
      '    ' + JSON.stringify(id) + ': { name: ' + JSON.stringify(ic.name) +
      ', cat: ' + JSON.stringify(ic.cat) + ', vb: ' + JSON.stringify(ic.vb) +
      ', body: ' + JSON.stringify(ic.body) + ' }').join(',\n') +
    '\n  };\n' +
    '  global.SignIcons = {\n    ALL: ICONS,\n' +
    '    CATS: [{ id: "arrows", name: "方向图标" }, { id: "service", name: "服务设施" }],\n' +
    '    get: function (id) { return ICONS[id] || ICONS.elevator; },\n  };\n' +
    '})(typeof window !== "undefined" ? window : globalThis);\n';

  writeFileSync(new URL('./js/icons.js', import.meta.url), out);
  console.log('已生成 js/icons.js，共 ' + Object.keys(icons).length + ' 个图标：' +
    Object.keys(icons).join(', '));
}

// 作为脚本直接运行时才执行生成；被测试 import 时只取纯函数（import 时 argv[1] 是测试运行器）
if (process.argv[1] && /gen-icons\.mjs$/.test(process.argv[1])) main();
