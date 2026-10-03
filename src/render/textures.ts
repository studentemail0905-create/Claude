import * as THREE from 'three';

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function canvasTexture(c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let seed = 99;
export const prand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

/** Grungy painted-metal texture (wear, scratches, grime) used on all panels. */
export function wornMetal(w: number, h: number, base: string, wear = 1): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  // mottling
  for (let i = 0; i < (w * h) / 900; i++) {
    const x = prand() * w, y = prand() * h, r = 4 + prand() * 30;
    g.fillStyle = `rgba(${prand() < 0.5 ? '0,0,0' : '255,255,255'},${0.015 + prand() * 0.025})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // scratches
  g.lineWidth = 1;
  for (let i = 0; i < (w * h) / 6000 * wear; i++) {
    const x = prand() * w, y = prand() * h, a = prand() * Math.PI, l = 5 + prand() * 40;
    g.strokeStyle = `rgba(200,200,190,${0.05 + prand() * 0.12})`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // edge grime
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(0,0,0,0.15)');
  grd.addColorStop(0.08, 'rgba(0,0,0,0)');
  grd.addColorStop(0.92, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  return c;
}

export function screw(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  grd.addColorStop(0, '#9a9a92');
  grd.addColorStop(1, '#3a3a36');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#222';
  g.lineWidth = Math.max(1, r * 0.25);
  const a = prand() * Math.PI;
  g.beginPath();
  g.moveTo(x - Math.cos(a) * r * 0.7, y - Math.sin(a) * r * 0.7);
  g.lineTo(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7);
  g.stroke();
}

export function hazardStripes(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s = 14): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#d8b218';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#151515';
  for (let i = -h; i < w + h; i += s * 2) {
    g.beginPath();
    g.moveTo(x + i, y);
    g.lineTo(x + i + s, y);
    g.lineTo(x + i + s - h, y + h);
    g.lineTo(x + i - h, y + h);
    g.closePath();
    g.fill();
  }
  g.restore();
}

export const FONT = '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif';
export const MONO = '"DejaVu Sans Mono", "Consolas", "Courier New", monospace';

export function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = '#e8e4d8', align: CanvasTextAlign = 'center', weight = 'bold'): void {
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, x, y);
}

/** Panel paint colour themes (cosmetic). */
export const PAINTS: Record<string, string> = {
  paint_standard: '#3d4044',
  paint_olive: '#3d4231',
  paint_oxblood: '#4a2726',
  paint_sand: '#5a5040',
};
