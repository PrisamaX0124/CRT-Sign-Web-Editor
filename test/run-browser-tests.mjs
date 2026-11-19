import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CRT_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CRT_BROWSER_PATH ? { executablePath: process.env.CRT_BROWSER_PATH } : {}) });
const pages = process.argv.slice(2);
if (!pages.length) pages.push('test.html', 'e2e.html', 'platform-test.html', ...readdirSync(new URL('.', import.meta.url)).filter(name => name.endsWith('.html')).map(name => 'test/' + name));
const results = [];
try {
  for (const address of pages) {
    console.log(JSON.stringify({ address, state: '开始' }));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
    try {
      await page.goto((process.env.CRT_TEST_ADDRESS || 'http://127.0.0.1:8000/') + address);
      await page.waitForFunction(() => /^[✔✖]/.test(document.title), null, { timeout: 180000 });
      const result = await page.evaluate(() => ({ title: document.title, summary: document.getElementById('summary')?.textContent, failures: [...document.querySelectorAll('.fail')].map(element => element.textContent) }));
      result.address = address; result.errors = errors; result.passed = result.title.startsWith('✔') && !errors.length;
      results.push(result); console.log(JSON.stringify(result));
    } catch (error) { results.push({ address, passed: false }); console.log(JSON.stringify({ address, error: error.message, errors })); }
    finally { await context.close(); }
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ pages: results.length, passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length }));
if (results.some(result => !result.passed)) process.exitCode = 1;
