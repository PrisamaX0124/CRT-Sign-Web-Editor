import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const library = new URL('./js/icons.js', import.meta.url);
const transportIcons = [
  ['ship', '码头'],
  ['aircraft', '机场'],
  ['passenger-ferry', '客渡码头'],
  ['helicopter', '直升机场'],
];
const region = /^    \/\/ transport-icons:start\r?\n[\s\S]*?^    \/\/ transport-icons:end/m;
const railway = /^    "china_railway": .*$/m;

function roundedSquare(size, inset) {
  const corner = size / 10;
  const farCorner = size - corner;
  const farEdge = size - inset;
  const radius = corner - inset;
  const arc = 'A' + radius + ' ' + radius + ' 0 0 1 ';
  return [
    'M' + corner + ' ' + inset, 'H' + farCorner, arc + farEdge + ' ' + corner,
    'V' + farCorner, arc + farCorner + ' ' + farEdge,
    'H' + corner, arc + inset + ' ' + farCorner,
    'V' + corner, arc + corner + ' ' + inset, 'Z',
  ].join('');
}

function iconRow(identifier, name, size = 120, transform = 'translate(6 6) scale(0.9)') {
  const file = identifier.replaceAll('_', '-') + '.svg';
  const source = readFileSync(new URL('./assets/transport-icons/' + file, import.meta.url), 'utf8');
  const paths = [...source.matchAll(/<path d="([^"]+)"/g)].map(path => path[1]);
  if (!paths.length) throw new Error('图标缺少轮廓。' + identifier);
  // 边框使用填充路径，使边线随图标一起缩放和换色。
  const frame = roundedSquare(size, 0) + ' ' + roundedSquare(size, size * 3 / 100);
  const body = '<path fill="black" fill-rule="evenodd" d="' + frame + '"/>' +
    '<path fill="black" fill-rule="evenodd" transform="' + transform + '" d="' + paths.join(' ') + '"/>';
  return '    ' + JSON.stringify(identifier) + ': { name: ' + JSON.stringify(name) +
    ', cat: "service", vb: "0 0 ' + size + ' ' + size + '", body: ' + JSON.stringify(body) + ' }';
}

export function generateTransportIcons(previous) {
  const rows = transportIcons.map(([identifier, name]) => iconRow(identifier, name) + ',');
  const lineEnding = previous.includes('\r\n') ? '\r\n' : '\n';
  const section = ['    // transport-icons:start', ...rows, '    // transport-icons:end'].join(lineEnding);
  let generated;
  if (region.test(previous)) {
    generated = previous.replace(region, () => section);
  } else {
    const train = /^    "train": .*,$/m;
    if (!train.test(previous)) throw new Error('找不到列车图标。');
    generated = previous.replace(train, line => line + lineEnding + section);
  }
  if (!railway.test(generated)) throw new Error('找不到中国铁路图标。');
  return generated.replace(railway, () => iconRow('china_railway', '中国铁路', 400, 'translate(60 60) scale(1.4)'));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const previous = readFileSync(library, 'utf8');
  const generated = generateTransportIcons(previous);
  if (previous !== generated) writeFileSync(library, generated);
}
