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
});

test('列车后的新图标使用可换色的镂空轮廓，原有候车室和路徽仍可选', () => {
  const context = {};
  runInNewContext(source, context, { filename });
  const library = context.SignIcons;
  const identifiers = Object.keys(library.ALL);
  const expected = ['ship', 'aircraft', 'passenger-ferry', 'helicopter'];
  assert.deepEqual(identifiers.slice(identifiers.indexOf('train') + 1, identifiers.indexOf('waiting')), expected);
  for (const identifier of expected) {
    const icon = library.get(identifier);
    assert.equal(icon.cat, 'service');
    assert.equal(icon.vb, '0 0 120 120');
    assert.match(icon.body, /^<path fill="black" fill-rule="evenodd"/);
    assert.doesNotMatch(icon.body, /<image|href=|url\(/);
  }
  assert.equal(library.get('waiting').name, '候车室');
  assert.equal(library.get('china_railway').name, '中国铁路');
});
