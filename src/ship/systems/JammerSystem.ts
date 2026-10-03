import { BAL } from '../../data/Balance';
import { clamp01 } from '../../core/mathutil';
import type { Ship } from '../Ship';

export const JAM_PROFILES = ['NARROW', 'WIDE', 'SPOOF'] as const;

/**
 * Illegal electromagnetic masking unit (aftermarket, bolted to the right console).
 * Capacitor → field emitter. Field strength suppresses radar returns; it costs
 * charge and heat, and its own emission is detectable by government ESM.
 */
export class JammerSystem {
  cap = 0.08; // capacitor 0..1
  temp = 24; // °C
  field = 0; // emitted field 0..~1.6
  active = false;
  runaway = false;
  destroyed = false;
  activeTime = 0; // total masking seconds this run
  flickerPhase = 0;
  /** extra heat from events (thermal runaway) °C/s */
  extraHeat = 0;

  get powered(): boolean {
    return this._powered;
  }
  private _powered = false;

  update(dt: number, ship: Ship): void {
    const c = ship.controls;
    const m = ship.machine;
    const health = ship.damage.health.jammer;
    this._powered = c.get('cb_jam') === 1 && ship.elec.volts.JAM > 19 && !this.destroyed;
    const pf = ship.elec.factor('JAM');

    // charging
    if (c.get('jamCharge') === 1 && this._powered) {
      ship.elec.demand('JAM', BAL.jamChargeKw * (this.cap < 1 ? 1 : 0.1));
      if (this.cap < 1) this.cap = Math.min(1, this.cap + BAL.jamChargeRate * pf * dt * health);
      this.temp += 0.35 * dt;
    }
    if (this._powered) ship.elec.demand('JAM', 1.5);

    // cooling
    const coolSw = c.get('jamCool') === 1 && this._powered;
    if (coolSw) ship.elec.demand('JAM', 4);
    const cool = coolSw ? 0.55 + 1.2 * ship.thermal.driveCooling('jammer') : 0.12;

    const armed = c.get('jamArm') === 1;
    const engage = c.get('jamEngage') === 1;
    const overdrive = c.get('jamOverdrive') === 1;
    const profile = c.get('jamProfile');
    this.active = this._powered && armed && engage && this.cap > 0.004 && health > 0.05;

    if (this.active) {
      const capSec = BAL.jamNominalSeconds * m.jamCap * (0.85 + 0.15 * health);
      const profMul = profile === 1 ? 1.22 : profile === 2 ? 0.92 : 1;
      const hot = 1 + Math.max(0, this.temp - 85) / 55;
      const drain = (dt / capSec) * profMul * (overdrive ? 2.3 : 1) * hot;
      this.cap = Math.max(0, this.cap - drain);
      ship.elec.demand('JAM', 15 + (overdrive ? 30 : 0));
      this.temp += BAL.jamHeatEngaged * m.jamHeat * (overdrive ? 2.8 : 1) * dt;
      this.activeTime += dt;
      // field: weakens and flickers as the capacitor nears empty / overheats
      let f = Math.pow(clamp01(this.cap / 0.12), 0.5) * pf;
      if (this.cap < 0.12) {
        this.flickerPhase += dt * (8 + ship.rng.next() * 30);
        f *= 0.6 + 0.4 * Math.abs(Math.sin(this.flickerPhase));
      }
      const thermalEff = this.temp > BAL.jamTempLimit ? clamp01(1 - (this.temp - BAL.jamTempLimit) / 50) : 1;
      this.field = f * thermalEff * health * (overdrive ? 1.55 : 1);
    } else {
      this.field = 0;
    }

    this.temp += this.extraHeat * dt;
    this.temp -= cool * Math.max(0, this.temp - 20) * 0.03 * dt;
    // thermal runaway — component roll decides the threshold
    const runawayAt = BAL.jamTempRunaway * m.jamRunaway;
    if (this.temp > runawayAt && !this.runaway && this._powered) {
      this.runaway = true;
      ship.log('JAMMER THERMAL RUNAWAY');
      ship.bus.emit('sfx', { id: 'alarm_jam' });
    }
    if (this.runaway) {
      if (this._powered || this.cap > 0.05) this.temp += (2.6 + this.cap * 3) * dt;
      else if (this.temp < runawayAt - 25) this.runaway = false;
      ship.damage.hit('jammer', 0.01 * dt);
    }
    if (this.temp > 215 && !this.destroyed) {
      this.destroyed = true;
      this.field = 0;
      this.cap = 0;
      ship.damage.health.jammer = 0;
      ship.elec.shortCircuit.B += 30;
      ship.elec.fire.bus = ship.elec.fire.bus ?? 'B';
      ship.bus.emit('sfx', { id: 'explosion_small' });
      ship.bus.emit('shake', { amount: 0.5 });
      ship.log('JAMMER DESTROYED');
    }
  }

  /** Signature suppression against radar (0 = no effect, →1 = invisible). */
  radarSuppression(profile: number): number {
    const base = profile === 0 ? 0.93 : profile === 1 ? 0.8 : 0.55;
    return clamp01(this.field * base);
  }

  /** How loud the jammer is to passive receivers. */
  emission(profile: number): number {
    return this.field * (profile === 1 ? 1.4 : profile === 2 ? 0.7 : 1);
  }
}
