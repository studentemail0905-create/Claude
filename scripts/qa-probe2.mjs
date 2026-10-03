import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
await page.goto('http://localhost:5173/?debug=1');
await page.waitForTimeout(3000);
await page.evaluate(() => { document.getElementById('ui').style.display = 'none'; });
const variants = {
  b: 'gl_FragColor = vec4(vec3(b / 6371.0 * 0.5 + 0.5), 0.0);',
  camR: 'gl_FragColor = vec4(vec3(uCamR / 10000.0), 0.0);',
  camH: 'gl_FragColor = vec4(vec3(uCamH * 10.0), 0.0);',
  disc: 'float cc = (uCamH - 100.0) * (uCamR + R + 100.0); gl_FragColor = vec4(vec3(-cc / 2e6), 0.0);',
  disc2: 'float cc = (uCamH - 100.0) * (uCamR + R + 100.0); float dd = b*b - cc; gl_FragColor = vec4(vec3(dd / 4e7), 0.0);',
};
const orig = await page.evaluate(() => window.__nc.planet.material.fragmentShader);
for (const [k, v] of Object.entries(variants)) {
  await page.evaluate(([o, v]) => { const m = window.__nc.planet.material; m.fragmentShader = o.replace('gl_FragColor = vec4(col, alpha);', v); m.needsUpdate = true; }, [orig, v]);
  await page.waitForTimeout(1200);
  const px = await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
    const g = t.getContext('2d'); g.drawImage(c, 0, 0);
    const d = g.getImageData(Math.floor(c.width * 0.8), Math.floor(c.height * 0.1), 1, 1).data;
    const d2 = g.getImageData(Math.floor(c.width * 0.8), Math.floor(c.height * 0.9), 1, 1).data;
    return [Array.from(d), Array.from(d2)];
  });
  console.log(k, JSON.stringify(px));
  await page.screenshot({ path: `qa-shots/probe-${k}.png` });
}
await browser.close();
