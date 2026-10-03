import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto(process.env.URL || 'http://localhost:4173/?debug=1');
await page.waitForTimeout(3000);
await page.click('button[data-a=fly]');
await page.waitForTimeout(2000);
// operator error: retract the gear on the runway with hydraulics on, then add full throttle
await page.evaluate(() => { const g = window.__nc; const s = g.run.ship; s.pos.setLength(s.pos.length() + 900); s.vel.copy(s.env.up).multiplyScalar(-80); g.timeScale = 10; });
for (let i = 0; i < 120; i++) { if ((await page.evaluate(() => window.__nc.state)) === 'ended') break; await page.waitForTimeout(500); }
await page.screenshot({ path: 'qa-shots/fail-screen.png' });
console.log(JSON.stringify(await page.evaluate(() => window.__nc.run.summary().failure)));
// restart immediately with R
await page.keyboard.press('KeyR');
await page.waitForTimeout(2500);
console.log(JSON.stringify(await page.evaluate(() => ({ state: window.__nc.state, t: window.__nc.run.time, seed: window.__nc.run.seedStr, runs: window.__nc.save.data.runs }))));
await page.screenshot({ path: 'qa-shots/after-restart.png' });
console.log(logs.join('\n'));
await browser.close();
