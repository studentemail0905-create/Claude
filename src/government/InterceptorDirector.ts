import { Quaternion, Vector3 } from 'three';
import { PLANET, gravityVector } from '../physics/PlanetPhysics';
import { densityAt } from '../physics/Atmosphere';
import { clamp, clamp01 } from '../core/mathutil';
import type { Run, WorldObject } from '../core/Run';
import type { RNG } from '../core/RNG';

/**
 * Government kinetic response. Interceptors fly to where the network THINKS you are.
 * Missiles use proportional navigation with a seeker that the jammer and decoys can break.
 * Inspection drones try to physically dock.
 */
export class InterceptorDirector {
  scramblePending = -1;
  scrambled = 0;
  lastOrbitalLaunch = -999;
  missilesLaunched = 0;
  dronesLaunched = 0;
  decoys = 6;
  lockWarning = 0; // 0..1 strongest active lock
  missileInbound = false;
  private rng: RNG;

  constructor(private run: Run) {
    this.rng = run.rng.fork('interceptors');
  }

  airbase(): Vector3 {
    const brg = this.run.worldRoll2.airbaseBearing;
    const d = 140_000;
    const local = new Vector3(Math.sin(brg) * d, 0, -Math.cos(brg) * d);
    return local.add(new Vector3(0, PLANET.radius, 0)).normalize().multiplyScalar(PLANET.radius + 500);
  }

  spawnInterceptor(near?: Vector3): WorldObject {
    const run = this.run;
    const pos = near ? near.clone() : this.airbase();
    const up = pos.clone().normalize();
    const o = run.spawn('interceptor', pos, up.clone().multiplyScalar(80));
    o.data = { missiles: 2, lastShot: -99, hasLock: false, maxSpeed: this.rng.range(950, 1250), ceiling: this.rng.range(31_000, 36_000), warned: false };
    this.scrambled++;
    run.flightCommand.say('$CS, interceptor flight is airborne to escort you. Comply with all signals.', 'hostile', { key: 'scramble_' + this.scrambled });
    return o;
  }

  spawnMissile(from: Vector3, vel: Vector3, orbital = false): WorldObject {
    const o = this.run.spawn('missile', from.clone(), vel.clone());
    o.data = { fuel: orbital ? 70 : 36, maxG: orbital ? 16 : 28, locked: true, orbital, speed: orbital ? 3200 : 2400, lostFor: 0 };
    this.missilesLaunched++;
    this.run.ship.bus.emit('sfx', { id: 'missile_launch_warn' });
    this.run.ship.log('MISSILE LAUNCH DETECTED');
    return o;
  }

  spawnDrone(): WorldObject {
    const ship = this.run.ship;
    const ahead = ship.vel.clone().normalize().multiplyScalar(60_000 + this.rng.range(0, 40_000));
    const off = new Vector3(this.rng.gauss(0, 1), this.rng.gauss(0, 1), this.rng.gauss(0, 1)).normalize().multiplyScalar(30_000);
    const pos = ship.pos.clone().add(ahead).add(off);
    const o = this.run.spawn('drone', pos, ship.vel.clone().multiplyScalar(0.9));
    o.data = { dv: 2600, docked: 0, hasLock: true };
    this.dronesLaunched++;
    this.run.flightCommand.say('$CS, an Authority inspection drone is closing on you. Hold attitude for boarding.', 'hostile', { key: 'drone_' + this.dronesLaunched });
    return o;
  }

  update(dt: number): void {
    const run = this.run;
    const ship = run.ship;
    const fc = run.flightCommand;
    const t = ship.time;

    // scramble decision: alert + someone knows roughly where you are
    if (fc.alert >= 70 && this.scrambled === 0 && this.scramblePending < 0 && ship.env.altitude < 45_000) {
      this.scramblePending = t + this.rng.range(14, 32) * run.world.responseMul;
    }
    if (this.scramblePending > 0 && t >= this.scramblePending) {
      this.scramblePending = -1;
      this.spawnInterceptor();
      if (fc.alert >= 85) this.spawnInterceptor();
    }
    // orbital defence lattice
    if (fc.alert >= 90 && ship.env.altitude > 50_000 && run.tracking.trace > 0.45 && t - this.lastOrbitalLaunch > 45) {
      this.lastOrbitalLaunch = t;
      const pred = run.tracking.predicted()!;
      const dir = pred.clone().normalize();
      const side = new Vector3(this.rng.gauss(0, 1), this.rng.gauss(0, 1), this.rng.gauss(0, 1)).normalize();
      const from = pred.clone().addScaledVector(dir, 140_000).addScaledVector(side, 120_000);
      const v = pred.clone().sub(from).normalize().multiplyScalar(1500).add(ship.vel.clone().multiplyScalar(0.5));
      this.spawnMissile(from, v, true);
      fc.say('ORBITAL DEFENCE LATTICE: kinetic interdiction authorised.', 'hostile', { from: 'DEFENCE NET', key: 'odl_' + Math.floor(t / 45) });
    }
    if (fc.alert >= 75 && ship.env.altitude > 65_000 && this.dronesLaunched === 0 && run.tracking.trace > 0.3) this.spawnDrone();

    this.lockWarning = 0;
    this.missileInbound = false;
    const tmp = new Vector3();
    for (const o of run.objects) {
      if (!o.alive) continue;
      if (o.kind === 'interceptor') this.updateInterceptor(o, dt, tmp);
      else if (o.kind === 'missile') this.updateMissile(o, dt);
      else if (o.kind === 'drone') this.updateDrone(o, dt);
    }

    // decoys
    if (ship.controls.pressed('decoy')) {
      if (this.decoys > 0 && ship.jammer.powered) {
        this.decoys--;
        ship.bus.emit('sfx', { id: 'decoy' });
        const d = run.spawn('decoy', ship.pos.clone(), ship.vel.clone().add(new Vector3(this.rng.gauss(0, 30), this.rng.gauss(0, 30), this.rng.gauss(0, 30))));
        d.data = { life: 6 };
        for (const m of run.objects) {
          if (m.kind === 'missile' && m.alive && m.data.locked && m.pos.distanceTo(ship.pos) < 18_000 && this.rng.chance(0.45)) {
            m.data.locked = false;
            m.data.decoyed = d;
          }
        }
      } else ship.bus.emit('sfx', { id: 'button_dead' });
    }
  }

  private updateInterceptor(o: WorldObject, dt: number, tmp: Vector3): void {
    const run = this.run;
    const ship = run.ship;
    const t = ship.time;
    const d = o.data;
    const range = o.pos.distanceTo(ship.pos);
    // own radar: easier close in; jammer degrades
    const pLock = clamp01((1 - range / 45_000) * (1 - ship.jammer.radarSuppression(ship.controls.get('jamProfile')) * 0.9));
    if (this.rng.next() < dt * 2) d.hasLock = this.rng.next() < pLock;
    const target = d.hasLock ? ship.pos.clone() : run.tracking.predicted(tmp)?.clone() ?? ship.pos.clone();
    const alt = o.pos.length() - PLANET.radius;
    const tgtAlt = target.length() - PLANET.radius;
    if (tgtAlt > d.ceiling) target.setLength(PLANET.radius + d.ceiling);
    const desired = target.sub(o.pos);
    const dist = desired.length();
    desired.normalize().multiplyScalar(Math.min(d.maxSpeed * clamp01(1.4 - alt / (d.ceiling * 1.15)), dist * 0.5 + 300));
    const steer = desired.sub(o.vel);
    const maxA = 70;
    if (steer.length() > maxA) steer.setLength(maxA);
    o.vel.addScaledVector(steer, dt);
    o.pos.addScaledVector(o.vel, dt);
    if (o.pos.length() < PLANET.radius + 200) o.pos.setLength(PLANET.radius + 200);
    o.quat.setFromUnitVectors(new Vector3(0, 0, -1), o.vel.clone().normalize());
    if (d.hasLock && range < 30_000) this.lockWarning = Math.max(this.lockWarning, 0.4);
    if (!d.warned && range < 15_000) {
      d.warned = true;
      run.flightCommand.say('Unauthorized craft, this is Authority interceptor. Rock your wings and follow me down.', 'hostile', { from: 'INTERCEPTOR', freq: 0 });
    }
    // weapons
    const fc = run.flightCommand;
    if (d.hasLock && d.missiles > 0 && fc.alert >= 85 && range < 26_000 && t - d.lastShot > 14) {
      d.missiles--;
      d.lastShot = t;
      this.spawnMissile(o.pos, o.vel.clone().add(ship.pos.clone().sub(o.pos).normalize().multiplyScalar(300)));
    }
    // give up when out-climbed
    if (ship.env.altitude > d.ceiling + 20_000 && range > 60_000) o.alive = false;
  }

  private updateMissile(o: WorldObject, dt: number): void {
    const run = this.run;
    const ship = run.ship;
    const d = o.data;
    o.age += dt;
    const rel = ship.pos.clone().sub(o.pos);
    const range = rel.length();
    // seeker vs jammer
    if (d.locked) {
      const f = ship.jammer.field;
      if (range > 1500 && this.rng.next() < dt * f * f * 0.55) {
        d.locked = false;
        ship.log('MISSILE LOCK BROKEN');
      }
    } else if (!d.decoyed && this.rng.next() < dt * 0.25 * (1 - ship.jammer.field) && range < 30_000) d.locked = true;
    const tgtPos = d.locked ? ship.pos : d.decoyed?.alive ? d.decoyed.pos : null;
    const g = gravityVector(o.pos, new Vector3());
    const rho = densityAt(o.pos.length() - PLANET.radius);
    if (d.fuel > 0 && tgtPos) {
      const r = tgtPos.clone().sub(o.pos);
      const vRel = (d.locked ? ship.vel : (d.decoyed?.vel ?? ship.vel)).clone().sub(o.vel);
      const rr = r.lengthSq();
      const losRate = new Vector3().crossVectors(r, vRel).multiplyScalar(1 / Math.max(1, rr));
      const vc = -r.dot(vRel) / Math.max(1, r.length());
      const acmd = new Vector3().crossVectors(losRate, o.vel.clone().normalize()).multiplyScalar(-4 * Math.max(200, vc));
      acmd.addScaledVector(g, -1);
      const thrustDir = o.vel.clone().normalize();
      const speed = o.vel.length();
      if (speed < d.speed) acmd.addScaledVector(thrustDir, 60);
      const maxA = d.maxG * 9.81;
      if (acmd.length() > maxA) acmd.setLength(maxA);
      o.vel.addScaledVector(acmd, dt);
      d.fuel -= dt;
    }
    o.vel.addScaledVector(g, dt);
    // drag
    const sp = o.vel.length();
    if (sp > 1) o.vel.multiplyScalar(1 - clamp((0.5 * rho * sp * 0.05) / 150, 0, 0.5) * dt);
    // sub-step closest approach to avoid tunnelling
    const prev = o.pos.clone();
    o.pos.addScaledVector(o.vel, dt);
    const seg = o.pos.clone().sub(prev);
    const relPrev = ship.pos.clone().sub(prev);
    const tc = clamp(relPrev.dot(seg) / Math.max(1e-6, seg.lengthSq()), 0, 1);
    const miss = prev.clone().addScaledVector(seg, tc).distanceTo(ship.pos);
    o.quat.setFromUnitVectors(new Vector3(0, 0, -1), o.vel.clone().normalize());
    if (d.locked && range < 40_000) {
      this.lockWarning = 1;
      this.missileInbound = true;
    }
    if (miss < 28) {
      o.alive = false;
      run.fail('missile', `impact, miss distance ${miss.toFixed(0)} m`);
      return;
    }
    if (miss < 80 && range < 400) {
      o.alive = false;
      ship.bus.emit('sfx', { id: 'explosion_near' });
      ship.bus.emit('shake', { amount: 1.2 });
      ship.damage.hit('structure', 0.35);
      ship.damage.randomHit(ship, 0.5);
      ship.damage.randomHit(ship, 0.5);
      ship.press.cockpitLeak += 0.003;
      ship.log('PROXIMITY DETONATION');
      return;
    }
    if ((d.fuel <= 0 && o.age > 60) || o.age > 140 || o.pos.length() < PLANET.radius) o.alive = false;
  }

  private updateDrone(o: WorldObject, dt: number): void {
    const run = this.run;
    const ship = run.ship;
    const d = o.data;
    const rel = ship.pos.clone().sub(o.pos);
    const range = rel.length();
    if (range > 4000 && ship.jammer.field > 0.55 && this.rng.next() < dt * 0.2) d.hasLock = false;
    else if (!d.hasLock && range < 3000) d.hasLock = true;
    if (d.hasLock && d.dv > 0) {
      const vRel = ship.vel.clone().sub(o.vel);
      // approach with closing speed proportional to range
      const want = rel.clone().normalize().multiplyScalar(Math.min(700, range * 0.06 + 5)).add(vRel);
      const a = want.clone().multiplyScalar(0.8);
      if (a.length() > 45) a.setLength(45);
      o.vel.addScaledVector(a, dt);
      d.dv -= a.length() * dt;
    }
    o.vel.add(gravityVector(o.pos, new Vector3()).multiplyScalar(dt));
    o.pos.addScaledVector(o.vel, dt);
    o.quat.setFromUnitVectors(new Vector3(0, 0, -1), rel.clone().normalize());
    const relSpeed = ship.vel.clone().sub(o.vel).length();
    if (range < 2000) this.lockWarning = Math.max(this.lockWarning, 0.5);
    if (range < 140 && relSpeed < 35) {
      d.docked += dt;
      if (d.docked > 3) run.fail('drone_capture', 'inspection drone docked');
    } else d.docked = 0;
    if (range < 25 && relSpeed > 35) {
      o.alive = false;
      ship.damage.hit('structure', 0.3);
      ship.damage.randomHit(ship, 0.4);
      ship.bus.emit('sfx', { id: 'collision' });
      ship.bus.emit('shake', { amount: 1 });
    }
    if (range > 400_000) o.alive = false;
  }
}

export const _q = new Quaternion();
