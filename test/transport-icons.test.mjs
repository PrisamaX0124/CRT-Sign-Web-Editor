import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { generateTransportIcons } from '../gen-icons.mjs';

const filename = fileURLToPath(new URL('../js/icons.js', import.meta.url));
const source = readFileSync(filename, 'utf8');

test('交通图标可重复生成，旧图标保持原来的次序', () => {
  assert.equal(generateTransportIcons(source), source);
  const previous = source.replace(/^    \/\/ transport-icons:start\r?\n[\s\S]*?^    \/\/ transport-icons:end\r?\n/m, '');
  assert.equal(generateTransportIcons(previous), source);
  assert.throws(() => generateTransportIcons(previous.replace(/^    "train": .*,$/m, '')), /找不到列车图标/);
  assert.throws(() => generateTransportIcons(source.replace(/^    "china_railway": .*$/m, '')), /找不到中国铁路图标/);
});

test('四种交通图标和中国铁路路徽共用同一比例的空心边框', () => {
  const context = {};
  runInNewContext(source, context, { filename });
  const library = context.SignIcons;
  const identifiers = Object.keys(library.ALL);
  const expected = ['ship', 'aircraft', 'passenger-ferry', 'helicopter'];
  assert.deepEqual(identifiers.slice(identifiers.indexOf('train') + 1, identifiers.indexOf('waiting')), expected);
  for (const identifier of [...expected, 'china_railway']) {
    const icon = library.get(identifier);
    const size = identifier === 'china_railway' ? 400 : 120;
    const corner = size / 10;
    const thickness = size * 3 / 100;
    assert.equal(icon.cat, 'service');
    assert.equal(icon.vb, '0 0 ' + size + ' ' + size);
    const paths = Array.from(icon.body.matchAll(/<path fill="black" fill-rule="evenodd"(?: transform="[^"]+")? d="([^"]+)"\/>/g));
    assert.equal(paths.length, 2, '边框和内部图案应分别绘制。' + identifier);
    const outline = paths[0][1];
    assert.ok(outline.startsWith('M' + corner + ' 0H' + (size - corner) + 'A' + corner + ' ' + corner));
    assert.ok(outline.includes('Z M' + corner + ' ' + thickness + 'H' + (size - corner) + 'A' + (corner - thickness) + ' ' + (corner - thickness)));
    assert.doesNotMatch(icon.body, /<image|href=|url\(|non-scaling-stroke/);
  }
  assert.equal(library.get('waiting').name, '候车室');
  assert.equal(library.get('china_railway').name, '中国铁路');
});
