import { Quaternion, Vector2, Vector3 } from 'three';
import { BAL } from '../data/Balance';
import type { AeroConfig } from '../data/Balance';
import { RNG } from '../core/RNG';
import { EventBus, type SimEvents } from '../core/EventBus';
import { clamp, clamp01, DEG, lerp, RAD } from '../core/mathutil';
import { PLANET, gravityVector } from '../physics/PlanetPhysics';
import { sampleAtmosphere, type AtmoSample } from '../physics/Atmosphere';
import { computeAero, newAeroOutput } from '../physics/Aerodynamics';
import { Weather } from '../physics/Weather';
import { ControlState } from './Controls';
import { DamageModel } from './DamageModel';
import { MassModel, LAYOUT } from './MassModel';
import type { MachineRoll } from './MachineRoll';
import { ElectricalSystem } from './systems/ElectricalSystem';
import { HydraulicSystem } from './systems/HydraulicSystem';
import { FuelSystem } from './systems/FuelSystem';
import { Engine } from './systems/EngineSystem';
import { ThermalSystem } from './systems/ThermalSystem';
import { PressurizationSystem } from './systems/PressurizationSystem';
import { FlightControlSystem } from './systems/FlightControlSystem';
import { RCSSystem } from './systems/RCSSystem';
import { AvionicsSystem } from './systems/AvionicsSystem';
import { TransponderSystem } from './systems/TransponderSystem';
import { CommunicationSystem } from './systems/CommunicationSystem';
import { JammerSystem } from './systems/JammerSystem';
import { PassengerSystem } from './systems/PassengerSystem';
import { SeparationSystem } from './systems/SeparationSystem';
import { JumpDriveSystem, type JumpResult } from './systems/JumpDriveSystem';
import type { FlightDirector } from '../flight/FlightDirector';

export interface ShipEnv {
  altitude: number;
  agl: number;
  atmo: AtmoSample;
  tas: number;
  eas: number;
  mach: number;
  q: number;
  alpha: number;
  beta: number;
  nz: number;
  nx: number;
  vs: number;
  groundSpeed: number;
  onGround: boolean;
  attitude: { pitch: number; roll: number; heading: number };
  up: Vector3;
  east: Vector3;
  north: Vector3;
  turbulenceLevel: number;
  inCloud: number;
  windWorld: Vector3;
  stalled: boolean;
  buffet: number;
  flightPathAngle: number;
  track: number;
}

const POLE = new Vector3(0, 0, -1);
export const LAUNCH_SITE = new Vector3(0, PLANET.radius, 0);

interface ContactPoint {
  name: string;
  ext: Vector3 | null;
  belly: Vector3;
  gearKey: string | null;
  steer?: boolean;
  main?: boolean;
  module: boolean;
}

const CONTACTS: ContactPoint[] = [
  { name: 'nose', ext: LAYOUT.gear.nose, belly: new Vector3(0, -2.9, -0.5), gearKey: 'gearNose', steer: true, module: false },
  { name: 'left', ext: LAYOUT.gear.left, belly: new Vector3(-2.2, -5.5, 11.4), gearKey: 'gearLeft', main: true, module: true },
  { name: 'right', ext: LAYOUT.gear.right, belly: new Vector3(2.2, -5.5, 11.4), gearKey: 'gearRight', main: true, module: true },
  { name: 'tail', ext: null, belly: new Vector3(0, -4.4, 22.5), gearKey: null, module: true },
  { name: 'noseTip', ext: null, belly: new Vector3(0, -1.6, -5), gearKey: null, module: false },
  { name: 'coreAft', ext: null, belly: new Vector3(0, -2.9, 16), gearKey: null, module: false },
  { name: 'wingL', ext: null, belly: new Vector3(-12, -4.2, 18), gearKey: null, module: true },
  { name: 'wingR', ext: null, belly: new Vector3(12, -4.2, 18), gearKey: null, module: true },
];

export class Ship {
  // ── rigid body (COM) ─────────────────────────
  pos = new Vector3();
  vel = new Vector3();
  quat = new Quaternion();
  omega = new Vector3(); // body rad/s
  time = 0;
  startPos = new Vector3();
  distanceFromStart = 0;

  controls = new ControlState();
  damage = new DamageModel();
  massModel = new MassModel();
  elec = new ElectricalSystem();
  hyd = new HydraulicSystem();
  fuel = new FuelSystem();
  engines = { A: new Engine('A'), B: new Engine('B') };
  thermal = new ThermalSystem();
  press = new PressurizationSystem();
  fcs = new FlightControlSystem();
  rcs = new RCSSystem();
  avionics = new AvionicsSystem();
  xpdr = new TransponderSystem();
  comms = new CommunicationSystem();
  jammer = new JammerSystem();
  pax = new PassengerSystem();
  sep = new SeparationSystem();
  jump = new JumpDriveSystem();
  weather: Weather;

  gear = { pos: 1, brakeTemp: 20, accumulator: 1, tireBurst: false, wow: false, collapsed: false, retractOnGround: false };
  tvcCmd = new Vector2();
  thrustMoment = new Vector3();
  escapeVector = new Vector3(0, 1, 0);
  flightDirector!: FlightDirector;

  env: ShipEnv;
  aero = newAeroOutput();
  structureLoad = 0; // max overstress ratio
  bellyScrape = 0;
  rollNoise = 0;
  flags: Record<string, any> = {};
  messages: { t: number; text: string }[] = [];
  /** Hooks wired by Run */
  failHandler: (cause: string, detail: string, data?: any) => void = () => {};
  jumpHandler: (r: JumpResult) => void = () => {};
  separationHandler: () => void = () => {};

  private prevCom = new Vector3();
  private acc = new Vector3();
  private forceW = new Vector3();
  private torqueB = new Vector3();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private tmpQ = new Quaternion();
  private lastVs = 0;

  constructor(
    public machine: MachineRoll,
    public rng: RNG,
    public rngEvents: RNG,
    public bus: EventBus<SimEvents>,
    weather: Weather,
  ) {
    this.weather = weather;
    this.env = {
      altitude: 0, agl: 0, atmo: sampleAtmosphere(0), tas: 0, eas: 0, mach: 0, q: 0, alpha: 0, beta: 0, nz: 1, nx: 0, vs: 0,
      groundSpeed: 0, onGround: true, attitude: { pitch: 0, roll: 0, heading: Math.PI / 2 }, up: new Vector3(0, 1, 0),
      east: new Vector3(1, 0, 0), north: new Vector3(0, 0, -1), turbulenceLevel: 0, inCloud: 0, windWorld: new Vector3(),
      stalled: false, buffet: 0, flightPathAngle: 0, track: Math.PI / 2,
    };
    this.pax.init(this);
    this.hyd.A.leak = machine.hydLeakA;
    this.hyd.B.leak = machine.hydLeakB;
    this.jump.arcRiskMul = machine.capArcRisk;
    this.massModel.compute(this);
    this.prevCom.copy(this.massModel.com);
    this.placeOnRunway();
  }

  /** Spawn at the runway threshold, heading 090, gear compressed slightly. */
  placeOnRunway(): void {
    this.quat.setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
    const com = this.massModel.com;
    // eye such that gear contact is 0.22 m below ground
    const eyeLocal = new Vector3(-2300, 6.4 - 0.18, 0);
    const eyeWorld = LAUNCH_SITE.clone().add(eyeLocal);
    this.pos.copy(eyeWorld).add(com.clone().applyQuaternion(this.quat));
    this.startPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
  }

  get aeroConfig(): AeroConfig {
    return this.sep.moduleAttached ? BAL.pre : BAL.post;
  }

  get structureLimits() {
    const s = this.machine.structure * (0.5 + 0.5 * this.damage.health.structure);
    return this.sep.moduleAttached
      ? { nz: BAL.nzLimitPre * s, nzNeg: BAL.nzNegLimit * s, q: BAL.qLimit * s }
      : { nz: BAL.nzLimitPost * s, nzNeg: BAL.nzNegLimit * 1.4 * s, q: BAL.qLimitPost * s };
  }

  get omegaDegMag(): number {
    return this.omega.length() * RAD;
  }

  forward(out = new Vector3()): Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }

  bodyToWorld(b: Vector3, out = new Vector3()): Vector3 {
    return out.copy(b).sub(this.massModel.com).applyQuaternion(this.quat).add(this.pos);
  }

  /** World position of the pilot's eye (body origin). */
  eyePosition(out = new Vector3()): Vector3 {
    return this.bodyToWorld(new Vector3(0, 0, 0), out);
  }

  log(text: string): void {
    this.messages.push({ t: this.time, text });
    if (this.messages.length > 60) this.messages.shift();
  }

  fail(cause: string, detail: string, data?: any): void {
    this.failHandler(cause, detail, data);
  }

  onSeparated(): void {
    this.separationHandler();
  }

  onJumpResolved(r: JumpResult): void {
    this.jumpHandler(r);
  }

  // ──────────────────────────────────────────────
  computeEnv(): void {
    const e = this.env;
    const r = this.pos.length();
    e.up.copy(this.pos).multiplyScalar(1 / r);
    e.east.crossVectors(POLE, e.up).normalize();
    e.north.crossVectors(e.up, e.east).normalize();
    // altitude of the lowest point is handled by contacts; use eye/COM altitude here
    e.altitude = r - PLANET.radius;
    e.agl = e.altitude - 3.8;
    sampleAtmosphere(e.altitude, e.atmo);

    // wind (local ENU → world)
    const w = this.weather.meanWindENU(e.altitude, this.tmp);
    e.windWorld.set(0, 0, 0).addScaledVector(e.east, w.x).addScaledVector(e.north, -w.z);
    e.windWorld.addScaledVector(e.east, this.weather.gust.x).addScaledVector(e.north, this.weather.gust.z).addScaledVector(e.up, this.weather.gust.y);
    const vAir = this.tmp.copy(this.vel).sub(e.windWorld);
    e.tas = vAir.length();
    e.mach = e.tas / e.atmo.speedOfSound;
    e.q = 0.5 * e.atmo.density * e.tas * e.tas;
    e.eas = e.tas * Math.sqrt(e.atmo.density / 1.225);
    e.vs = this.vel.dot(e.up);
    const horiz = this.tmp2.copy(this.vel).addScaledVector(e.up, -e.vs);
    e.groundSpeed = horiz.length();
    e.track = Math.atan2(horiz.dot(e.east), horiz.dot(e.north));
    e.flightPathAngle = Math.atan2(e.vs, Math.max(0.1, e.groundSpeed));

    const fwd = this.forward(this.tmp2);
    const right = new Vector3(1, 0, 0).applyQuaternion(this.quat);
    const bup = new Vector3(0, 1, 0).applyQuaternion(this.quat);
    e.attitude.pitch = Math.asin(clamp(fwd.dot(e.up), -1, 1));
    e.attitude.heading = Math.atan2(fwd.dot(e.east), fwd.dot(e.north));
    e.attitude.roll = Math.atan2(-right.dot(e.up), bup.dot(e.up));
    e.turbulenceLevel = this.weather.turbLevel;
    e.inCloud = this.weather.inCloud;
  }

  step(dt: number): void {
    this.time += dt;
    this.controls.simTime = this.time;
    this.weather.update(dt, this.env.altitude, this.env.up, this.env.tas);
    this.computeEnv();

    // mass properties; keep the body reference continuous when COM moves
    this.massModel.compute(this);
    const com = this.massModel.com;
    if (!com.equals(this.prevCom)) {
      this.tmp.copy(com).sub(this.prevCom).applyQuaternion(this.quat);
      this.pos.add(this.tmp);
      this.prevCom.copy(com);
    }
    const mass = this.massModel.mass;

    this.updateThrustMoment();

    // ── systems ──
    this.elec.update(dt, this);
    this.avionics.update(dt, this);
    this.flightDirector?.update(this);
    this.xpdr.update(dt, this);
    this.comms.update(dt, this);
    this.hyd.update(dt, this);
    this.fuel.update(dt, this);
    this.engines.A.update(dt, this);
    this.engines.B.update(dt, this);
    this.thermal.update(dt, this);
    this.press.update(dt, this);
    this.updateGear(dt);
    this.fcs.update(dt, this);
    this.rcs.update(dt, this);
    this.jammer.update(dt, this);
    this.pax.update(dt, this);
    this.sep.update(dt, this);
    this.jump.update(dt, this);
    this.elec.noise = Math.max(0, this.elec.noise - dt * 0.3);

    // ── forces ──
    const F = this.forceW.set(0, 0, 0);
    const T = this.torqueB.set(0, 0, 0);
    gravityVector(this.pos, this.acc);
    F.addScaledVector(this.acc, mass);
    const gravF = this.acc.clone().multiplyScalar(mass);

    // engines
    for (const id of ['A', 'B'] as const) {
      const eng = this.engines[id];
      if (eng.thrust <= 0) continue;
      const gp = this.tvcCmd.x * 6 * DEG;
      const gy = this.tvcCmd.y * 6 * DEG;
      const fb = this.tmp.set(Math.sin(gy), -Math.sin(gp), -1).normalize().multiplyScalar(eng.thrust);
      const r = this.tmp2.copy(LAYOUT.engines[id]).sub(com);
      T.add(new Vector3().crossVectors(r, fb));
      F.add(fb.applyQuaternion(this.quat));
    }

    // aerodynamics
    const qInv = this.tmpQ.copy(this.quat).invert();
    const vAirB = this.tmp.copy(this.vel).sub(this.env.windWorld).applyQuaternion(qInv);
    const c = this.controls;
    const extraDrag = (this.pax.pods.filter((p) => !p.attached).length > 0 && this.sep.moduleAttached ? 0.01 : 0) + (1 - this.damage.health.hull) * 0.02 + (this.gear.tireBurst ? 0.004 : 0) + (this.sep.incomplete && this.sep.moduleAttached ? 0.03 : 0);
    computeAero(
      {
        cfg: this.aeroConfig, vAirBody: vAirB, omega: this.omega, rho: this.env.atmo.density, mach: this.env.mach, xcg: com.z,
        de: this.fcs.de, da: this.fcs.da, dr: this.fcs.dr, surfaceAuth: this.fcs.surfaceAuth, speedBrake: c.get('speedBrake'),
        gearDrag: this.sep.moduleAttached ? this.gear.pos : 0, extraDrag, turbulence: this.weather.gustRate,
      },
      this.aero,
    );
    this.env.alpha = this.aero.alpha;
    this.env.beta = this.aero.beta;
    this.env.stalled = this.aero.stalled;
    this.env.buffet = this.aero.buffet;
    T.add(this.aero.torque);
    if (this.aero.buffet > 0) {
      // stall buffet / wing drop
      T.z += (this.rng.next() - 0.5) * this.aero.buffet * this.env.q * this.aeroConfig.S * 0.6;
      T.x += (this.rng.next() - 0.5) * this.aero.buffet * this.env.q * this.aeroConfig.S * 0.4;
    }
    F.add(this.tmp2.copy(this.aero.force).applyQuaternion(this.quat));

    // RCS
    T.add(this.rcs.torque);
    if (this.rcs.force.lengthSq() > 0) F.add(this.tmp2.copy(this.rcs.force).applyQuaternion(this.quat));

    // ground contact
    this.groundContacts(dt, F, T, com, mass);

    // ── integrate (semi-implicit Euler) ──
    this.acc.copy(F).multiplyScalar(1 / mass);
    const nonGrav = this.tmp.copy(F).sub(gravF).multiplyScalar(1 / mass).applyQuaternion(qInv);
    this.env.nz = nonGrav.y / PLANET.g0;
    this.env.nx = -nonGrav.z / PLANET.g0;
    this.vel.addScaledVector(this.acc, dt);
    this.pos.addScaledVector(this.vel, dt);

    const I = this.massModel.inertia;
    const w = this.omega;
    const Iw = this.tmp.set(I.x * w.x, I.y * w.y, I.z * w.z);
    const gyro = this.tmp2.crossVectors(w, Iw);
    w.x += ((T.x - gyro.x) / I.x) * dt;
    w.y += ((T.y - gyro.y) / I.y) * dt;
    w.z += ((T.z - gyro.z) / I.z) * dt;
    // numeric safety
    if (w.length() > 12) w.setLength(12);
    const dq = this.tmpQ.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 1);
    this.quat.multiply(dq).normalize();

    this.distanceFromStart = this.pos.distanceTo(this.startPos);
    this.checkStructure(dt);
  }

  private updateThrustMoment(): void {
    const com = this.massModel.com;
    this.thrustMoment.set(0, 0, 0);
    for (const id of ['A', 'B'] as const) {
      const eng = this.engines[id];
      if (eng.thrust <= 0) continue;
      const r = this.tmp.copy(LAYOUT.engines[id]).sub(com);
      this.thrustMoment.add(new Vector3().crossVectors(r, new Vector3(0, 0, -eng.thrust)));
    }
  }

  private updateGear(dt: number): void {
    const g = this.gear;
    if (!this.sep.moduleAttached) {
      g.pos = 0;
      return;
    }
    const lever = this.controls.get('gear');
    const PA = this.hyd.A.pressure;
    if (lever === 0 && g.pos > 0) {
      if (PA > 8) {
        g.pos = Math.max(0, g.pos - dt / 7);
        this.hyd.draw('A', 4);
        if (g.wow && !g.retractOnGround) {
          g.retractOnGround = true;
          this.log('GEAR RETRACTING ON GROUND');
        }
      }
    } else if (lever === 1 && g.pos < 1) {
      const rate = PA > 8 ? 1 / 7 : 1 / 16; // free-fall alternate extension
      g.pos = Math.min(1, g.pos + dt * rate);
      if (PA > 8) this.hyd.draw('A', 3);
    }
    // gear overspeed
    if (g.pos > 0.05 && !g.wow && this.env.eas > 165) {
      const over = (this.env.eas - 165) / 60;
      this.damage.hit('gearNose', over * 0.08 * dt);
      this.damage.hit('gearLeft', over * 0.08 * dt);
      this.damage.hit('gearRight', over * 0.08 * dt);
      this.damage.hit('structure', over * 0.01 * dt);
    }
    // brakes: hydraulic (max A/B) or accumulator
    g.brakeTemp = Math.max(20, g.brakeTemp - (g.brakeTemp - 20) * 0.02 * dt);
  }

  private groundContacts(dt: number, F: Vector3, T: Vector3, com: Vector3, mass: number): void {
    const R = PLANET.radius;
    const c = this.controls;
    const g = this.gear;
    let wow = false;
    let scrape = 0;
    const omegaW = this.tmp2.copy(this.omega).applyQuaternion(this.quat).clone();
    const brakeP = Math.max(this.hyd.A.pressure, this.hyd.B.pressure);
    const brakeCmd = Math.max(c.toeBrake, c.get('parkBrake'));
    let brakeEff = clamp01(brakeP / 10);
    if (brakeEff < 0.6 && g.accumulator > 0) {
      brakeEff = Math.max(brakeEff, 0.75);
      if (this.env.groundSpeed > 0.5 && brakeCmd > 0) g.accumulator = Math.max(0, g.accumulator - dt * 0.08);
    }
    if (g.brakeTemp > 650) brakeEff *= clamp01(1 - (g.brakeTemp - 650) / 400);
    const massScale = mass / 100_000;

    for (const cp of CONTACTS) {
      if (cp.module && !this.sep.moduleAttached) continue;
      if (!this.sep.moduleAttached && cp.name === 'nose') {
        // core-only: nose belly point
      }
      const health = cp.gearKey ? this.damage.health[cp.gearKey] : 0;
      const isWheel = !!cp.ext && this.sep.moduleAttached && g.pos > 0.97 && health > 0.05;
      let bp: Vector3;
      if (cp.ext && this.sep.moduleAttached && health > 0.05) bp = this.tmp.copy(cp.belly).lerp(cp.ext, g.pos);
      else bp = this.tmp.copy(cp.belly);
      const r = bp.sub(com).applyQuaternion(this.quat); // world-oriented lever arm
      const wp = r.clone().add(this.pos);
      const len = wp.length();
      const h = len - R;
      if (h >= 0) continue;
      const n = wp.multiplyScalar(1 / len);
      const pen = -h;
      const vp = new Vector3().crossVectors(omegaW, r).add(this.vel);
      const vn = vp.dot(n);
      const k = isWheel ? 1.5e6 * massScale : 5e6 * massScale;
      const cdamp = isWheel ? 2.6e5 * massScale : 6e5 * massScale;
      let Fn = Math.max(0, k * pen - cdamp * vn);
      const f = n.clone().multiplyScalar(Fn);
      const vt = vp.clone().addScaledVector(n, -vn);

      // impacts
      if (vn < -3.2 && !isWheel) {
        this.fail(this.sep.moduleAttached ? 'crash_runway' : 'crash_ground', `impact ${(-vn).toFixed(1)} m/s at ${cp.name}`, { vn });
        return;
      }
      if (isWheel && cp.gearKey) {
        const limit = 5.2 * this.machine.gearStrength;
        if (vn < -limit || Fn > 2.6e6 * massScale * this.machine.gearStrength) {
          this.damage.health[cp.gearKey] = 0;
          this.log(`GEAR ${cp.name.toUpperCase()} COLLAPSED`);
          this.bus.emit('sfx', { id: 'gear_collapse' });
          this.bus.emit('shake', { amount: 0.8 });
          g.collapsed = true;
          if (vn < -9) {
            this.fail('crash_runway', `touchdown ${(-vn).toFixed(1)} m/s`, { vn });
            return;
          }
        } else if (vn < -2.5) this.damage.hit(cp.gearKey, 0.15);
      }

      if (isWheel) {
        wow = true;
        let steer = 0;
        if (cp.steer && this.env.groundSpeed < 40) steer = c.pedals * 0.18 + (c.get('yawTrim') - 0.5) * 0.05;
        const fwdB = new Vector3(Math.sin(steer), 0, -Math.cos(steer)).applyQuaternion(this.quat);
        const fwd = fwdB.addScaledVector(n, -fwdB.dot(n)).normalize();
        const side = new Vector3().crossVectors(n, fwd);
        const vLong = vt.dot(fwd);
        const vLat = vt.dot(side);
        const brake = cp.main ? brakeCmd * brakeEff : 0;
        const mu = 0.014 + 0.55 * brake;
        const fLong = -Fn * mu * clamp(vLong / 0.35, -1, 1);
        const fLat = -Fn * 0.75 * clamp(vLat / 0.5, -1, 1);
        f.addScaledVector(fwd, fLong).addScaledVector(side, fLat);
        if (brake > 0) g.brakeTemp += (Math.abs(fLong * vLong) * dt) / 2.2e5;
        if (Math.abs(vLong) > 130 && !g.tireBurst) {
          g.tireBurst = true;
          this.damage.hit(cp.gearKey!, 0.4);
          this.bus.emit('sfx', { id: 'tire_burst' });
          this.log('TIRE BURST');
        }
        if (Math.abs(vLat) > 6 && Fn > 1e5) this.damage.hit(cp.gearKey!, 0.05 * dt * Math.abs(vLat));
      } else {
        const vts = vt.length();
        if (vts > 0.01) f.addScaledVector(vt, (-0.45 * Fn * clamp(vts / 0.5, 0, 1)) / vts);
        scrape = Math.max(scrape, vts);
        this.damage.hit('structure', vts * dt * 0.0012);
        this.damage.hit('hull', vts * dt * 0.002);
        if (vts > 75 || (cp.name === 'noseTip' && vts > 30)) {
          this.fail(this.sep.moduleAttached ? 'crash_runway' : 'crash_ground', `ground contact at ${vts.toFixed(0)} m/s`, { vts });
          return;
        }
        if (cp.name === 'tail' && vts > 5) {
          this.flags.tailStrike = true;
        }
      }
      F.add(f);
      const tw = new Vector3().crossVectors(r, f);
      T.add(tw.applyQuaternion(this.tmpQ.copy(this.quat).invert()));
    }
    g.wow = wow;
    this.env.onGround = wow || scrape > 0;
    this.bellyScrape = scrape;
    if (g.brakeTemp > 900 && !this.flags.brakeFire) {
      this.flags.brakeFire = true;
      this.damage.hit('gearLeft', 0.3);
      this.damage.hit('gearRight', 0.3);
      this.log('BRAKE OVERHEAT');
    }
  }

  private checkStructure(dt: number): void {
    const lim = this.structureLimits;
    const e = this.env;
    const rN = e.nz > 0 ? e.nz / lim.nz : e.nz / lim.nzNeg;
    const rQ = e.q / lim.q;
    const rLat = (e.q * Math.abs(e.beta)) / (lim.q * 0.09);
    const r = Math.max(rN, rQ, rLat);
    this.structureLoad = r;
    if (r > 1) {
      this.damage.hit('structure', (r - 1) * 0.5 * dt);
      if (r > 1.08) this.bus.emit('sfx', { id: 'creak', gain: clamp01(r - 1) });
    }
    if (r > 1.55) {
      const which = rQ >= rN && rQ >= rLat ? 'breakup_q' : rLat > rN ? 'breakup_lateral' : 'overload_g';
      this.fail(which, which === 'overload_g' ? `${e.nz.toFixed(1)} G` : `q ${(e.q / 1000).toFixed(0)} kPa`, { nz: e.nz, q: e.q });
      return;
    }
    if (this.damage.health.structure <= 0.02) this.fail('structure', 'airframe integrity lost');
    if (this.thermal.hullTemp > 1720 * this.machine.structure * (this.sep.moduleAttached ? 1 : 0.92)) this.fail('thermal', `hull ${this.thermal.hullTemp.toFixed(0)} K`);
    this.lastVs = e.vs;
  }
}
