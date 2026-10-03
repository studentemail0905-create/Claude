import { Vector3 } from 'three';
import { PLANET } from '../physics/PlanetPhysics';
import { DEG, lerp, clamp } from '../core/mathutil';

export interface RoutePoint {
  s: number; // ground distance along route (m)
  dir: Vector3; // unit surface direction (planet frame)
  alt: number; // assigned altitude (m)
  bearing: number; // rad from north
  halfWidth: number; // lateral tolerance (m)
  halfHeight: number; // vertical tolerance (m)
}

export interface RouteQuery {
  index: number;
  s: number;
  lateral: number; // signed m (+ right of track)
  vertical: number; // m above assigned altitude
  latRatio: number;
  vertRatio: number;
  assignedAlt: number;
  bearing: number;
}

const POLE = new Vector3(0, 0, -1);

/**
 * Filed civil route: RWY 09 → Orbital Transit Lane Three.
 * Climbs along a great-circle-ish track that turns from 090 to 062,
 * levelling at the 85 km lane ceiling. It never goes anywhere a jump is possible.
 */
export class LegalFlightPlan {
  points: RoutePoint[] = [];
  readonly step = 1000;
  private last = 0;
  readonly name = 'OTL-3';

  constructor(start: Vector3) {
    let dir = start.clone().normalize();
    let s = 0;
    for (let i = 0; i <= 2200; i++) {
      const brgDeg = s < 30_000 ? 90 : s < 110_000 ? lerp(90, 62, (s - 30_000) / 80_000) : 62;
      const bearing = brgDeg * DEG;
      const alt = LegalFlightPlan.altitudeAt(s);
      this.points.push({ s, dir: dir.clone(), alt, bearing, halfWidth: 2600 + s * 0.007, halfHeight: 900 + alt * 0.06 });
      // advance one step along the bearing on the sphere
      const east = new Vector3().crossVectors(POLE, dir).normalize();
      const north = new Vector3().crossVectors(dir, east).normalize();
      const head = east.multiplyScalar(Math.sin(bearing)).add(north.multiplyScalar(Math.cos(bearing)));
      const ang = this.step / PLANET.radius;
      dir = dir.multiplyScalar(Math.cos(ang)).add(head.multiplyScalar(Math.sin(ang))).normalize();
      s += this.step;
    }
  }

  static altitudeAt(s: number): number {
    const lane = 85_000 * (1 - Math.exp(-s / 230_000));
    const initial = Math.max(0, s - 2300) * Math.tan(19 * DEG);
    return Math.min(lane, initial);
  }

  worldPoint(i: number, out = new Vector3()): Vector3 {
    const p = this.points[clamp(i, 0, this.points.length - 1)];
    return out.copy(p.dir).multiplyScalar(PLANET.radius + p.alt);
  }

  /** Interpolated route position at along-track distance s. */
  pointAtS(s: number, out = new Vector3()): Vector3 {
    const f = clamp(s / this.step, 0, this.points.length - 1.001);
    const i = Math.floor(f);
    const t = f - i;
    const a = this.points[i], b = this.points[i + 1];
    out.copy(a.dir).lerp(b.dir, t).normalize();
    return out.multiplyScalar(PLANET.radius + lerp(a.alt, b.alt, t));
  }

  query(pos: Vector3, out?: RouteQuery): RouteQuery {
    const o = out ?? { index: 0, s: 0, lateral: 0, vertical: 0, latRatio: 0, vertRatio: 0, assignedAlt: 0, bearing: 0 };
    const r = pos.length();
    const d = pos.clone().multiplyScalar(1 / r);
    // local search around last index, fall back to coarse global search on big jumps
    let best = this.last;
    let bestDot = -2;
    const lo = Math.max(0, this.last - 40), hi = Math.min(this.points.length - 1, this.last + 400);
    for (let i = lo; i <= hi; i++) {
      const dt = this.points[i].dir.dot(d);
      if (dt > bestDot) { bestDot = dt; best = i; }
    }
    if (bestDot < Math.cos(60_000 / PLANET.radius)) {
      for (let i = 0; i < this.points.length; i += 5) {
        const dt = this.points[i].dir.dot(d);
        if (dt > bestDot) { bestDot = dt; best = i; }
      }
    }
    this.last = best;
    const p = this.points[best];
    const east = new Vector3().crossVectors(POLE, p.dir).normalize();
    const north = new Vector3().crossVectors(p.dir, east).normalize();
    const along = east.clone().multiplyScalar(Math.sin(p.bearing)).add(north.clone().multiplyScalar(Math.cos(p.bearing)));
    const right = new Vector3().crossVectors(along, p.dir);
    const delta = d.clone().sub(p.dir).multiplyScalar(PLANET.radius);
    const sAlong = delta.dot(along);
    o.index = best;
    o.s = p.s + sAlong;
    const altHere = LegalFlightPlan.altitudeAt(Math.max(0, o.s));
    o.lateral = delta.dot(right);
    o.vertical = r - PLANET.radius - altHere;
    o.assignedAlt = altHere;
    o.latRatio = Math.abs(o.lateral) / p.halfWidth;
    o.vertRatio = Math.abs(o.vertical) / p.halfHeight;
    o.bearing = p.bearing;
    return o;
  }
}
