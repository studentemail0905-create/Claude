import { BAL } from '../../data/Balance';
import { clamp, clamp01, logistic, RAD } from '../../core/mathutil';
import type { Ship } from '../Ship';

export interface StabilityBreakdown {
  atmosphere: number;
  rate: number;
  alignment: number;
  charge: number;
  sync: number;
  coilTemp: number;
  power: number;
  coils: number;
  total: number;
}

export type JumpResult =
  | { ok: true; stability: number; p: number }
  | { ok: false; stability: number; p: number; cause: string; detail: string };

/**
 * Interstellar jump drive (fictional physics, engineered behaviour).
 * Capacitor energy requirement scales with vessel mass — with the module attached
 * it cannot physically reach the required field.
 */
export class JumpDriveSystem {
  charge = 0; // absolute units; 1.0 = full capacitor
  coilTemp = 38; // K
  coilsArmed = false;
  syncProgress = 0; // 0..1
  syncing = false;
  synced = false;
  syncAge = 0;
  stability: StabilityBreakdown = { atmosphere: 0, rate: 0, alignment: 0, charge: 0, sync: 0, coilTemp: 0, power: 0, coils: 0, total: 0 };
  arcing = 0;
  dumping = 0;
  sequence = -1; // >=0 while the engage sequence is spooling
  quenched = { A: false, B: false };
  atmosphericPlasmaHeat = 0;
  signature = 0; // gravimetric signature 0..1 for government sensors
  controlPowered = false;
  attempted = false;
  result: JumpResult | null = null;
  /** event modifiers */
  arcRiskMul = 1;
  private lastEngageEdge = false;

  get required(): number {
    return 0; // replaced in update (kept for typing)
  }
  requiredCharge = 2;

  update(dt: number, ship: Ship): void {
    const c = ship.controls;
    const m = ship.machine;
    const jv = ship.elec.volts.JUMP;
    this.controlPowered = c.get('cb_jump') === 1 && jv > 19;
    if (c.get('cb_jump') === 1 && jv > 1) ship.elec.demand('JUMP', 2);
    this.requiredCharge = ship.massModel.mass / BAL.jumpRefMass;
    const rho = ship.env.atmo.density;

    // capacitor charging (no cutoff — the operator is the cutoff)
    if (c.get('jumpCharge') === 1 && this.controlPowered && this.dumping <= 0) {
      const pf = ship.elec.factor('JUMP');
      ship.elec.demand('JUMP', BAL.jumpChargeKw);
      this.charge += BAL.jumpChargeRate * pf * m.jumpChargeRate * dt;
    }
    // capacitor self-leak
    this.charge = Math.max(0, this.charge - this.charge * 0.0015 * dt);

    if (c.pressed('capDump') && this.controlPowered && this.charge > 0.01) {
      this.dumping = 2;
      ship.bus.emit('sfx', { id: 'cap_dump' });
    }
    if (this.dumping > 0) {
      this.dumping -= dt;
      const d = Math.min(this.charge, this.charge * dt * 2.5 + 0.02 * dt);
      this.charge -= d;
      this.coilTemp += d * 22;
    }

    // overcharge arcs
    const arcThreshold = BAL.jumpOvercharge * m.capTolerance;
    this.arcing = Math.max(0, this.arcing - dt * 2);
    if (this.charge > arcThreshold) {
      if (ship.rng.chance(dt * 2.5 * (this.charge - arcThreshold + 0.05) * 10 * this.arcRiskMul)) {
        this.arcing = 1;
        ship.bus.emit('sfx', { id: 'arc' });
        ship.bus.emit('shake', { amount: 0.2 });
        ship.damage.hit(ship.rng.chance(0.5) ? 'coilA' : 'coilB', 0.04);
        ship.elec.noise = Math.max(ship.elec.noise, 0.5);
      }
    }
    if (this.charge > BAL.jumpExplode * m.capTolerance) {
      ship.fail('capacitor', 'Jump capacitor overload', { charge: this.charge });
      return;
    }

    // coils
    const armSw = c.get('coilArm') === 1;
    this.coilsArmed = armSw && this.controlPowered && (ship.damage.health.coilA > 0.05 || ship.damage.health.coilB > 0.05);
    if (armSw && this.controlPowered) ship.elec.demand('JUMP', 8);
    const coolF = ship.thermal.driveCooling('coils');
    let heat = 0.15;
    if (this.coilsArmed) heat += (0.5 + this.charge * 1.1) * m.coilHeat;
    // charging in atmosphere: ionised air loads the field
    const plasma = this.coilsArmed || this.charge > 0.05 ? clamp01((Math.log10(Math.max(rho, 1e-14)) + 8) / 8) * this.charge : 0;
    heat += plasma * 3.5;
    this.atmosphericPlasmaHeat = plasma * 9000;
    const cooling = (0.2 + coolF * 1.6) * Math.max(0, this.coilTemp - 30) / 10;
    this.coilTemp += (heat - cooling) * dt;
    this.coilTemp = Math.max(30, this.coilTemp);
    // quench
    for (const k of ['A', 'B'] as const) {
      if (!this.quenched[k] && this.coilTemp > 74 * m.coilQuench && ship.rng.chance(dt * 0.4)) this.quench(ship, k);
    }

    // sync
    if (c.pressed('jumpSync') && this.coilsArmed) {
      this.syncing = true;
      this.syncProgress = 0;
      ship.bus.emit('sfx', { id: 'sync_start' });
    }
    const rateDeg = ship.omegaDegMag;
    if (this.syncing) {
      if (!this.coilsArmed) this.syncing = false;
      else if (rateDeg > 4) {
        this.syncProgress = Math.max(0, this.syncProgress - dt);
      } else this.syncProgress += dt / 5;
      if (this.syncProgress >= 1) {
        this.syncing = false;
        this.synced = true;
        this.syncAge = 0;
        ship.bus.emit('sfx', { id: 'sync_done' });
      }
    }
    if (this.synced) {
      this.syncAge += dt;
      if (!this.coilsArmed || rateDeg > 8 || ship.avionics.clockDesync && this.syncAge > 3) {
        this.synced = false;
        ship.log('DRIVE SYNC LOST');
      }
    }

    this.signature = clamp01(this.charge * 0.6 + (this.coilsArmed ? 0.25 : 0) + plasma * 0.6);
    this.computeStability(ship);

    // ENGAGE: mechanical interlock blocks the button unless the safety is pulled.
    const engage = c.pressed('jumpEngage');
    if (engage && !this.lastEngageEdge) {
      if (c.get('safetyPin') !== 1) ship.bus.emit('sfx', { id: 'clunk' });
      else if (!this.coilsArmed || !this.controlPowered) ship.bus.emit('sfx', { id: 'button_dead' });
      else if (this.sequence < 0) {
        this.sequence = 0;
        this.attempted = true;
        ship.bus.emit('jump', { phase: 'start' });
        ship.bus.emit('sfx', { id: 'jump_spool' });
      }
    }
    this.lastEngageEdge = engage;
    if (this.sequence >= 0) {
      this.sequence += dt;
      if (this.sequence >= 1.6) {
        this.sequence = -1;
        this.resolve(ship);
      }
    }
  }

  quench(ship: Ship, k: 'A' | 'B'): void {
    this.quenched[k] = true;
    ship.damage.hit('coil' + k, 0.5);
    this.charge *= 0.7;
    this.coilTemp += 18;
    this.synced = false;
    ship.log(`COIL ${k} QUENCH`);
    ship.bus.emit('sfx', { id: 'quench' });
    ship.bus.emit('shake', { amount: 0.35 });
  }

  computeStability(ship: Ship): StabilityBreakdown {
    const s = this.stability;
    const rho = Math.max(1e-16, ship.env.atmo.density);
    s.atmosphere = 1 / (1 + Math.exp(1.41 * (Math.log10(rho) + 5.47)));
    s.rate = Math.exp(-((ship.omegaDegMag / 2.2) ** 2));
    const err = this.alignmentError(ship);
    s.alignment = Math.exp(-((err / 8) ** 2));
    const r = this.charge / Math.max(0.01, this.requiredCharge);
    s.charge = r < 1.03 ? Math.exp(-(((r - 1.03) / 0.12) ** 2)) : Math.exp(-(((r - 1.03) / 0.09) ** 2));
    s.sync = this.synced ? 1 - Math.min(0.15, this.syncAge / 600) : this.syncing ? 0.6 : 0.5;
    s.coilTemp = this.coilTemp < 46 ? 1 : Math.exp(-(((this.coilTemp - 46) / 18) ** 2));
    const jv = ship.elec.volts.JUMP;
    s.power = clamp01((jv - 20) / 6) ** 0.5 * (1 - ship.elec.noise * 0.3);
    const hc = (ship.damage.health.coilA + ship.damage.health.coilB) / 2;
    s.coils = clamp(ship.machine.coilQuality * (0.4 + 0.6 * hc), 0, 1.02) * (this.quenched.A || this.quenched.B ? 0.8 : 1);
    s.total = this.coilsArmed ? clamp01(s.atmosphere * s.rate * s.alignment * s.charge * s.sync * s.coilTemp * s.power * s.coils) : 0;
    return s;
  }

  alignmentError(ship: Ship): number {
    const esc = ship.escapeVector;
    const fwd = ship.forward();
    const ang = Math.acos(clamp(fwd.dot(esc), -1, 1)) * RAD;
    return ang;
  }

  /** P(success) as a function of field stability — steep logistic curve. */
  static successProbability(S: number): number {
    return Math.min(0.992, logistic((S - 0.86) * 30));
  }

  private resolve(ship: Ship): void {
    const S = this.computeStability(ship).total;
    const st = this.stability;
    const r = this.charge / this.requiredCharge;
    let result: JumpResult;
    if (r < 0.55) {
      // field never forms: fizzle, dump energy into coils
      this.coilTemp += this.charge * 25;
      this.charge = 0;
      this.synced = false;
      ship.log('FIELD COLLAPSE — INSUFFICIENT CHARGE');
      ship.bus.emit('sfx', { id: 'fizzle' });
      ship.bus.emit('jump', { phase: 'fail' });
      return;
    }
    const p = JumpDriveSystem.successProbability(S);
    const navErr = ship.avionics.solutionError(ship) + this.alignmentError(ship) * 0.5;
    const roll = ship.rngEvents.next();
    if (!ship.avionics.solutionValid || !ship.avionics.escLoaded) {
      result = { ok: false, stability: S, p, cause: 'navigation', detail: 'no jump solution' };
    } else if (navErr > 14) {
      result = { ok: false, stability: S, p, cause: 'navigation', detail: `solution error ${navErr.toFixed(1)}°` };
    } else if (roll < p) {
      result = { ok: true, stability: S, p };
    } else {
      // pick the weakest factor as the failure mode
      const f: [string, number][] = [
        ['atmosphere', st.atmosphere], ['rate', st.rate], ['alignment', st.alignment], ['charge', st.charge],
        ['coilTemp', st.coilTemp], ['power', st.power], ['coils', st.coils], ['sync', st.sync],
      ];
      f.sort((a, b) => a[1] - b[1]);
      result = { ok: false, stability: S, p, cause: 'jump_' + f[0][0], detail: `field stability ${(S * 100).toFixed(1)}%` };
    }
    this.result = result;
    ship.onJumpResolved(result);
  }
}
