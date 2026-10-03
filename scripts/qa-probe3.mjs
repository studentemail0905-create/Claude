import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto('http://localhost:5173/?debug=1');
await page.waitForTimeout(3000);
await page.click('button[data-a=fly]');
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(1000);
  const r = await page.evaluate(() => {
    const g = window.__nc; const s = g.run.ship;
    const dir = new (g.worldCam.position.constructor)(); g.worldCam.getWorldDirection(dir);
    return { t: s.time.toFixed(2), pitch: (s.env.attitude.pitch * 57.3).toFixed(1), roll: (s.env.attitude.roll * 57.3).toFixed(1), hdg: (s.env.attitude.heading * 57.3).toFixed(1), headP: g.interaction.pitch.toFixed(2), headY: g.interaction.yaw.toFixed(2), camDir: dir.toArray().map((v) => v.toFixed(2)), q: s.quat.toArray().map((v) => v.toFixed(3)), omega: s.omega.toArray().map(v=>v.toFixed(3)), alt: s.env.altitude.toFixed(2), state: g.state, locked: g.input.locked };
  });
  console.log(JSON.stringify(r));
}
await browser.close();
