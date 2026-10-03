import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 400)}`));
await page.goto('http://localhost:5173/?debug=1');
await page.waitForTimeout(3500);
const r = await page.evaluate(() => {
  const g = window.__nc;
  const u = g.planet.material.uniforms;
  const out = {};
  for (const k of Object.keys(u)) { const v = u[k].value; out[k] = v && v.toArray ? v.toArray().slice(0, 4) : v; }
  const gl = g.renderer.getContext();
  const prog = g.renderer.info.programs?.map((p) => p.name + ':' + p.usedTimes);
  return { out, prog, err: gl.getError() };
});
console.log(JSON.stringify(r, null, 0).slice(0, 2000));
// variant: force red
await page.evaluate(() => {
  const m = window.__nc.planet.material;
  m.fragmentShader = m.fragmentShader.replace('gl_FragColor = vec4(col, alpha);', 'gl_FragColor = vec4(1.0, 0.0, 0.0, 0.0);');
  m.needsUpdate = true;
});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'qa-shots/probe-red.png' });
console.log(logs.join('\n').slice(0, 3000));
await browser.close();
