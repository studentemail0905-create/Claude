import { Vector3 } from 'three';
import { clamp, DEG, approach } from '../../core/mathutil';
import { HYD_NOMINAL } from './HydraulicSystem';
import { RCSSystem } from './RCSSystem';
import type { Ship } from '../Ship';

const TVC_MAX = 6 * DEG;

/**
 * Fly-by-wire flight control computer.
 *  DIRECT: stick → surfaces/TVC/RCS proportionally (SAS adds rate damping).
 *  NORM:   rate-command / attitude-hold, allocates torque across aero, TVC and RCS.
 * Nothing switches automatically — if RCS is off in vacuum, the stick does (almost) nothing.
 */
export class FlightControlSystem {
  de = 0;
  da = 0;
  dr = 0;
  surfaceAuth = 0;
  computerOn = false;
  apEngaged = false;
  holdAtt: { pitch: number; roll: number; heading: number } | null = null;
  /** Calibration fault injected by events: offset added to stick. */
  stickOffset = { pitch: 0, roll: 0 };
  gLimiter = true;
  lastCmd = new Vector3();
  degraded = false;
  apDisconnectTimer = 0;
  private overrideTimer = 0;
  integ = new Vector3();
  private holdTimer = 0;

  update(dt: number, ship: Ship): void {
    const c = ship.controls;
    const env = ship.env;
    this.computerOn = c.get('cb_fcs') === 1 && ship.elec.factor('AV') > 0.3;
    if (c.get('cb_fcs') === 1) ship.elec.demand('AV', 1.5);
    const sas = c.get('sas') === 1 && this.computerOn;
    const norm = c.get('fcsMode') === 1 && this.computerOn;
    this.degraded = c.get('fcsMode') === 1 && !this.computerOn;

    // Hydraulic surface authority and rate limit
    const P = ship.hyd.surfacePressure;
    const hydAuth = clamp((P - 2) / (HYD_NOMINAL * 0.65 - 2), 0, 1);
    // hinge moment limit at high dynamic pressure with weak hydraulics
    const hinge = clamp((P / HYD_NOMINAL) / Math.max(0.15, env.q / 45_000), 0, 1);
    this.surfaceAuth = Math.min(hydAuth, hinge) * ship.damage.health.surfaces;

    let sp = clamp(c.stickPitch + this.stickOffset.pitch, -1, 1);
    let sr = clamp(c.stickRoll + this.stickOffset.roll, -1, 1);
    let yp = c.pedals;
    const pitchTrim = (c.get('pitchTrim') - 0.5) * 2; // -1..1
    const yawTrim = (c.get('yawTrim') - 0.5) * 2;

    // Autopilot
    const apSwitch = c.get('apMaster') === 1;
    const pilotInput = Math.abs(c.stickPitch) + Math.abs(c.stickRoll) > 0.35;
    if (apSwitch && pilotInput) this.overrideTimer += dt;
    else this.overrideTimer = 0;
    if (apSwitch && (this.overrideTimer > 0.25 || !norm)) {
      c.set('apMaster', 0, true);
      ship.bus.emit('sfx', { id: 'ap_disconnect' });
      this.apDisconnectTimer = 2;
    }
    this.apDisconnectTimer = Math.max(0, this.apDisconnectTimer - dt);
    this.apEngaged = c.get('apMaster') === 1 && norm;

    const I = ship.massModel.inertia;
    const w = ship.omega; // body rates
    const att = env.attitude;
    const torqueCmd = new Vector3();
    const mt = RCSSystem.maxTorque;

    // available authority per axis
    const cfg = ship.aeroConfig;
    const qS = env.q * cfg.S;
    const aeroMax = new Vector3(qS * cfg.c * cfg.cmd, qS * cfg.b * cfg.cnd, qS * cfg.b * cfg.cld).multiplyScalar(this.surfaceAuth * (env.mach > 1.2 ? Math.min(0.9, 1.1 / Math.sqrt(env.mach)) : 1));
    const tvcOn = c.get('tvc') === 1 && this.computerOn && ship.hyd.B.pressure > 6;
    const thrust = ship.engines.A.thrust + ship.engines.B.thrust;
    const arm = Math.max(1, 17.5 - ship.massModel.com.z);
    const tvcMax = tvcOn ? thrust * Math.sin(TVC_MAX) * arm : 0;
    const rcsRot = ship.rcs.rotEnabled;

    // Thrust-line moment the TVC must null (engines below/above COM)
    const thrustLine = ship.thrustMoment; // body torque from thrust offset

    if (norm) {
      const post = !ship.sep.moduleAttached;
      const maxRate = new Vector3(post ? 28 : 12, post ? 14 : 7, post ? 120 : 45).multiplyScalar(DEG);
      let rp: number, rr: number, ry: number;
      if (this.apEngaged) {
        const ap = ship.flightDirector.apCommand(ship);
        rp = ap.pitchRate;
        rr = ap.rollRate;
        ry = ap.yawRate;
      } else {
        rp = sp * maxRate.x + pitchTrim * 3 * DEG;
        rr = sr * maxRate.z;
        ry = (yp + yawTrim * 0.3) * maxRate.y;
        // per-axis attitude hold when that axis is hands-off (SAS)
        const handsP = Math.abs(sp) > 0.04;
        const handsR = Math.abs(sr) > 0.04;
        if (!sas || (handsP && handsR)) {
          this.holdTimer = 0;
          this.holdAtt = null;
        } else {
          this.holdTimer += dt;
          if (!this.holdAtt || this.holdTimer < 0.5) this.holdAtt = { pitch: att.pitch, roll: att.roll, heading: att.heading };
          if (handsP) this.holdAtt.pitch = att.pitch;
          if (handsR) this.holdAtt.roll = att.roll;
          if (this.holdTimer >= 0.5) {
            if (!handsP) rp += clamp((this.holdAtt.pitch - att.pitch) * 1.2, -maxRate.x, maxRate.x);
            if (!handsR && Math.abs(att.pitch) < 80 * DEG) rr += clamp(wrapPi(this.holdAtt.roll - att.roll) * 1.5, -maxRate.z * 0.5, maxRate.z * 0.5);
          }
        }
      }
      // G limiter
      const nzLim = ship.structureLimits.nz * 0.92;
      if (env.nz > nzLim && rp > 0) rp *= clamp(1 - (env.nz - nzLim) / 1.0, 0, 1);
      if (env.nz < -1.2 && rp < 0) rp *= 0.3;
      // coordinated turn in atmosphere: add yaw to kill sideslip
      if (sas && env.q > 2000 && !ship.gear.wow) ry += clamp(env.beta * 2.5, -maxRate.y, maxRate.y);
      const k = sas ? 4 : 1.6;
      // desired body rates: x pitch(+up), y = -yawRight, z = -rollRight
      const ex = rp - w.x, ey = -ry - w.y, ez = -rr - w.z;
      const ki = sas ? 2.2 : 0.8;
      this.integ.x = clamp(this.integ.x + ex * dt * ki, -0.25, 0.25);
      this.integ.y = clamp(this.integ.y + ey * dt * ki, -0.15, 0.15);
      this.integ.z = clamp(this.integ.z + ez * dt * ki, -0.3, 0.3);
      torqueCmd.set(I.x * (k * ex + k * this.integ.x), I.y * (k * ey + k * this.integ.y), I.z * (k * ez + k * this.integ.z));
      torqueCmd.addScaledVector(thrustLine, tvcOn ? -1 : 0);
      // allocation
      const out = allocate(torqueCmd, aeroMax, tvcMax, rcsRot ? mt : null);
      this.de = approach(this.de, out.aero.x, 0.08, dt);
      this.dr = approach(this.dr, -out.aero.y, 0.08, dt);
      this.da = approach(this.da, -out.aero.z, 0.06, dt);
      ship.tvcCmd.set(out.tvc.x, out.tvc.y);
      ship.rcs.rotCmd.copy(out.rcs);
      if (tvcOn) {
        // the TVC also nulls the thrust-line moment
      }
    } else {
      this.integ.set(0, 0, 0);
      // DIRECT (or FCS computer dead — direct electrical backup, no TVC)
      let de = sp + pitchTrim * 0.45;
      let da = sr;
      let dr = yp + yawTrim * 0.45;
      if (sas) {
        de -= w.x * 2.5;
        da -= -w.z * 0.9;
        dr -= -w.y * 2.2;
      }
      this.de = approach(this.de, clamp(de, -1, 1), 0.05, dt);
      this.da = approach(this.da, clamp(da, -1, 1), 0.05, dt);
      this.dr = approach(this.dr, clamp(dr, -1, 1), 0.05, dt);
      if (tvcOn) {
        const nullP = clamp(-thrustLine.x / Math.max(1, tvcMax), -1, 1);
        ship.tvcCmd.set(clamp(sp + nullP, -1, 1), clamp(-yp, -1, 1));
      } else ship.tvcCmd.set(0, 0);
      if (rcsRot) {
        const dz = (v: number) => (Math.abs(v) < 0.1 ? 0 : Math.sign(v) * Math.min(1, (Math.abs(v) - 0.1) / 0.6));
        ship.rcs.rotCmd.set(dz(sp), dz(-yp), dz(-sr));
        if (sas) ship.rcs.rotCmd.add(new Vector3(-w.x * 4, -w.y * 4, -w.z * 3)).clampScalar(-1, 1);
      }
    }
    // hydraulic usage
    ship.hyd.draw('AB', (Math.abs(this.de) + Math.abs(this.da) + Math.abs(this.dr)) * 0.6 * (0.3 + env.q / 40_000));
    if (tvcOn) ship.hyd.draw('B', (Math.abs(ship.tvcCmd.x) + Math.abs(ship.tvcCmd.y)) * 0.8);
    this.lastCmd.copy(torqueCmd);
  }
}

function wrapPi(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Split a torque demand across aero surfaces, TVC and RCS (normalised outputs). */
function allocate(t: Vector3, aeroMax: Vector3, tvcMax: number, rcsMax: Vector3 | null) {
  const aero = new Vector3();
  const tvc = new Vector3();
  const rcs = new Vector3();
  const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
  for (const a of axes) {
    let rem = t[a];
    const am = aeroMax[a];
    if (am > 1) {
      const use = clamp(rem, -am, am);
      aero[a] = use / am;
      rem -= use;
    }
    if (a !== 'z' && tvcMax > 1) {
      const use = clamp(rem, -tvcMax, tvcMax);
      tvc[a] = use / tvcMax;
      rem -= use;
    }
    if (rcsMax && rcsMax[a] > 0) {
      rcs[a] = clamp(rem / rcsMax[a], -1, 1);
    }
  }
  return { aero, tvc, rcs };
}
