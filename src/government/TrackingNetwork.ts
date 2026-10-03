import { Vector3 } from 'three';
import { PLANET } from '../physics/PlanetPhysics';
import { clamp01 } from '../core/mathutil';
import type { Run } from '../core/Run';
import type { RNG } from '../core/RNG';

export type FixSource = 'xpdr' | 'datalink' | 'radar' | 'ir' | 'interceptor' | 'df' | 'spoof';

export interface Fix {
  time: number;
  pos: Vector3;
  vel: Vector3;
  source: FixSource;
  accurate: boolean;
}

export interface RadarSite {
  name: string;
  pos: Vector3;
  range: number;
  interval: [number, number];
  nextSweep: number;
  lastSweep: number;
}

export interface Illumination {
  time: number;
  site: string;
  bearing: number; // rad relative to ship nose (for RWR)
  strength: number;
  detected: boolean;
  ghost?: boolean;
}

/**
 * Government surveillance. Nothing here knows about "mission stages":
 * radars sweep on randomised schedules, the interrogator asks the transponder,
 * the datalink reports telemetry, orbital IR sensors look for plumes.
 */
export class TrackingNetwork {
  sites: RadarSite[] = [];
  orbital = { interval: [8, 14] as [number, number], nextSweep: 12, lastSweep: -99 };
  interrogNext = 2;
  datalinkNext = 1;
  lastFix: Fix | null = null;
  lastAccurateFix: Fix | null = null;
  trace = 0;
  tracePeak = 0;
  illum: Illumination[] = [];
  esmHits = 0;
  primaryOnlyCount = 0;
  sweepsTotal = 0;
  detections = 0;
  private rng: RNG;

  constructor(private run: Run) {
    this.rng = run.rng.fork('surveillance');
    const r = this.rng;
    const site = (east: number, north: number) => {
      const p = new Vector3(east, 0, -north);
      return p.normalize().multiplyScalar(Math.sqrt(east * east + north * north)).add(new Vector3(0, PLANET.radius, 0)).normalize().multiplyScalar(PLANET.radius + 60);
    };
    this.sites.push({ name: 'LAUNCH CONTROL', pos: site(3000, -1500), range: 420_000, interval: [r.range(5.5, 7), r.range(9, 11.5)], nextSweep: r.range(1, 6), lastSweep: -99 });
    this.sites.push({ name: 'COASTAL LONG RANGE', pos: site(380_000, 160_000), range: 1_100_000, interval: [r.range(9, 11), r.range(14, 18)], nextSweep: r.range(3, 12), lastSweep: -99 });
    this.orbital.interval = [r.range(7, 9), r.range(12, 15)];
    this.orbital.nextSweep = r.range(5, 14);
  }

  private visible(site: Vector3, target: Vector3): boolean {
    // line of sight above the horizon (spherical planet)
    const d = target.clone().sub(site);
    const t = -site.dot(d) / d.lengthSq();
    if (t <= 0 || t >= 1) return true;
    const closest = site.clone().addScaledVector(d, t);
    return closest.length() > PLANET.radius - 200;
  }

  private addFix(source: FixSource, accurate: boolean, noise = 0): Fix {
    const ship = this.run.ship;
    const pos = ship.pos.clone();
    if (noise > 0) pos.add(new Vector3(this.rng.gauss(0, noise), this.rng.gauss(0, noise), this.rng.gauss(0, noise)));
    const f: Fix = { time: ship.time, pos, vel: ship.vel.clone(), source, accurate };
    this.lastFix = f;
    if (accurate) this.lastAccurateFix = f;
    this.detections++;
    this.run.flightCommand.onFix(f);
    return f;
  }

  /** Force an immediate sweep (debug / events). */
  forceSweep(): void {
    for (const s of this.sites) s.nextSweep = this.run.ship.time;
  }

  update(dt: number): void {
    const run = this.run;
    const ship = run.ship;
    const t = ship.time;
    const c = ship.controls;
    const profile = c.get('jamProfile');
    const supp = ship.jammer.radarSuppression(profile);
    const fwd = ship.forward();

    // transponder interrogation (SECURE replies more often)
    if (t >= this.interrogNext) {
      const mode = ship.xpdr.mode(ship);
      this.interrogNext = t + (mode === 'SECURE' ? 2 : 4);
      if (ship.xpdr.interrogated(ship)) this.addFix('xpdr', true);
      else if (profile === 2 && ship.jammer.field > 0.3) {
        // SPOOF: jammer answers with a ghost reply placed on the filed route
        run.flightCommand.onSpoofReply();
      }
    }

    // datalink telemetry
    if (t >= this.datalinkNext) {
      this.datalinkNext = t + 2;
      if (run.datalinkUp()) {
        this.addFix('datalink', true);
        run.flightCommand.onTelemetry();
      }
    }

    // primary radar sweeps
    for (const s of this.sites) {
      if (t < s.nextSweep) continue;
      s.lastSweep = t;
      s.nextSweep = t + this.rng.range(s.interval[0], s.interval[1]) * run.world.sweepMul;
      const range = s.pos.distanceTo(ship.pos);
      if (range > s.range || !this.visible(s.pos, ship.pos)) continue;
      this.sweepsTotal++;
      const toSite = s.pos.clone().sub(ship.pos).normalize();
      const local = toSite.clone().applyQuaternion(ship.quat.clone().invert());
      const bearing = Math.atan2(local.x, -local.z);
      const rcs = (ship.sep.moduleAttached ? 55 : 10) * (1 + (ship.gear.pos > 0.1 ? 0.2 : 0)) * (1 + run.objects.filter((o) => o.kind === 'debris' && o.pos.distanceTo(ship.pos) < 5000).length * 0.1);
      const snr = rcs / Math.pow(range / 160_000, 4);
      let p = 1 - Math.exp(-snr * 2.5);
      // NARROW profile only masks the forward/lower hemisphere well
      const aspectOk = profile !== 0 || local.z < 0.2 || local.y < 0;
      p *= 1 - supp * (aspectOk ? 1 : 0.35);
      p *= 1 - ship.env.inCloud * 0.05;
      const detected = this.rng.next() < p;
      this.illum.push({ time: t, site: s.name, bearing, strength: clamp01(snr / 10 + 0.3), detected });
      if (detected) {
        this.addFix('radar', false, 150);
        if (!ship.xpdr.replying(ship) && !(profile === 2 && ship.jammer.field > 0.3)) {
          this.primaryOnlyCount++;
          run.flightCommand.onPrimaryOnly();
        } else if (!ship.xpdr.replying(ship) && profile === 2) run.flightCommand.onSpoofConflict();
      }
      // passive ESM picks up the jammer itself
      const em = ship.jammer.emission(profile);
      if (em > 0.05 && this.rng.next() < em * 0.45) {
        this.esmHits++;
        run.flightCommand.onJammingDetected();
      }
      run.events.onSweep();
    }

    // orbital IR / gravimetric sensors
    if (ship.env.altitude > 22_000 && t >= this.orbital.nextSweep) {
      this.orbital.lastSweep = t;
      this.orbital.nextSweep = t + this.rng.range(this.orbital.interval[0], this.orbital.interval[1]) * run.world.sweepMul;
      const thrust = (ship.engines.A.thrust + ship.engines.B.thrust) / 1.36e6;
      const hot = clamp01((ship.thermal.hullTemp - 600) / 900);
      let p = clamp01(0.05 + thrust * 0.6 + hot * 0.35);
      const irSupp = ship.jammer.field * (profile === 1 ? 0.6 : profile === 0 ? 0.35 : 0.2);
      p *= 1 - clamp01(irSupp);
      const grav = ship.jump.signature;
      const detectedGrav = grav > 0.15 && this.rng.next() < grav;
      this.illum.push({ time: t, site: 'ORBITAL', bearing: 0, strength: 0.4, detected: false });
      if (this.rng.next() < p || detectedGrav) {
        this.addFix('ir', false, 400);
        if (detectedGrav) run.flightCommand.onGravimetric();
        else if (!ship.xpdr.replying(ship)) run.flightCommand.onPrimaryOnly();
      }
    }

    // interceptor own sensors
    for (const o of run.objects) {
      if (o.kind === 'interceptor' && o.alive && o.data.hasLock && t - (o.data.lastFix ?? -9) > 1.5) {
        o.data.lastFix = t;
        this.addFix('interceptor', true);
      }
    }

    // trace: confidence in the current position estimate
    if (this.lastFix) {
      const age = t - this.lastFix.time;
      const tau = this.lastFix.accurate ? 22 : 14;
      this.trace = Math.exp(-age / tau) * (this.lastFix.accurate ? 1 : 0.8);
    } else this.trace = 0;
    this.tracePeak = Math.max(this.tracePeak, this.trace * Math.min(1, run.flightCommand.alert / 45));
    if (this.illum.length > 30) this.illum.splice(0, this.illum.length - 30);
    void dt;
  }

  /** Government's predicted position of the ship (last fix extrapolated). */
  predicted(out = new Vector3()): Vector3 | null {
    if (!this.lastFix) return null;
    const age = this.run.ship.time - this.lastFix.time;
    return out.copy(this.lastFix.pos).addScaledVector(this.lastFix.vel, age);
  }
}
