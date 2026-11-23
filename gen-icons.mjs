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
const frame = 'M12 0H108A12 12 0 0 1 120 12V108A12 12 0 0 1 108 120H12A12 12 0 0 1 0 108V12A12 12 0 0 1 12 0Z';
const region = /^    \/\/ transport-icons:start\r?\n[\s\S]*?^    \/\/ transport-icons:end/m;

export function generateTransportIcons(previous) {
  const rows = transportIcons.map(([identifier, name]) => {
    const source = readFileSync(new URL('./assets/transport-icons/' + identifier + '.svg', import.meta.url), 'utf8');
    const paths = [...source.matchAll(/<path d="([^"]+)"/g)].map(path => path[1]);
    if (!paths.length) throw new Error('图标缺少轮廓。' + identifier);
    const body = '<path fill="black" fill-rule="evenodd" d="' + [frame, ...paths].join(' ') + '"/>';
    return '    ' + JSON.stringify(identifier) + ': { name: ' + JSON.stringify(name) +
      ', cat: "service", vb: "0 0 120 120", body: ' + JSON.stringify(body) + ' },';
  });
  const lineEnding = previous.includes('\r\n') ? '\r\n' : '\n';
  const section = ['    // transport-icons:start', ...rows, '    // transport-icons:end'].join(lineEnding);
  if (region.test(previous)) return previous.replace(region, () => section);
  const train = /^    "train": .*,$/m;
  if (!train.test(previous)) throw new Error('找不到列车图标。');
  return previous.replace(train, line => line + lineEnding + section);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const previous = readFileSync(library, 'utf8');
  const generated = generateTransportIcons(previous);
  if (previous !== generated) writeFileSync(library, generated);
}
