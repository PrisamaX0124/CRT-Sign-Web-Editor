/**
 * 从原始TTF生成可经经典script标签加载的数据，支持双击index.html导出。
 * 用法：node gen-export-fonts.mjs
 * fonts/与旧fonts-data.js保持原样；生成的fonts-export/请随项目一起分发。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const source = new URL('./fonts/', import.meta.url);
const output = new URL('./fonts-export/', import.meta.url);
mkdirSync(output, { recursive: true });
for (const file of readdirSync(source).filter(file => /^(MiSans|Frutiger).*\.ttf$/.test(file)).sort()) {
  const data = 'data:font/ttf;base64,' + readFileSync(new URL(file, source)).toString('base64');
  const script = '// 由gen-export-fonts.mjs生成，请勿手工编辑。\n' +
    '(function(g){g.SignExportFontData=g.SignExportFontData||{};g.SignExportFontData[' +
    JSON.stringify(file) + ']=' + JSON.stringify(data) + ';})(typeof window!=="undefined"?window:globalThis);\n';
  writeFileSync(new URL(file + '.js', output), script);
  console.log('生成 fonts-export/' + file + '.js');
}
