/**
 * gen-icons.mjs 旋转派生 + js/icons.js 生成物一致性测试（Node）
 *
 * 出口图标按 CRT 导视标准由向上版本旋转出向左/向右两个变体，
 * 这些断言把「生成脚本」与「已提交的生成物」锁在一起：
 * 手改 icons.js 或改坏旋转公式都会变红。
 */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotatePathData, rotateBody } from '../gen-icons.mjs';

const load = (p) => (0, eval)(readFileSync(new URL(p, import.meta.url), 'utf8'));
load('../js/icons.js');
const ICONS = globalThis.SignIcons.ALL;

// ─── 旋转纯函数 ────────────────────────────────────────────

test('rotatePathData：绕 viewBox 中心顺时针/逆时针旋转 90°', () => {
  // 中心 (200,200)：顺时针 (x,y) → (400−y, x)，逆时针 (x,y) → (y, 400−x)
  assert.equal(rotatePathData('M0 0L400 0L400 400Z', '0 0 400 400', 90),
    'M400 0L400 400L0 400Z');
  assert.equal(rotatePathData('M0 0L400 0L400 400Z', '0 0 400 400', -90),
    'M0 400L0 0L400 0Z');
});

test('rotatePathData：H/V 改写为 L（水平线旋转后成斜线）', () => {
  assert.equal(rotatePathData('M0 0H400V400Z', '0 0 400 400', 90),
    'M400 0L400 400L0 400Z');
  assert.equal(rotatePathData('M0 0H400V400Z', '0 0 400 400', -90),
    'M0 400L0 0L400 0Z');
});

test('rotatePathData：相对坐标先转绝对再旋转，且四次 90° 回到原位', () => {
  // 'l0 400' 自 (400,0) 出发到 (400,400)，等价绝对路径是 L400 400 而非 L0 400
  assert.equal(rotatePathData('m0 0l400 0l0 400z', '0 0 400 400', 90),
    rotatePathData('M0 0L400 0L400 400Z', '0 0 400 400', 90));
  let d = 'M360 0C382.091 0 400 17.9086 400 40V360C400 382.091 382.091 400 360 400Z';
  for (let i = 0; i < 4; i++) d = rotatePathData(d, '0 0 400 400', 90);
  // 回到原位 = 原路径（H/V 在首轮被改写为 L，其余坐标恰好回到原值：旋转是纯旋转、不缩放）
  assert.equal(d, 'M360 0C382.091 0 400 17.9086 400 40L400 360C400 382.091 382.091 400 360 400Z');
});

test('rotatePathData：非正方形 viewBox 仍绕中心旋转且坐标为有限数', () => {
  const out = rotatePathData('M0 0L80 0L80 40Z', '0 0 80 40', 90);
  out.split(/[A-Z]/).filter(Boolean).forEach((pair) => {
    const [x, y] = pair.trim().split(/\s+/).map(Number);
    assert.ok(isFinite(x) && isFinite(y), '坐标有限: ' + pair);
  });
});

// ─── 生成物与生成脚本一致 ──────────────────────────────────

test('icons.js：出口存在向上/向左/向右三个变体，且同画幅同分类', () => {
  ['exit', 'exit_left', 'exit_right'].forEach((id) => assert.ok(ICONS[id], '缺少图标 ' + id));
  assert.equal(ICONS.exit.name, '出口');
  assert.equal(ICONS.exit_left.name, '出口（向左）');
  assert.equal(ICONS.exit_right.name, '出口（向右）');
  ['exit', 'exit_left', 'exit_right'].forEach((id) => {
    assert.equal(ICONS[id].cat, 'service');
    assert.equal(ICONS[id].vb, ICONS.exit.vb, id + ' 画幅与向上版一致（旋转即覆盖，不需改画幅）');
  });
});

test('icons.js：左/右出口变体 == 向上版按生成脚本旋转的结果', () => {
  const src = ICONS.exit;
  assert.equal(ICONS.exit_right.body, rotateBody(src.body, src.vb, 90));
  assert.equal(ICONS.exit_left.body, rotateBody(src.body, src.vb, -90));
});

test('icons.js：出口箭头方向正确（↑ 的箭尖旋转后朝右/朝左）', () => {
  // 按命令逐点解析（H/V 只带单轴坐标、需沿用当前点补全），
  // 不能把数字流简单两两配对——H/V 的奇数坐标会使后续全部错位
  const pathPoints = (body) => {
    const toks = body.match(/\bd="([^"]*)"/)[1].match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
    const pts = [];
    let i = 0, cmd = '', cur = [0, 0];
    while (i < toks.length) {
      if (/[A-Za-z]/.test(toks[i])) { cmd = toks[i++].toUpperCase(); continue; }
      if (cmd === 'M' || cmd === 'L') {
        cur = [Number(toks[i++]), Number(toks[i++])];
      } else if (cmd === 'H') {
        cur = [Number(toks[i++]), cur[1]];
      } else if (cmd === 'V') {
        cur = [cur[0], Number(toks[i++])];
      } else if (cmd === 'C') {
        for (let k = 0; k < 3; k++) cur = [Number(toks[i++]), Number(toks[i++])];
      } else if (cmd === 'Z') {
        throw new Error('Z 后不应出现坐标: ' + body.slice(0, 60));
      } else {
        throw new Error('未支持的路径命令: ' + cmd);
      }
      pts.push(cur.slice());
    }
    return pts;
  };
  const near = (pts, x, y) => pts.some(([a, b]) => Math.abs(a - x) < 0.01 && Math.abs(b - y) < 0.01);
  // 向上版箭尖 (200,80)；顺时针 90° → (320,200) 朝右；逆时针 90° → (80,200) 朝左
  assert.ok(near(pathPoints(ICONS.exit.body), 200, 80), '向上版箭尖 (200,80)');
  assert.ok(near(pathPoints(ICONS.exit_right.body), 320, 200), '向右版箭尖 (320,200)');
  assert.ok(near(pathPoints(ICONS.exit_left.body), 80, 200), '向左版箭尖 (80,200)');
});

test('icons.js：旋转仅作用于出口，其余图标不受影响', () => {
  assert.equal(ICONS.arrow_up.cat, 'arrows');
  assert.equal(Object.keys(ICONS).filter((id) => id.startsWith('exit')).length, 3);
});
