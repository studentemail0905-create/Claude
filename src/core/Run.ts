import { Quaternion, Vector3 } from 'three';
import { RNG, seedToString } from './RNG';
import { EventBus, type SimEvents } from './EventBus';
import { clamp, RAD } from './mathutil';
import { BAL } from '../data/Balance';
import { Ship } from '../ship/Ship';
import { rollMachine, type MachineRoll } from '../ship/MachineRoll';
import { rollWorld, Weather, type WorldRoll } from '../physics/Weather';
import { LegalFlightPlan } from '../flight/LegalFlightPlan';
import { FlightDirector } from '../flight/FlightDirector';
import { rollEscapeVector } from '../flight/EscapeNavigation';
import { TrackingNetwork } from '../government/TrackingNetwork';
import { FlightCommand } from '../government/FlightCommand';
import { InterceptorDirector } from '../government/InterceptorDirector';
import { EventDirector } from '../events/EventDirector';
import { PLANET, gravityVector, apoapsisAltitude } from '../physics/PlanetPhysics';
import { densityAt } from '../physics/Atmosphere';
import { newZoneTracker, updateZones, calculateReward, type RewardBreakdown } from '../progression/RewardCalculator';
import { pickSnark, FAILURE_TITLES, NEAR_MISS } from '../data/Snark';
import type { JumpResult } from '../ship/systems/JumpDriveSystem';

export type ObjectKind = 'interceptor' | 'missile' | 'drone' | 'debris' | 'pod' | 'module' | 'contact' | 'decoy';

export interface WorldObject {
  id: number;
  kind: ObjectKind;
  pos: Vector3;
  vel: Vector3;
  quat: Quaternion;
  omega: Vector3;
  alive: boolean;
  age: number;
  data: any;
}

export interface Failure {
  cause: string;
  title: string;
  detail: string;
  snark: string;
  time: number;
}

export interface RunStats {
  maxAlt: number;
  maxSpeed: number;
  maxMach: number;
  maxG: number;
  minG: number;
  peakHeat: number;
  peakQ: number;
  suspicionLog: { t: number; amount: number; reason: string }[];
}

export interface WorldRoll2 {
  airbaseBearing: number;
  sweepMul: number;
  responseMul: number;
}

export class Run {
  readonly seed: number;
  readonly seedStr: string;
  rng: RNG;
  bus = new EventBus<SimEvents>();
  machine: MachineRoll;
  worldRoll: WorldRoll;
  world: WorldRoll2;
  worldRoll2: WorldRoll2;
  weather: Weather;
  plan: LegalFlightPlan;
  ship: Ship;
  fd: FlightDirector;
  tracking: TrackingNetwork;
  flightCommand: FlightCommand;
  interceptors: InterceptorDirector;
  events: EventDirector;
  escape: ReturnType<typeof rollEscapeVector>;
  objects: WorldObject[] = [];
  splits: Record<string, number> = {};
  stats: RunStats = { maxAlt: 0, maxSpeed: 0, maxMach: 0, maxG: 1, minG: 1, peakHeat: 295, peakQ: 0, suspicionLog: [] };
  zones = newZoneTracker();
  failed: Failure | null = null;
  escaped = false;
  jumpResult: JumpResult | null = null;
  ended = false;
  endedAt = 0;
  reward: RewardBreakdown | null = null;
  ghostLock = 0;
  lastStall = -99;
  private nextId = 1;
  private tumbleT = 0;
  private blackoutT = 0;
  private wasOnGround = true;
  private podsCheckAt = -1;
  private sepCheckAt = -1;
  private paxFailAt = -1;

  constructor(seed: number, opts: { equipped?: string[]; recentEvents?: string[] } = {}) {
    this.seed = seed >>> 0;
    this.seedStr = seedToString(this.seed);
    this.rng = new RNG(this.seed);
    this.machine = rollMachine(this.rng, opts.equipped ?? []);
    this.worldRoll = rollWorld(this.rng);
    const w2 = this.rng.fork('world2');
    this.world = this.worldRoll2 = { airbaseBearing: w2.range(0, Math.PI * 2), sweepMul: w2.range(0.9, 1.12), responseMul: w2.range(0.8, 1.25) };
    this.weather = new Weather(this.worldRoll, this.rng);
    this.ship = new Ship(this.machine, this.rng.fork('ship'), this.rng.fork('outcomes'), this.bus, this.weather);
    this.plan = new LegalFlightPlan(this.ship.pos.clone());
    this.fd = new FlightDirector(this.plan);
    this.ship.flightDirector = this.fd;
    this.escape = rollEscapeVector(this.rng);
    this.ship.escapeVector.copy(this.escape.vec);
    this.tracking = new TrackingNetwork(this);
    this.flightCommand = new FlightCommand(this);
    this.interceptors = new InterceptorDirector(this);
    this.events = new EventDirector(this, opts.recentEvents ?? []);
    this.ship.failHandler = (c, d) => this.fail(c, d);
    this.ship.jumpHandler = (r) => this.onJump(r);
    this.ship.separationHandler = () => this.onSeparation();
    this.bus.on('podRelease', () => {
      this.podsCheckAt = this.ship.time + 6;
    });
  }

  get time(): number {
    return this.ship.time;
  }

  datalinkUp(): boolean {
    const s = this.ship;
    return s.controls.get('datalink') === 1 && s.controls.get('cb_dlink') === 1 && s.elec.volts.AV > 19;
  }

  spawn(kind: ObjectKind, pos: Vector3, vel: Vector3): WorldObject {
    const o: WorldObject = { id: this.nextId++, kind, pos, vel, quat: new Quaternion(), omega: new Vector3(), alive: true, age: 0, data: {} };
    this.objects.push(o);
    return o;
  }

  split(name: string): void {
    if (!(name in this.splits)) this.splits[name] = this.ship.time;
  }

  step(dt: number): void {
    if (this.ended) return;
    const ship = this.ship;
    ship.step(dt);
    if (this.ended) return;
    this.tracking.update(dt);
    this.flightCommand.update(dt);
    if (this.ended) return;
    this.interceptors.update(dt);
    if (this.ended) return;
    this.events.update(dt);
    this.updateObjects(dt);
    if (this.ended) return;
    this.checks(dt);
    this.ghostLock = Math.max(0, this.ghostLock - dt);
    ship.controls.clearEdges();
  }

  private checks(dt: number): void {
    const s = this.ship;
    const e = s.env;
    const st = this.stats;
    st.maxAlt = Math.max(st.maxAlt, e.altitude);
    st.maxSpeed = Math.max(st.maxSpeed, s.vel.length());
    st.maxMach = Math.max(st.maxMach, e.atmo.density > 1e-5 ? e.mach : 0);
    st.maxG = Math.max(st.maxG, e.nz);
    st.minG = Math.min(st.minG, e.nz);
    st.peakHeat = Math.max(st.peakHeat, s.thermal.hullTemp);
    st.peakQ = Math.max(st.peakQ, e.q);
    if (e.stalled && e.q > 200) this.lastStall = s.time;

    // splits
    if (this.wasOnGround && !e.onGround && e.agl > 12) this.split('wheels up');
    this.wasOnGround = e.onGround;
    const rq = this.fd.routeQ;
    if (rq && !e.onGround && e.altitude > 1500 && (rq.latRatio > 1 || rq.vertRatio > 1)) this.split('corridor departure');
    if (s.pax.released >= 4) this.split('passenger evacuation');
    if (s.jammer.active) this.split('masking activation');
    if (e.altitude > 30_000) this.split('30 km');
    if (e.altitude > 60_000) this.split('60 km');
    if (e.altitude > 100_000) this.split('100 km');
    if (s.jump.charge >= s.jump.requiredCharge * 0.95) this.split('jump charge');

    // zones (hidden)
    updateZones(this.zones, {
      airborne: !e.onGround && e.agl > 20, altitude: e.altitude, separated: !s.sep.moduleAttached,
      aligned: s.jump.alignmentError(s) < 10, solution: s.avionics.solutionValid,
      chargeFrac: s.jump.charge / s.jump.requiredCharge, coilsArmed: s.jump.coilsArmed,
    }, dt);

    // pilot physiology
    if (s.press.hypoxia >= 1) return this.fail(s.press.explosive > 0.2 || !s.sep.moduleAttached ? 'decompression' : 'hypoxia', `cockpit ${(s.press.cockpit / 1000).toFixed(0)} kPa, O2 ${s.controls.get('o2') ? 'ON' : 'OFF'}`);
    if (s.omegaDegMag > 110) this.tumbleT += dt;
    else this.tumbleT = Math.max(0, this.tumbleT - dt);
    if (this.tumbleT > 2.5) return this.fail('tumble', `${s.omegaDegMag.toFixed(0)}°/s`);
    // fires
    for (const id of ['A', 'B'] as const) if (s.engines[id].fireTime > 35) return this.fail('engine_fire', `engine ${id} fire ${s.engines[id].fireTime.toFixed(0)} s`);
    if (s.elec.fire.bus && s.elec.fire.t > 55) return this.fail('elec_fire', `bus ${s.elec.fire.bus}`);
    // total electrical blackout while flying
    if (!e.onGround && s.elec.volts.EMER < 5 && s.elec.volts.A < 5 && s.elec.volts.B < 5) this.blackoutT += dt;
    else this.blackoutT = 0;
    if (this.blackoutT > 15) return this.fail('blackout', 'all buses dead');
    // passengers
    for (const p of s.pax.pods) if (p.outcome === 'lost' && p.occupants > 0) return this.fail('pax_disaster', `capsule ${p.index + 1}: ${p.reason || 'bad luck'}`);
    if (this.paxFailAt > 0 && s.time > this.paxFailAt) return this.fail('pax_in_module', `${s.pax.inCabin + s.pax.pods.filter((p) => p.attached).reduce((a, p) => a + p.occupants, 0)} passengers aboard the module`);

    // government observes evacuation / separation (only if it is looking)
    const lf = this.tracking.lastFix;
    if (this.podsCheckAt > 0 && s.time > this.podsCheckAt) {
      this.podsCheckAt = -1;
      if ((lf && s.time - lf.time < 9) || e.onGround) this.flightCommand.onPodsSeen();
    }
    if (this.sepCheckAt > 0 && s.time > this.sepCheckAt) {
      this.sepCheckAt = -1;
      if (lf && s.time - lf.time < 8 && lf.source !== 'spoof') this.flightCommand.onSeparationSeen();
    }
  }

  private onSeparation(): void {
    const s = this.ship;
    this.split('separation');
    this.sepCheckAt = s.time + 7;
    const mod = this.spawn('module', s.sep.module.pos.clone(), s.sep.module.vel.clone());
    mod.quat.copy(s.sep.module.quat);
    mod.omega.copy(s.sep.module.omega);
    mod.data = { mass: BAL.moduleDry + s.fuel.svc, size: 11, collided: false, passengers: s.pax.inCabin + s.pax.pods.filter((p) => p.attached).reduce((a, p) => a + p.occupants, 0) };
    if (mod.data.passengers > 0) this.paxFailAt = s.time + 2.5;
    s.fuel.svc = 0;
    s.massModel.compute(s);
    s.pax.inCabin = 0;
    for (const p of s.pax.pods) if (p.attached) { p.attached = false; p.outcome = 'pending'; p.revealAt = 1e9; }
  }

  private updateObjects(dt: number): void {
    const s = this.ship;
    const g = new Vector3();
    for (const o of this.objects) {
      if (!o.alive) continue;
      o.age += dt;
      if (o.kind === 'module' || o.kind === 'pod' || o.kind === 'debris' || o.kind === 'contact' || o.kind === 'decoy') {
        gravityVector(o.pos, g);
        if (o.kind !== 'contact') o.vel.addScaledVector(g, dt);
        const alt = o.pos.length() - PLANET.radius;
        const rho = densityAt(alt);
        const sp = o.vel.length();
        const bc = o.kind === 'module' ? 900 : o.kind === 'pod' ? (o.data.chute ? 8 : 350) : o.kind === 'decoy' ? 20 : 2000;
        if (sp > 0.1 && rho > 1e-12) {
          const dec = (0.5 * rho * sp * sp) / bc;
          o.vel.addScaledVector(o.vel, -Math.min(dec * dt, sp * 0.5) / sp);
        }
        o.pos.addScaledVector(o.vel, dt);
        // tumble
        const dq = new Quaternion().setFromAxisAngle(o.omega.lengthSq() > 0 ? o.omega.clone().normalize() : new Vector3(0, 1, 0), o.omega.length() * dt);
        o.quat.multiply(dq);
        if (o.kind === 'pod' && o.data.powered && alt < 7000 && sp < 260) o.data.chute = true;
        if (alt < 0 || o.age > 240) o.alive = false;
        if (o.kind === 'decoy') {
          o.data.life -= dt;
          if (o.data.life <= 0) o.alive = false;
        }
        // collision with the ship
        if (o.kind === 'module') {
          this.moduleCollision(o);
          if (this.ended) return;
          continue;
        }
        const r = o.data.size ?? 4;
        const dist = o.pos.distanceTo(s.pos);
        if ((o.kind === 'debris' || o.kind === 'contact') && o.age > 0.2 && dist < r + 7) {
          const relV = o.vel.clone().sub(s.vel).length();
          o.alive = false;
          s.bus.emit('sfx', { id: 'collision' });
          s.bus.emit('shake', { amount: 1.2 });
          if (relV > 35) return this.fail('debris', `${relV.toFixed(1)} m/s relative`);
          s.damage.hit('structure', 0.12 + relV * 0.02);
          s.damage.randomHit(s, 0.3);
        }
      }
    }
    // pods spawn from passenger system
    for (const p of s.pax.pods) {
      if (!p.attached && p.revealAt < 1e8 && !p.pos.equals(new Vector3()) && !(p as any).spawned) {
        (p as any).spawned = true;
        const o = this.spawn('pod', p.pos.clone(), p.vel.clone());
        o.data = { size: 2, powered: p.charge >= 0.5, index: p.index };
        o.omega.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(p.charge >= 0.5 ? 0.3 : 2);
      }
    }
    if (this.objects.length > 80) this.objects = this.objects.filter((o) => o.alive);
  }

  /** The module sits under the core: it collides if it ends up moving back up into it. */
  private moduleCollision(o: WorldObject): void {
    const s = this.ship;
    if (o.data.collided || o.age < 0.3) return;
    const inv = s.quat.clone().invert();
    const attach = s.bodyToWorld(new Vector3(0, -3.6, 11.5));
    const rel = o.pos.clone().sub(attach).applyQuaternion(inv);
    const relV = o.vel.clone().sub(s.vel).applyQuaternion(inv);
    const dist = o.pos.distanceTo(s.pos);
    if (dist > 60) o.data.clear = true;
    const hit = o.data.clear ? dist < 14 : Math.abs(rel.x) < 7 && rel.z > -16 && rel.z < 16 && rel.y > 0.5;
    if (!hit) return;
    o.data.collided = true;
    const closing = o.data.clear ? relV.length() : Math.max(0, relV.y) + Math.abs(relV.x) * 0.5;
    s.bus.emit('sfx', { id: 'collision' });
    s.bus.emit('shake', { amount: 1.4 });
    o.vel.addScaledVector(s.env.up, -4);
    if (closing > 6) return this.fail('module_collision', `${closing.toFixed(1)} m/s closing`);
    s.damage.hit('structure', 0.1 + closing * 0.04);
    s.damage.randomHit(s, 0.35);
    s.log('MODULE CONTACT');
  }

  fail(cause: string, detail: string): void {
    if (this.ended) return;
    const s = this.ship;
    // refine generic crashes into their real root cause
    if (cause === 'crash_runway' || cause === 'crash_ground') {
      const anyEng = s.engines.A.running || s.engines.B.running;
      if (s.gear.retractOnGround && s.gear.pos < 0.6) cause = 'gear_up';
      else if (s.time - this.lastStall < 8) cause = 'stall';
      else if (!anyEng && !s.env.onGround && this.splits['wheels up'] !== undefined) cause = s.fuel.feed.A.pressure < 0.2 && s.fuel.feed.B.pressure < 0.2 ? 'fuel_starvation' : 'engine_out';
      else if (s.hyd.surfacePressure < 3 && this.splits['wheels up'] !== undefined) cause = 'hydraulic';
      else if (s.elec.volts.AV < 5 && s.elec.volts.A < 5 && this.splits['wheels up'] !== undefined) cause = 'blackout';
    }
    const extra: string[] = [];
    if (s.xpdr.replying(s) && this.flightCommand.alert > 60) extra.push('tracking');
    const snarkRng = this.rng.fork('snark' + s.time.toFixed(2));
    let snark = pickSnark(cause, snarkRng, extra);
    this.failed = { cause, title: FAILURE_TITLES[cause] ?? cause.toUpperCase(), detail, snark, time: s.time };
    this.end();
    if (this.reward && this.reward.pity > 0) this.failed.snark = snark + ' ' + snarkRng.pick(NEAR_MISS);
  }

  private onJump(r: JumpResult): void {
    this.jumpResult = r;
    this.split('jump');
    if (r.ok) {
      this.escaped = true;
      this.ship.bus.emit('jump', { phase: 'success' });
      this.end();
    } else {
      this.ship.bus.emit('jump', { phase: 'fail' });
      this.fail(r.cause, r.detail);
    }
  }

  private end(): void {
    this.ended = true;
    this.endedAt = this.ship.time;
    for (const o of this.objects) if (o.kind === 'module' && o.data.passengers > 0) { /* already failing */ }
    if (this.events.status === 'active') this.events.finish(this.escaped ? 'resolved' : 'expired');
    const s = this.ship;
    this.reward = calculateReward({
      zones: this.zones, escaped: this.escaped, runTime: s.time, tracePeak: this.tracking.tracePeak,
      alertPeak: this.flightCommand.alertPeak, eventStatus: this.events.status, passengersSafe: s.pax.safePassengers + s.pax.pods.filter((p) => !p.attached && p.outcome === 'pending' && p.revealAt < 1e8 && p.survival > 0.6).reduce((a, p) => a + p.occupants, 0),
      maskingTime: s.jammer.activeTime, damage: s.damage.overall(),
    });
  }

  /** Summary for results / failure screens and records. */
  summary() {
    const s = this.ship;
    return {
      seed: this.seedStr,
      time: s.time,
      escaped: this.escaped,
      failure: this.failed,
      maxAlt: this.stats.maxAlt,
      maxSpeed: this.stats.maxSpeed,
      maxMach: this.stats.maxMach,
      maxG: this.stats.maxG,
      peakHeat: this.stats.peakHeat,
      tracePeak: this.tracking.tracePeak,
      alertPeak: this.flightCommand.alertPeak,
      maskingTime: s.jammer.activeTime,
      event: this.events.status === 'pending' ? 'none triggered' : this.events.selected.name,
      eventId: this.events.status === 'pending' ? '' : this.events.selected.id,
      eventOutcome: this.events.status,
      passengersEvacuated: s.pax.evacuated,
      passengersSafe: s.pax.safePassengers,
      damage: s.damage.overall(),
      reward: this.reward,
      splits: { ...this.splits },
      jumpStability: this.jumpResult?.stability ?? null,
      apoapsis: apoapsisAltitude(s.pos, s.vel),
    };
  }
}

export const _unused = { clamp, RAD };
