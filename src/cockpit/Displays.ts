import * as THREE from 'three';
import { canvas, MONO } from '../render/textures';
import { RAD, clamp, fmtTime, wrap360 } from '../core/mathutil';
import type { Run } from '../core/Run';
import { BAL } from '../data/Balance';
import { XPDR_MODES } from '../ship/systems/TransponderSystem';
import { JAM_PROFILES } from '../ship/systems/JammerSystem';
import { PLANET } from '../physics/PlanetPhysics';

export type Painter = (g: CanvasRenderingContext2D, w: number, h: number, run: Run, t: number, pal: Palette) => void;

export interface Palette {
  fg: string;
  dim: string;
  warn: string;
  alert: string;
  cyan: string;
  mag: string;
  bg: string;
}

export const PALETTES: Record<string, Palette> = {
  green: { fg: '#8dfca0', dim: '#2f7a40', warn: '#ffc640', alert: '#ff4b3a', cyan: '#7fe6ff', mag: '#ff7aff', bg: '#020805' },
  amber: { fg: '#ffbf5a', dim: '#7a5420', warn: '#fff07a', alert: '#ff4b3a', cyan: '#ffe1a8', mag: '#ff8a6a', bg: '#080502' },
  white: { fg: '#e8eef0', dim: '#5b6468', warn: '#ffd24a', alert: '#ff4b3a', cyan: '#9fe6ff', mag: '#ff9aff', bg: '#050607' },
};

/** A powered screen: canvas → texture on an emissive quad, redrawn at a limited rate. */
export class Display {
  mesh: THREE.Mesh;
  tex: THREE.CanvasTexture;
  g: CanvasRenderingContext2D;
  private c: HTMLCanvasElement;
  private acc = Math.random() * 0.05;
  constructor(public w: number, public h: number, public pxW: number, public pxH: number, public painter: Painter, public hz = 15, public bus: 'AV' | 'EMER' | 'JAM' | 'JUMP' = 'AV') {
    [this.c, this.g] = canvas(pxW, pxH);
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    this.mesh.position.z = 0.003;
  }
  update(dt: number, run: Run, t: number, pal: Palette, powered: boolean, flicker: number): void {
    this.acc += dt;
    if (this.acc < 1 / this.hz) return;
    this.acc = 0;
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = pal.bg;
    g.fillRect(0, 0, this.pxW, this.pxH);
    if (powered && !(flicker > 0 && Math.random() < flicker * 0.5)) {
      g.save();
      if (run.ship.jump.sequence >= 0 || run.ship.elec.noise > 0.3) {
        g.translate((Math.random() - 0.5) * 10 * run.ship.elec.noise, 0);
      }
      this.painter(g, this.pxW, this.pxH, run, t, pal);
      g.restore();
      // scanlines
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 0; y < this.pxH; y += 3) g.fillRect(0, y, this.pxW, 1);
      if (run.ship.comms.static > 0.2 || run.ship.elec.noise > 0.2) {
        const n = Math.max(run.ship.comms.static * 0.3, run.ship.elec.noise);
        g.fillStyle = `rgba(180,255,190,${0.05 * n})`;
        for (let i = 0; i < 200 * n; i++) g.fillRect(Math.random() * this.pxW, Math.random() * this.pxH, 2, 1);
      }
    }
    this.tex.needsUpdate = true;
  }
}

const txt = (g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left') => {
  g.font = `bold ${size}px ${MONO}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(s, x, y);
};

const bar = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string, dim: string) => {
  g.strokeStyle = dim;
  g.lineWidth = 2;
  g.strokeRect(x, y, w, h);
  g.fillStyle = color;
  g.fillRect(x + 2, y + 2, (w - 4) * clamp(frac, 0, 1), h - 4);
};

// ─────────────────────────────────────────────────────────────── PFD
export const drawPFD: Painter = (g, w, h, run, _t, p) => {
  const s = run.ship;
  const e = s.env;
  const cx = w / 2, cy = h * 0.47;
  const R = w * 0.3;
  const pitch = e.attitude.pitch * RAD;
  const roll = e.attitude.roll;
  const ppd = R / 25; // px per degree
  // attitude sphere
  g.save();
  g.beginPath();
  g.rect(cx - R, cy - R, R * 2, R * 2);
  g.clip();
  g.translate(cx, cy);
  g.rotate(-roll);
  g.fillStyle = '#123a5c';
  g.fillRect(-R * 3, -R * 3, R * 6, R * 3 + pitch * ppd);
  g.fillStyle = '#3d2a14';
  g.fillRect(-R * 3, pitch * ppd, R * 6, R * 3);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(-R * 3, pitch * ppd);
  g.lineTo(R * 3, pitch * ppd);
  g.stroke();
  g.lineWidth = 2;
  for (let d = -90; d <= 90; d += 5) {
    if (d === 0) continue;
    const y = (pitch - d) * ppd;
    if (Math.abs(y) > R * 1.2) continue;
    const L = d % 10 === 0 ? R * 0.35 : R * 0.15;
    g.beginPath();
    g.moveTo(-L, y);
    g.lineTo(L, y);
    g.stroke();
    if (d % 10 === 0) {
      txt(g, String(Math.abs(d)), -L - 26, y, 18, '#fff', 'center');
      txt(g, String(Math.abs(d)), L + 26, y, 18, '#fff', 'center');
    }
  }
  // flight path vector
  const fpaDeg = e.flightPathAngle * RAD;
  const trkErr = ((e.track - e.attitude.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  if (e.groundSpeed > 20 || Math.abs(e.vs) > 20) {
    const fx = clamp(trkErr * RAD * ppd, -R, R), fy = (pitch - fpaDeg) * ppd;
    g.strokeStyle = p.fg;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(fx, fy, 9, 0, Math.PI * 2);
    g.moveTo(fx - 22, fy);
    g.lineTo(fx - 9, fy);
    g.moveTo(fx + 9, fy);
    g.lineTo(fx + 22, fy);
    g.moveTo(fx, fy - 9);
    g.lineTo(fx, fy - 18);
    g.stroke();
  }
  g.restore();
  // flight director
  const fd = run.fd;
  if (fd.valid && s.controls.get('fd') === 1) {
    const ex = clamp(fd.errYaw * ppd, -R, R), ey = clamp(-fd.errPitch * ppd, -R, R);
    g.strokeStyle = p.mag;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx + ex, cy - R * 0.6);
    g.lineTo(cx + ex, cy + R * 0.6);
    g.moveTo(cx - R * 0.6, cy + ey);
    g.lineTo(cx + R * 0.6, cy + ey);
    g.stroke();
  }
  // aircraft symbol
  g.strokeStyle = p.warn;
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(cx - R * 0.55, cy);
  g.lineTo(cx - R * 0.18, cy);
  g.lineTo(cx - R * 0.1, cy + 14);
  g.moveTo(cx + R * 0.55, cy);
  g.lineTo(cx + R * 0.18, cy);
  g.lineTo(cx + R * 0.1, cy + 14);
  g.stroke();
  g.fillStyle = p.warn;
  g.fillRect(cx - 4, cy - 4, 8, 8);
  // roll scale
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, R + 14, -Math.PI * 0.83, -Math.PI * 0.17);
  g.stroke();
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const r = (a * Math.PI) / 180 - Math.PI / 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(r) * (R + 14), cy + Math.sin(r) * (R + 14));
    g.lineTo(cx + Math.cos(r) * (R + (a % 30 === 0 ? 30 : 22)), cy + Math.sin(r) * (R + (a % 30 === 0 ? 30 : 22)));
    g.stroke();
  }
  const rr = -roll - Math.PI / 2;
  g.fillStyle = p.warn;
  g.beginPath();
  g.moveTo(cx + Math.cos(rr) * (R + 12), cy + Math.sin(rr) * (R + 12));
  g.lineTo(cx + Math.cos(rr - 0.05) * (R - 6), cy + Math.sin(rr - 0.05) * (R - 6));
  g.lineTo(cx + Math.cos(rr + 0.05) * (R - 6), cy + Math.sin(rr + 0.05) * (R - 6));
  g.fill();

  // speed tape (EAS m/s) left, altitude tape right
  const tape = (x: number, val: number, unit: number, fmt: (v: number) => string, label: string, sub: string) => {
    const th = R * 2;
    g.fillStyle = 'rgba(0,0,0,0.65)';
    g.fillRect(x, cy - R, 92, th);
    g.strokeStyle = p.dim;
    g.strokeRect(x, cy - R, 92, th);
    g.save();
    g.beginPath();
    g.rect(x, cy - R, 92, th);
    g.clip();
    const pxPer = th / (unit * 6);
    const base = Math.floor(val / unit) * unit;
    for (let k = -4; k <= 4; k++) {
      const v = base + k * unit;
      const y = cy - (v - val) * pxPer;
      g.strokeStyle = p.fg;
      g.beginPath();
      g.moveTo(x + 76, y);
      g.lineTo(x + 92, y);
      g.stroke();
      txt(g, fmt(v), x + 70, y, 17, p.fg, 'right');
    }
    g.restore();
    g.fillStyle = '#000';
    g.fillRect(x - 4, cy - 18, 100, 36);
    g.strokeStyle = p.fg;
    g.lineWidth = 2;
    g.strokeRect(x - 4, cy - 18, 100, 36);
    txt(g, fmt(val), x + 46, cy, 24, '#fff', 'center');
    txt(g, label, x + 46, cy - R - 16, 16, p.dim, 'center');
    txt(g, sub, x + 46, cy + R + 16, 17, p.cyan, 'center');
  };
  const eas = e.eas * (1 + s.machine.sensorBias * s.damage.health.sensors);
  tape(10, eas, 20, (v) => String(Math.round(v)), 'EAS M/S', `M ${e.mach.toFixed(2)}`);
  const alt = e.altitude;
  const altUnit = alt < 20_000 ? 500 : 5000;
  tape(w - 102, alt, altUnit, (v) => (v < 20_000 ? String(Math.round(v)) : `${(v / 1000).toFixed(0)}K`), 'ALT M', `VS ${e.vs >= 0 ? '+' : ''}${Math.round(e.vs)}`);
  // heading
  const hdg = wrap360(e.attitude.heading * RAD);
  g.fillStyle = 'rgba(0,0,0,0.7)';
  g.fillRect(cx - R, h - 58, R * 2, 36);
  g.save();
  g.beginPath();
  g.rect(cx - R, h - 58, R * 2, 36);
  g.clip();
  for (let d = -40; d <= 40; d += 5) {
    const hv = Math.round(hdg / 5) * 5 + d;
    const x = cx + (hv - hdg) * 6;
    g.strokeStyle = p.fg;
    g.beginPath();
    g.moveTo(x, h - 58);
    g.lineTo(x, h - (hv % 10 === 0 ? 46 : 52));
    g.stroke();
    if (hv % 10 === 0) txt(g, String(wrap360(hv)).padStart(3, '0'), x, h - 34, 15, p.fg, 'center');
  }
  g.restore();
  txt(g, String(Math.round(hdg)).padStart(3, '0'), cx, h - 76, 22, '#fff', 'center');
  // modes + readouts
  const c = s.controls;
  const fcs = s.fcs;
  const modes = [
    c.get('apMaster') && fcs.apEngaged ? `AP ${['LEGAL', 'INS', 'ESC'][c.get('navSource')]}` : fcs.apDisconnectTimer > 0 ? 'AP DISC' : '',
    fcs.computerOn ? (c.get('fcsMode') ? 'NORM' : 'DIRECT') : 'FCS OFF',
    c.get('sas') && fcs.computerOn ? 'SAS' : 'NO SAS',
    s.rcs.rotEnabled ? (s.rcs.transEnabled ? 'RCS R+T' : 'RCS ROT') : '',
  ];
  modes.forEach((m, i) => m && txt(g, m, 20 + i * (w - 40) / 4, 22, 19, m.includes('OFF') || m.includes('NO') || m.includes('DISC') ? p.warn : p.cyan, 'left'));
  txt(g, `G ${e.nz.toFixed(1)}`, 14, h - 30, 20, Math.abs(e.nz) > s.structureLimits.nz * 0.85 ? p.alert : p.fg);
  txt(g, `AOA ${(e.alpha * RAD).toFixed(1)}`, 14, h - 56, 18, e.stalled ? p.alert : p.fg);
  txt(g, `Q ${(e.q / 1000).toFixed(1)}K`, w - 14, h - 30, 18, e.q > s.structureLimits.q * 0.8 ? p.alert : p.fg, 'right');
  if (e.stalled && e.q > 300) txt(g, 'STALL', cx, cy + R * 0.6, 34, p.alert, 'center');
};

// ─────────────────────────────────────────────────────────────── ND
export const drawND: Painter = (g, w, h, run, t, p) => {
  const s = run.ship;
  const e = s.env;
  const cx = w / 2, cy = h * 0.66;
  const alt = e.altitude;
  const ranges = [10_000, 40_000, 150_000, 600_000, 2_000_000];
  const range = ranges.find((r) => r > Math.max(alt * 4, e.groundSpeed * 60)) ?? 2_000_000;
  const R = h * 0.56;
  const scale = R / range;
  const hdg = e.attitude.heading;
  const toScreen = (world: THREE.Vector3): [number, number] => {
    const d = world.clone().sub(s.pos);
    const east = d.dot(e.east), north = d.dot(e.north);
    const ang = Math.atan2(east, north) - hdg;
    const dist = Math.hypot(east, north);
    return [cx + Math.sin(ang) * dist * scale, cy - Math.cos(ang) * dist * scale];
  };
  // rings
  g.strokeStyle = p.dim;
  g.lineWidth = 2;
  for (const f of [0.5, 1]) {
    g.beginPath();
    g.arc(cx, cy, R * f, Math.PI, 0);
    g.stroke();
  }
  txt(g, `${range >= 1000 ? range / 1000 : range} KM`, cx + R * 0.5 + 6, cy - 12, 15, p.dim);
  // corridor (true or spoofed) — drawn from route samples
  const q = run.fd.routeQ;
  if (q && s.avionics.navReady) {
    g.strokeStyle = p.mag;
    g.lineWidth = 3;
    g.beginPath();
    let first = true;
    const stepPts = Math.max(1, Math.floor(range / 40_000));
    for (let i = Math.max(0, q.index - 20 * stepPts); i < Math.min(run.plan.points.length, q.index + 60 * stepPts); i += stepPts) {
      const wp = run.plan.worldPoint(i).add(s.avionics.spoofOffset);
      const [x, y] = toScreen(wp);
      if (first) g.moveTo(x, y);
      else g.lineTo(x, y);
      first = false;
    }
    g.stroke();
    txt(g, `${run.plan.name}`, 12, 22, 18, p.mag);
  } else txt(g, 'NAV INOP', 12, 22, 18, p.warn);
  // radar sites
  for (const site of run.tracking.sites) {
    const [x, y] = toScreen(site.pos);
    if (Math.hypot(x - cx, y - cy) < R * 1.05) {
      g.strokeStyle = p.warn;
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.stroke();
    }
  }
  // own-ship radar contacts (sensor health limited)
  const sens = s.damage.health.sensors;
  for (const o of run.objects) {
    if (!o.alive || o.kind === 'decoy') continue;
    if (o.pos.distanceTo(s.pos) > range * 1.1) continue;
    const [x, y] = toScreen(o.pos);
    const col = o.kind === 'missile' ? p.alert : o.kind === 'interceptor' || o.kind === 'drone' ? p.warn : p.fg;
    if (Math.random() > sens + 0.2) continue;
    g.fillStyle = col;
    if (o.kind === 'missile') {
      g.beginPath();
      g.moveTo(x, y - 8);
      g.lineTo(x + 6, y + 6);
      g.lineTo(x - 6, y + 6);
      g.fill();
    } else g.fillRect(x - 5, y - 5, 10, 10);
  }
  // ghosts
  for (const il of run.tracking.illum) {
    if (!il.ghost || t - il.time > 3) continue;
    const r2 = R * (0.3 + ((il.time * 7) % 1) * 0.6);
    g.fillStyle = p.warn;
    g.fillRect(cx + Math.sin(il.bearing) * r2 - 5, cy - Math.cos(il.bearing) * r2 - 5, 10, 10);
  }
  // escape vector bearing
  if (s.avionics.escLoaded && s.avionics.navReady) {
    const ev = s.escapeVector;
    const ang = Math.atan2(ev.dot(e.east), ev.dot(e.north)) - hdg;
    const elev = Math.asin(clamp(ev.dot(e.up), -1, 1)) * RAD;
    g.strokeStyle = p.cyan;
    g.setLineDash([8, 6]);
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.sin(ang) * R, cy - Math.cos(ang) * R);
    g.stroke();
    g.setLineDash([]);
    txt(g, `ESC ${Math.round(wrap360((ang + hdg) * RAD))}°/${elev.toFixed(0)}°`, w - 12, 22, 17, p.cyan, 'right');
  }
  // ownship
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(cx, cy - 16);
  g.lineTo(cx + 11, cy + 12);
  g.lineTo(cx, cy + 6);
  g.lineTo(cx - 11, cy + 12);
  g.fill();
  // data block
  const apo = run.summary().apoapsis;
  txt(g, `GS ${Math.round(e.groundSpeed)}  TRK ${String(Math.round(wrap360(e.track * RAD))).padStart(3, '0')}`, 12, h - 70, 17, p.fg);
  if (q && s.avionics.navReady) {
    const lat = q.lateral / 1000, ver = q.vertical / 1000;
    const bad = q.latRatio > 1 || q.vertRatio > 1;
    txt(g, `DEV L ${lat >= 0 ? 'R' : 'L'}${Math.abs(lat).toFixed(1)}  V ${ver >= 0 ? '+' : ''}${ver.toFixed(1)} KM`, 12, h - 46, 17, bad ? p.warn : p.fg);
    txt(g, `ASSIGNED ${(q.assignedAlt / 1000).toFixed(1)} KM  CEIL 85`, 12, h - 22, 15, p.dim);
  }
  txt(g, `APO ${Number.isFinite(apo) ? (Math.max(0, apo) / 1000).toFixed(0) + ' KM' : 'ESC'}`, w - 12, h - 22, 17, p.cyan, 'right');
  if (s.avionics.spoofOffset.lengthSq() > 1 && Math.floor(t * 2) % 2 === 0) txt(g, 'GNSS/INS MISCOMPARE', cx, 50, 18, p.warn, 'center');
};

// ─────────────────────────────────────────────────────────────── EICAS
export const drawEICAS: Painter = (g, w, h, run, _t, p) => {
  const s = run.ship;
  const c = s.controls;
  const arc = (x: number, y: number, r: number, v: number, max: number, label: string, warnAt: number) => {
    g.strokeStyle = p.dim;
    g.lineWidth = 6;
    g.beginPath();
    g.arc(x, y, r, Math.PI * 0.75, Math.PI * 2.25);
    g.stroke();
    const f = clamp(v / max, 0, 1.1);
    g.strokeStyle = v >= warnAt ? p.alert : p.fg;
    g.beginPath();
    g.arc(x, y, r, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * f);
    g.stroke();
    txt(g, label, x, y + r * 0.85, 15, p.dim, 'center');
  };
  for (const [i, id] of (['A', 'B'] as const).entries()) {
    const eng = s.engines[id];
    const x = w * (0.27 + i * 0.46);
    const N = eng.N * 100;
    arc(x, 80, 52, N, 110, 'N %', 105);
    txt(g, N.toFixed(0), x, 80, 28, '#fff', 'center');
    arc(x, 200, 44, eng.temp, 1300, 'EGT °C', BAL.engTempWarn);
    txt(g, eng.temp.toFixed(0), x, 200, 22, eng.temp > BAL.engTempCaution ? p.warn : '#fff', 'center');
    const st = eng.fire > 0 ? 'FIRE' : eng.state.toUpperCase();
    txt(g, `ENG ${id} ${st}`, x, 16, 18, eng.fire > 0 || eng.state === 'flameout' || eng.state === 'failed' ? p.alert : eng.state === 'running' ? p.fg : p.warn, 'center');
    txt(g, `${(eng.thrust / 1000).toFixed(0)} kN`, x, 262, 19, p.fg, 'center');
    txt(g, `FF ${eng.fuelFlow.toFixed(1)}`, x, 284, 16, p.dim, 'center');
    txt(g, `FP ${s.fuel.feed[id].pressure.toFixed(1)} BAR`, x, 304, 16, s.fuel.feed[id].pressure < 0.5 ? p.warn : p.dim, 'center');
  }
  g.strokeStyle = p.dim;
  g.beginPath();
  g.moveTo(10, 322);
  g.lineTo(w - 10, 322);
  g.stroke();
  const lim = ['GEN', '60', '85', '100', '110'][c.get('thrustLimit')];
  txt(g, `LIMIT ${lim}`, 14, 342, 18, lim === '110' ? p.warn : p.cyan);
  txt(g, `FUEL CORE ${Math.round(s.fuel.core)}`, 14, 366, 18, p.fg);
  txt(g, `SVC ${s.sep.moduleAttached ? Math.round(s.fuel.svc) : '---'}`, w - 14, 366, 18, p.fg, 'right');
  txt(g, `${c.get('crossfeed') ? 'XFEED OPEN' : 'XFEED CLSD'}${s.fuel.xferActive ? '  XFER' : ''}${s.fuel.svcRuptured ? '  LEAK' : ''}`, 14, 390, 16, s.fuel.svcRuptured ? p.alert : p.dim);
  txt(g, `COOL A ${(s.thermal.loop.A.capacity * 100).toFixed(0)}% Q${(s.thermal.loop.A.quantity * 100).toFixed(0)}`, 14, 414, 16, s.thermal.loop.A.quantity < 0.4 ? p.warn : p.fg);
  txt(g, `COOL B ${(s.thermal.loop.B.capacity * 100).toFixed(0)}% Q${(s.thermal.loop.B.quantity * 100).toFixed(0)}`, w - 14, 414, 16, s.thermal.loop.B.quantity < 0.4 ? p.warn : p.fg, 'right');
  const ht = s.thermal.hullTemp;
  txt(g, `HULL ${ht.toFixed(0)} K`, 14, 440, 19, ht > BAL.hullCaution ? p.alert : p.fg);
  txt(g, `RCS ${Math.round(s.rcs.propellant)} KG`, w - 14, 440, 17, p.fg, 'right');
  txt(g, `MASS ${(s.massModel.mass / 1000).toFixed(1)} T`, 14, 466, 17, p.dim);
  txt(g, `STRUCT ${(s.damage.health.structure * 100).toFixed(0)}%  LOAD ${(s.structureLoad * 100).toFixed(0)}%`, w - 14, 466, 16, s.structureLoad > 0.9 ? p.alert : p.dim, 'right');
};

// ─────────────────────────────────────────────────────────────── SYSTEMS
export const drawSYS: Painter = (g, w, _h, run, _t, p) => {
  const s = run.ship;
  const E = s.elec;
  txt(g, 'ELEC', 12, 18, 18, p.cyan);
  const busRow = (name: string, v: number, y: number, x = 12) => txt(g, `${name.padEnd(4)}${v.toFixed(1).padStart(5)}V`, x, y, 17, v < 1 ? p.dim : v < 22 ? p.warn : p.fg);
  busRow('A', E.volts.A, 44);
  busRow('B', E.volts.B, 66);
  busRow('AV', E.volts.AV, 88);
  busRow('EMER', E.volts.EMER, 110);
  busRow('CAB', E.volts.CAB, 44, w * 0.5);
  busRow('JAM', E.volts.JAM, 66, w * 0.5);
  busRow('JUMP', E.volts.JUMP, 88, w * 0.5);
  txt(g, `BATT ${(E.battCharge * 100).toFixed(0)}%`, w * 0.5, 110, 17, E.battCharge < 0.3 ? p.warn : p.fg);
  txt(g, `GEN A ${E.genOutput.A.toFixed(0)}kW  B ${E.genOutput.B.toFixed(0)}kW  APU ${E.apuState === 'running' ? 'ON' : E.apuState === 'starting' ? 'ST' : 'OFF'}${E.extConnected && s.controls.get('extpwr') ? '  EXT' : ''}`, 12, 134, 16, p.fg);
  txt(g, `LOAD ${E.totalLoad.toFixed(0)}kW  ${Math.max(E.overloadRatio.A, E.overloadRatio.B) > 1.05 ? 'OVERLOAD' : ''}`, 12, 156, 16, Math.max(E.overloadRatio.A, E.overloadRatio.B) > 1.05 ? p.alert : p.dim);
  const trips = Object.entries(E.tripped).filter(([, v]) => v).map(([k]) => k);
  if (trips.length) txt(g, `TRIP ${trips.join(' ')}`, w - 12, 156, 16, p.alert, 'right');
  if (E.fire.bus) txt(g, `ELEC FIRE BUS ${E.fire.bus}`, w - 12, 18, 18, p.alert, 'right');
  g.strokeStyle = p.dim;
  g.beginPath();
  g.moveTo(10, 172);
  g.lineTo(w - 10, 172);
  g.stroke();
  txt(g, 'HYD', 12, 192, 18, p.cyan);
  for (const [i, id] of (['A', 'B'] as const).entries()) {
    const hc = s.hyd[id];
    const x = 70 + i * (w * 0.45);
    bar(g, x, 182, w * 0.3, 18, hc.pressure / 22, hc.pressure < 10 ? p.warn : p.fg, p.dim);
    txt(g, `${id} ${(hc.pressure * 145).toFixed(0)}PSI Q${(hc.quantity * 100).toFixed(0)}`, x, 214, 15, hc.quantity < 0.5 ? p.warn : p.fg);
  }
  txt(g, `GEAR ${s.gear.pos > 0.98 ? 'DOWN' : s.gear.pos < 0.02 ? 'UP' : 'TRANSIT'}  BRK ${s.gear.brakeTemp.toFixed(0)}°C`, 12, 238, 16, p.fg);
  g.beginPath();
  g.moveTo(10, 252);
  g.lineTo(w - 10, 252);
  g.stroke();
  txt(g, 'PRESS', 12, 272, 18, p.cyan);
  const P = s.press;
  txt(g, `CKPT ${(P.cockpit / 1000).toFixed(1)}kPa ALT ${Math.round(P.cockpitAltitude)}m`, 12, 296, 16, P.cockpit < 57_000 ? p.alert : p.fg);
  txt(g, `CABIN ${s.sep.moduleAttached ? (P.cabin / 1000).toFixed(1) + 'kPa' : '---'}  O2 ${s.controls.get('o2') ? 'FLOW' : 'OFF'} ${(P.o2Quantity * 100).toFixed(0)}%`, 12, 318, 16, p.fg);
  if (P.hypoxia > 0.05) txt(g, `HYPOXIA ${(P.hypoxia * 100).toFixed(0)}%`, w - 12, 272, 17, p.alert, 'right');
  g.beginPath();
  g.moveTo(10, 334);
  g.lineTo(w - 10, 334);
  g.stroke();
  txt(g, 'CABIN / CAPSULES', 12, 354, 18, p.cyan);
  const pax = s.pax;
  pax.pods.forEach((pd, i) => {
    const x = 12 + i * (w - 24) / 4;
    const st = pd.attached ? `${pd.occupants}/10` : pd.outcome === 'pending' ? 'AWAY' : pd.outcome === 'lost' ? 'LOST' : 'OK';
    txt(g, `P${i + 1} ${st}`, x, 378, 15, pd.outcome === 'lost' ? p.alert : p.fg);
    bar(g, x, 390, (w - 24) / 4 - 14, 12, pd.charge, pd.charge < 0.5 ? p.warn : p.fg, p.dim);
  });
  txt(g, `IN CABIN ${pax.inCabin}  ${pax.occupancyClear ? 'OCCUPANCY CLEAR' : ''}`, 12, 422, 16, pax.inCabin > 0 ? p.warn : p.fg);
  g.beginPath();
  g.moveTo(10, 438);
  g.lineTo(w - 10, 438);
  g.stroke();
  const sep = s.sep;
  txt(g, sep.moduleAttached ? `SEP: LOCKS ${sep.lockPos >= 0.99 ? 'REL' : sep.lockPos > 0.01 ? 'MOVING' : 'LOCKED'}  UMB ${s.controls.get('sepElec') ? 'DEAD' : 'LIVE'}  PYRO ${s.controls.get('sepArm') ? 'ARMED' : 'SAFE'}` : `MODULE SEPARATED ${sep.clean ? 'CLEAN' : '— ' + sep.issues.join(', ').toUpperCase()}`, 12, 458, 15, sep.moduleAttached ? p.fg : sep.clean ? p.cyan : p.warn);
  txt(g, `SEP STRUCT LOAD ${(sep.shearRisk * 100).toFixed(0)}%`, 12, 480, 15, sep.shearRisk > 0 ? p.alert : p.dim);
};

// ─────────────────────────────────────────────────────────────── COMMS
export const drawCOMM: Painter = (g, w, h, run, t, p) => {
  const s = run.ship;
  const c = s.controls;
  const fc = run.flightCommand;
  const freq = ['GOV 121.700', 'ALT 133.200', 'EMER 243.000'][c.get('freq')];
  txt(g, freq, 10, 18, 20, p.fg);
  txt(g, `${c.get('tx') ? 'TX' : 'TX OFF'}`, w - 10, 18, 18, c.get('tx') ? p.fg : p.warn, 'right');
  const mode = s.xpdr.mode(s);
  txt(g, `XPDR ${fc.squawk} ${mode}${s.xpdr.forcedOn ? '*' : ''}`, 10, 44, 18, mode === 'OFF' || mode === 'STBY' ? p.warn : p.fg);
  if (s.xpdr.replyFlash > 0.1) {
    g.fillStyle = p.fg;
    g.beginPath();
    g.arc(w - 22, 44, 8, 0, Math.PI * 2);
    g.fill();
  }
  if (s.xpdr.identTimer > 0 && Math.floor(t * 3) % 2 === 0) txt(g, 'ID', w - 46, 44, 16, p.cyan, 'right');
  txt(g, `DLINK ${run.datalinkUp() ? 'UP' : 'DOWN'}  ${fc.callsign.toUpperCase()}`, 10, 68, 16, run.datalinkUp() ? p.dim : p.warn);
  g.strokeStyle = p.dim;
  g.beginPath();
  g.moveTo(6, 82);
  g.lineTo(w - 6, 82);
  g.stroke();
  // wrapped recent messages
  g.font = `bold 15px ${MONO}`;
  const lines: { s: string; col: string }[] = [];
  const maxChars = Math.floor((w - 20) / 9.2);
  for (const m of fc.heard.slice(-4)) {
    const col = m.tone === 'hostile' ? p.alert : m.tone === 'suspicious' ? p.warn : m.tone === 'pa' ? p.mag : p.fg;
    const words = `${m.from}: ${m.text}`.split(' ');
    let cur = '';
    for (const wd of words) {
      if ((cur + ' ' + wd).length > maxChars) {
        lines.push({ s: cur, col });
        cur = wd;
      } else cur = cur ? cur + ' ' + wd : wd;
    }
    lines.push({ s: cur, col });
  }
  const show = lines.slice(-Math.floor((h - 96) / 19));
  show.forEach((l, i) => txt(g, l.s, 10, 100 + i * 19, 15, l.col));
  if (!s.comms.powered(s)) txt(g, 'NO RX', w / 2, h / 2, 24, p.warn, 'center');
};

// ─────────────────────────────────────────────────────────────── JUMP
export const drawJUMP: Painter = (g, w, h, run, t, p) => {
  const s = run.ship;
  const j = s.jump;
  const st = j.stability;
  txt(g, 'FTL DRIVE  MK-IV (UNLICENSED)', 10, 16, 15, p.dim);
  const capX = 14, capY = 34, capW = w * 0.55, capH = 30;
  const frac = j.charge / 1.3;
  bar(g, capX, capY, capW, capH, frac, j.charge > 1.15 ? p.alert : j.charge > j.requiredCharge * 0.98 ? p.cyan : p.fg, p.dim);
  const req = (j.requiredCharge / 1.3) * (capW - 4) + capX + 2;
  g.strokeStyle = p.warn;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(Math.min(capX + capW, req), capY - 6);
  g.lineTo(Math.min(capX + capW, req), capY + capH + 6);
  g.stroke();
  const ov = (1.15 / 1.3) * (capW - 4) + capX + 2;
  g.strokeStyle = p.alert;
  g.beginPath();
  g.moveTo(ov, capY);
  g.lineTo(ov, capY + capH);
  g.stroke();
  txt(g, `CAP ${(j.charge * 100).toFixed(0)}%  REQ ${(j.requiredCharge * 100).toFixed(0)}%${j.requiredCharge > 1.15 ? ' (MASS)' : ''}`, capX, capY + capH + 18, 15, j.requiredCharge > 1.15 ? p.warn : p.fg);
  const S = st.total;
  txt(g, 'FIELD', w * 0.62, 30, 16, p.dim);
  txt(g, j.coilsArmed ? `${(S * 100).toFixed(1)}%` : '---', w * 0.62, 58, 30, S > 0.94 ? p.cyan : S > 0.85 ? p.fg : p.warn);
  const rows: [string, number][] = [['ATM', st.atmosphere], ['ROT', st.rate], ['ALN', st.alignment], ['CHG', st.charge], ['SYN', st.sync], ['TMP', st.coilTemp], ['PWR', st.power], ['COIL', st.coils]];
  rows.forEach(([n, v], i) => {
    const x = 14 + (i % 4) * (w - 28) / 4, y = 108 + Math.floor(i / 4) * 30;
    txt(g, n, x, y, 14, p.dim);
    bar(g, x + 40, y - 8, (w - 28) / 4 - 50, 16, v, v > 0.95 ? p.fg : v > 0.8 ? p.warn : p.alert, p.dim);
  });
  txt(g, `COIL ${j.coilTemp.toFixed(1)} K`, 14, 176, 16, j.coilTemp > 60 ? p.alert : j.coilTemp > 46 ? p.warn : p.fg);
  txt(g, j.synced ? 'SYNC LOCK' : j.syncing ? `SYNC ${(j.syncProgress * 100).toFixed(0)}%` : 'NO SYNC', w * 0.5, 176, 16, j.synced ? p.cyan : p.warn);
  const av = s.avionics;
  const sol = !av.navReady ? 'NAV OFF' : !av.escLoaded ? (av.escLoading > 0 ? 'READING CART' : 'NO VECTOR') : av.solveTimer > 0 ? 'SOLVING...' : av.solutionValid ? `SOL ${av.solutionError(s).toFixed(1)}°` : 'NO SOLUTION';
  txt(g, sol, 14, 200, 16, av.solutionValid ? p.cyan : p.warn);
  txt(g, `ALIGN ${j.alignmentError(s).toFixed(1)}°`, w * 0.5, 200, 16, j.alignmentError(s) < 3 ? p.cyan : p.fg);
  if (j.arcing > 0.3 && Math.floor(t * 8) % 2 === 0) txt(g, 'ARC', w - 14, 30, 22, p.alert, 'right');
  if (j.quenched.A || j.quenched.B) txt(g, `QUENCH ${j.quenched.A ? 'A' : ''}${j.quenched.B ? 'B' : ''}`, w - 14, 176, 15, p.alert, 'right');
  if (s.controls.get('safetyPin') !== 1) txt(g, 'INTERLOCK IN', w - 14, h - 14, 14, p.warn, 'right');
};

// ─────────────────────────────────────────────────────────────── JAMMER (aftermarket)
export const drawJAM: Painter = (g, w, h, run, t, p) => {
  const s = run.ship;
  const jm = s.jammer;
  const c = s.controls;
  const cx = w * 0.28, cy = h * 0.52, R = Math.min(w * 0.25, h * 0.42);
  // RWR scope
  g.strokeStyle = p.dim;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(cx - R, cy);
  g.lineTo(cx + R, cy);
  g.moveTo(cx, cy - R);
  g.lineTo(cx, cy + R);
  g.stroke();
  for (const il of run.tracking.illum) {
    const age = t - il.time;
    if (age > 2.5 || age < 0) continue;
    const a = 1 - age / 2.5;
    const r = R * (il.site === 'ORBITAL' ? 0.15 : 0.85 - il.strength * 0.5);
    const x = cx + Math.sin(il.bearing) * r, y = cy - Math.cos(il.bearing) * r;
    g.globalAlpha = a;
    txt(g, il.site === 'ORBITAL' ? 'O' : il.ghost ? '?' : 'S', x, y, 22, il.detected ? p.alert : p.warn, 'center');
    g.globalAlpha = 1;
  }
  const lock = run.interceptors.lockWarning + run.ghostLock;
  if (lock > 0.3 && Math.floor(t * 6) % 2 === 0) txt(g, lock >= 1 ? 'LOCK' : 'TRACK', cx, cy + R + 16, 18, p.alert, 'center');
  // capacitor / thermal
  const x0 = w * 0.58;
  txt(g, 'CAP', x0, 20, 15, p.dim);
  bar(g, x0 + 40, 10, w * 0.36, 20, jm.cap, jm.cap < 0.15 ? p.warn : p.fg, p.dim);
  txt(g, 'TEMP', x0, 50, 15, p.dim);
  bar(g, x0 + 40, 40, w * 0.36, 20, (jm.temp - 20) / 180, jm.temp > 125 ? p.alert : jm.temp > 95 ? p.warn : p.fg, p.dim);
  txt(g, `${jm.temp.toFixed(0)}C`, w - 8, 72, 15, jm.runaway ? p.alert : p.dim, 'right');
  txt(g, 'FIELD', x0, 80, 15, p.dim);
  bar(g, x0 + 40, 70 + 12, w * 0.36, 14, jm.field / 1.6, p.cyan, p.dim);
  txt(g, JAM_PROFILES[c.get('jamProfile')], x0, 118, 17, p.fg);
  txt(g, jm.destroyed ? 'DESTROYED' : jm.active ? 'MASKING' : c.get('jamArm') ? 'ARMED' : 'SAFE', x0, 142, 18, jm.active ? p.cyan : jm.destroyed ? p.alert : p.dim);
  // threat estimate: a noisy guess of how watched you are
  const est = clamp(run.tracking.trace * (run.flightCommand.alert / 100 + 0.2) + (Math.random() - 0.5) * 0.15, 0, 1);
  txt(g, 'THREAT', x0, 168, 15, p.dim);
  bar(g, x0 + 60, 160, w * 0.3, 16, est, est > 0.6 ? p.alert : est > 0.3 ? p.warn : p.fg, p.dim);
  txt(g, `DECOY ${run.interceptors.decoys}`, x0, h - 12, 15, p.dim);
  if (jm.runaway && Math.floor(t * 5) % 2 === 0) txt(g, 'RUNAWAY', w - 8, h - 12, 16, p.alert, 'right');
};

// ─────────────────────────────────────────────────────────────── small readouts
export const drawClock: Painter = (g, w, h, run, _t, p) => {
  txt(g, 'MET', 10, h / 2, 18, p.dim);
  txt(g, fmtTime(run.time), w - 10, h / 2, 26, p.fg, 'right');
};

export const drawFuelMini: Painter = (g, w, _h, run, _t, p) => {
  const s = run.ship;
  txt(g, 'CORE', 8, 16, 14, p.dim);
  bar(g, 50, 6, w - 60, 18, s.fuel.core / BAL.coreTankCap, p.fg, p.dim);
  txt(g, 'SVC', 8, 42, 14, p.dim);
  bar(g, 50, 32, w - 60, 18, s.sep.moduleAttached ? s.fuel.svc / BAL.svcTankCap : 0, p.fg, p.dim);
  txt(g, `A ${s.fuel.pressA.toFixed(1)}  B ${s.fuel.pressB.toFixed(1)} BAR`, 8, 68, 14, p.fg);
};

export const drawOverheadMini: Painter = (g, w, _h, run, _t, p) => {
  const s = run.ship;
  txt(g, `A ${s.elec.volts.A.toFixed(1)}V B ${s.elec.volts.B.toFixed(1)}V`, 8, 16, 15, p.fg);
  txt(g, `HYD ${(s.hyd.A.pressure * 145).toFixed(0)}/${(s.hyd.B.pressure * 145).toFixed(0)}`, 8, 40, 15, Math.min(s.hyd.A.pressure, s.hyd.B.pressure) < 10 ? p.warn : p.fg);
  txt(g, `CAB ALT ${Math.round(s.press.cockpitAltitude)}`, 8, 64, 15, s.press.cockpit < 60_000 ? p.alert : p.fg);
  void w;
  void PLANET;
};

/** Annunciator cells: label, severity function (0 off, 1 caution amber, 2 warning red). */
export const ANNUNCIATORS: [string, (r: Run) => number][] = [
  ['ENG A FIRE', (r) => (r.ship.engines.A.fire > 0 ? 2 : 0)],
  ['ENG B FIRE', (r) => (r.ship.engines.B.fire > 0 ? 2 : 0)],
  ['ENG A', (r) => (r.ship.engines.A.state === 'flameout' || r.ship.engines.A.state === 'failed' ? 2 : r.ship.engines.A.temp > BAL.engTempCaution ? 1 : 0)],
  ['ENG B', (r) => (r.ship.engines.B.state === 'flameout' || r.ship.engines.B.state === 'failed' ? 2 : r.ship.engines.B.temp > BAL.engTempCaution ? 1 : 0)],
  ['FUEL PRESS', (r) => ((r.ship.engines.A.running && r.ship.fuel.feed.A.pressure < 0.6) || (r.ship.engines.B.running && r.ship.fuel.feed.B.pressure < 0.6) ? 1 : 0)],
  ['FUEL LEAK', (r) => (r.ship.fuel.svcRuptured || r.ship.fuel.leakCore > 0 ? 2 : 0)],
  ['HYD A', (r) => (r.ship.hyd.A.pressure < 10 ? 1 : 0)],
  ['HYD B', (r) => (r.ship.hyd.B.pressure < 10 ? 1 : 0)],
  ['GEN A', (r) => (!r.ship.elec.genOnline.A ? 1 : 0)],
  ['GEN B', (r) => (!r.ship.elec.genOnline.B ? 1 : 0)],
  ['BUS OVLD', (r) => (Math.max(r.ship.elec.overloadRatio.A, r.ship.elec.overloadRatio.B) > 1.1 ? 2 : Object.values(r.ship.elec.tripped).some(Boolean) ? 1 : 0)],
  ['ELEC FIRE', (r) => (r.ship.elec.fire.bus ? 2 : 0)],
  ['STALL', (r) => (r.ship.env.stalled && r.ship.env.q > 300 && !r.ship.env.onGround ? 2 : 0)],
  ['OVER G', (r) => (r.ship.env.nz > r.ship.structureLimits.nz * 0.9 ? 2 : 0)],
  ['Q LIMIT', (r) => (r.ship.env.q > r.ship.structureLimits.q * 0.85 ? 2 : r.ship.env.q > r.ship.structureLimits.q * 0.7 ? 1 : 0)],
  ['HULL TEMP', (r) => (r.ship.thermal.hullTemp > BAL.hullDamage ? 2 : r.ship.thermal.hullTemp > BAL.hullCaution ? 1 : 0)],
  ['CABIN ALT', (r) => (r.ship.press.cockpit < 57_000 ? 2 : r.ship.press.cockpit < 70_000 ? 1 : 0)],
  ['GEAR', (r) => (r.ship.sep.moduleAttached && r.ship.gear.pos < 0.98 && r.ship.env.agl < 300 && r.ship.vel.length() < 140 && !r.ship.env.onGround ? 2 : r.ship.gear.pos > 0.02 && r.ship.gear.pos < 0.98 ? 1 : 0)],
  ['XPDR', (r) => (!r.ship.xpdr.replying(r.ship) ? 1 : 0)],
  ['DATALINK', (r) => (!r.datalinkUp() ? 1 : 0)],
  ['NAV', (r) => (!r.ship.avionics.navReady || r.ship.avionics.spoofOffset.lengthSq() > 1 || r.ship.avionics.clockDesync ? 1 : 0)],
  ['RCS', (r) => (r.ship.rcs.propellant < 100 ? 2 : r.ship.controls.get('rcsMaster') === 1 && !r.ship.rcs.available ? 1 : 0)],
  ['JAM HOT', (r) => (r.ship.jammer.runaway ? 2 : r.ship.jammer.temp > 110 ? 1 : 0)],
  ['JUMP CAP', (r) => (r.ship.jump.charge > 1.15 ? 2 : r.ship.jump.arcing > 0.2 ? 2 : 0)],
  ['COIL TEMP', (r) => (r.ship.jump.coilTemp > 62 ? 2 : r.ship.jump.coilTemp > 48 ? 1 : 0)],
  ['SEP ARMED', (r) => (r.ship.controls.get('sepArm') && r.ship.sep.moduleAttached ? 1 : 0)],
  ['EVAC ARMED', (r) => (r.ship.controls.get('evacArm') && r.ship.sep.moduleAttached ? 1 : 0)],
  ['MSL LOCK', (r) => (r.interceptors.missileInbound ? 2 : r.interceptors.lockWarning > 0.3 || r.ghostLock > 0 ? 1 : 0)],
  ['STRUCT', (r) => (r.ship.damage.health.structure < 0.5 ? 2 : r.ship.structureLoad > 0.9 ? 1 : 0)],
  ['REMOTE NAV', (r) => (r.flightCommand.remoteOverride >= 0 ? 2 : 0)],
];

export const drawAnnunciator = (g: CanvasRenderingContext2D, w: number, h: number, run: Run, t: number, test: boolean, powered: boolean): void => {
  g.fillStyle = '#0b0b0b';
  g.fillRect(0, 0, w, h);
  const cols = 10, rows = 3;
  const cw = w / cols, ch = h / rows;
  ANNUNCIATORS.forEach(([name, fn], i) => {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
    const sev = !powered ? 0 : test ? 2 : fn(run);
    const blink = sev === 2 && Math.floor(t * 3) % 2 === 1;
    g.fillStyle = sev === 2 && !blink ? '#c4251a' : sev >= 1 ? '#c98a12' : '#1d1d1b';
    g.fillRect(x + 3, y + 3, cw - 6, ch - 6);
    g.font = `bold ${Math.floor(ch * 0.34)}px ${MONO}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = sev ? '#fff6e8' : '#4b4b45';
    g.fillText(name, x + cw / 2, y + ch / 2);
  });
};
