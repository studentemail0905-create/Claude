import { Vector3 } from 'three';
import { RNG } from '../core/RNG';
import { clamp01, lerp, smoothstep } from '../core/mathutil';

/** Integer hash shared bit-for-bit with the GLSL cloud shader. */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

export function valueNoise3(px: number, py: number, pz: number, seed: number): number {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = px - ix, fy = py - iy, fz = pz - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const n = (a: number, b: number, c: number) => hash3(ix + a, iy + b, iz + c, seed);
  const x00 = lerp(n(0, 0, 0), n(1, 0, 0), ux);
  const x10 = lerp(n(0, 1, 0), n(1, 1, 0), ux);
  const x01 = lerp(n(0, 0, 1), n(1, 0, 1), ux);
  const x11 = lerp(n(0, 1, 1), n(1, 1, 1), ux);
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz);
}

/** Cloud coverage 0..1 at a surface direction (unit vector, planet frame). Mirrors shader cloudDensity(). */
export function cloudCoverage(dir: Vector3, seed: number, coverage: number): number {
  // scales in "units per planet radius": 6371 km / s
  let f = 0;
  let amp = 0.5;
  let s = 900; // ~7 km features
  for (let i = 0; i < 4; i++) {
    f += amp * valueNoise3(dir.x * s, dir.y * s, dir.z * s, seed + i * 101);
    s *= 2.3;
    amp *= 0.5;
  }
  const big = valueNoise3(dir.x * 120, dir.y * 120, dir.z * 120, seed + 7);
  return smoothstep(1 - coverage, 1 - coverage + 0.22, f * 0.8 + big * 0.35);
}

export interface WorldRoll {
  windDir: number; // radians, direction wind blows FROM (met convention)
  windSpeed: number; // surface m/s
  gustiness: number;
  jetSpeed: number;
  jetDir: number;
  jetAlt: number;
  catIntensity: number; // clear air turbulence near jet
  boundaryTurb: number;
  cloudCover: number;
  cloudBase: number;
  cloudTop: number;
  cloudSeed: number;
  highCloudCover: number;
}

export function rollWorld(rng: RNG): WorldRoll {
  const r = rng.fork('world');
  const cloudBase = r.range(1800, 3200);
  return {
    windDir: r.range(0, Math.PI * 2),
    windSpeed: r.range(0, 13),
    gustiness: r.range(0.2, 1),
    jetSpeed: r.range(22, 62),
    jetDir: r.range(Math.PI * 1.2, Math.PI * 1.8),
    jetAlt: r.range(9500, 12500),
    catIntensity: r.range(0, 1),
    boundaryTurb: r.range(0.15, 0.9),
    cloudCover: r.range(0.25, 0.72),
    cloudBase,
    cloudTop: cloudBase + r.range(900, 2200),
    cloudSeed: r.int(1, 1 << 20),
    highCloudCover: r.range(0.1, 0.6),
  };
}

/** Wind + turbulence. Gust state is a first-order filtered noise process (Dryden-like). */
export class Weather {
  gust = new Vector3();
  gustRate = new Vector3();
  turbLevel = 0;
  inCloud = 0;
  private rng: RNG;
  constructor(public roll: WorldRoll, rng: RNG) {
    this.rng = rng.fork('turbulence');
  }

  /** Mean wind in local ENU (x east, y up, z south) in m/s. */
  meanWindENU(alt: number, out: Vector3): Vector3 {
    const w = this.roll;
    let spd: number, dir: number;
    if (alt < 1000) {
      spd = w.windSpeed * (0.55 + 0.45 * clamp01(Math.log(1 + Math.max(0, alt) / 10) / Math.log(101)));
      dir = w.windDir;
    } else if (alt < w.jetAlt) {
      const t = (alt - 1000) / (w.jetAlt - 1000);
      spd = lerp(w.windSpeed, w.jetSpeed, t * t);
      dir = lerp(w.windDir, w.jetDir, t);
    } else if (alt < 30000) {
      const t = (alt - w.jetAlt) / (30000 - w.jetAlt);
      spd = lerp(w.jetSpeed, 8, t);
      dir = w.jetDir;
    } else spd = Math.max(0, 8 - (alt - 30000) / 2000), (dir = w.jetDir);
    // blowing FROM dir → velocity points opposite. dir measured from north, clockwise.
    const vx = -Math.sin(dir) * spd; // east
    const vn = -Math.cos(dir) * spd; // north
    return out.set(vx, 0, -vn);
  }

  update(dt: number, alt: number, dirUnit: Vector3, airspeed: number): void {
    const w = this.roll;
    const cov = alt > w.cloudBase - 200 && alt < w.cloudTop + 200 ? cloudCoverage(dirUnit, w.cloudSeed, w.cloudCover) : 0;
    const inBand = smoothstep(w.cloudBase - 150, w.cloudBase + 150, alt) * (1 - smoothstep(w.cloudTop - 150, w.cloudTop + 150, alt));
    this.inCloud = cov * inBand;
    const bl = alt < 2000 ? w.boundaryTurb * (1 - alt / 2000) * w.gustiness : 0;
    const cat = w.catIntensity * Math.exp(-(((alt - w.jetAlt) / 1500) ** 2)) * 0.8;
    const strat = alt < 20000 ? 0.05 : 0;
    this.turbLevel = clamp01(bl + this.inCloud * 0.9 + cat + strat);
    // filtered noise: correlation length L ≈ 300 m
    const L = 300;
    const tau = L / Math.max(30, airspeed);
    const sigma = 6 * this.turbLevel * (alt < 30000 ? 1 : 0);
    const k = Math.exp(-dt / tau);
    const s = sigma * Math.sqrt(1 - k * k);
    this.gust.set(this.gust.x * k + this.rng.gauss() * s, this.gust.y * k + this.rng.gauss() * s * 0.7, this.gust.z * k + this.rng.gauss() * s * 0.5);
    const kr = Math.exp(-dt / 0.6);
    const sr = 0.05 * this.turbLevel * Math.sqrt(1 - kr * kr) * Math.min(1, airspeed / 80);
    this.gustRate.set(this.gustRate.x * kr + this.rng.gauss() * sr, this.gustRate.y * kr + this.rng.gauss() * sr * 0.5, this.gustRate.z * kr + this.rng.gauss() * sr * 1.5);
  }
}
