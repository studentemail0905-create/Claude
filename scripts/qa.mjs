// Browser QA: drives the real game through Playwright/Chromium (SwiftShader WebGL2).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || '/opt/node-tools/node_modules/playwright');
const url = process.env.URL || 'http://localhost:5173/?debug=1';
const out = process.env.OUT || 'qa-shots';
const steps = process.argv[2] || 'menu';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 720) } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(4000);
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const evalg = (fn, arg) => page.evaluate(fn, arg);
if (steps.includes('menu')) await shot('01-menu');
if (steps.includes('fly')) {
  await page.click('button[data-a=fly]');
  await page.waitForTimeout(3000);
  await shot('02-cockpit-start');
  // look around via the debug handle (pointer lock is unavailable headless)
  for (const [name, yaw, pitch] of [['02b-forward', 0, -0.14], ['03-look-left', 1.0, -0.3], ['04-look-right', -1.0, -0.35], ['05-look-overhead', 0, 1.0], ['06-look-down', 0, -0.9], ['07-look-console-left', 0.6, -0.8], ['08-look-console-right', -0.6, -0.8]]) {
    await evalg(([y, p]) => { const g = window.__nc; g.interaction.yaw = y; g.interaction.pitch = p; }, [yaw, pitch]);
    await page.waitForTimeout(800);
    await shot(name);
  }
  await evalg(() => { const g = window.__nc; g.interaction.yaw = 0; g.interaction.pitch = -0.14; });
}
if (steps.includes('bot')) {
  if (process.env.SEED) { await page.click('.seed summary'); await page.fill('.seed input', process.env.SEED); await page.click('button[data-a=seedfly]'); await page.waitForTimeout(2000); }
  else if (!steps.includes('fly')) { await page.click('button[data-a=fly]'); await page.waitForTimeout(2000); await evalg(() => { const g = window.__nc; g.interaction.yaw = 0; g.interaction.pitch = -0.12; }); }
  await evalg((ts) => { const g = window.__nc; g.bot = new window.__BotPilot(g.run); g.timeScale = ts; }, Number(process.env.TS || 1));
  const marks = (process.env.MARKS || '20,45,90,150,240').split(',').map(Number);
  for (const t of marks) {
    for (let i = 0; i < 600; i++) {
      const st = await evalg(() => window.__nc.debugInfo);
      if (st.time >= t || st.ended) break;
      await page.waitForTimeout(500);
    }
    const st = await evalg(() => window.__nc.debugInfo);
    await shot(`bot-t${t}-alt${Math.round(st.alt / 1000)}km`);
    if (st.ended) break;
  }
}
const endState = await evalg(() => window.__nc?.state);
if (endState === 'ending' || endState === 'ended') {
  for (let i = 0; i < 20; i++) { if ((await evalg(() => window.__nc.state)) === 'ended') break; await page.waitForTimeout(500); }
  await page.waitForTimeout(800);
  await shot('end-screen');
  console.log(JSON.stringify(await evalg(() => { const s = window.__nc.run.summary(); return { escaped: s.escaped, failure: s.failure, event: s.event, time: s.time, reward: s.reward?.total, seed: s.seed }; })));
}
const info = await evalg(() => window.__nc ? window.__nc.debugInfo : null);
console.log(JSON.stringify(info));
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
