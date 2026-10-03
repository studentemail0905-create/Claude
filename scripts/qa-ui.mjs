import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/');
await page.waitForTimeout(3000);
for (const k of ['settings', 'records', 'market']) {
  await page.click(`.screen-menu button[data-a=${k}]`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `qa-shots/ui-${k}.png` });
  await page.click(`.screen-${k} button[data-a=back]`);
  await page.waitForTimeout(400);
}
console.log('errors:', errs);
await browser.close();
