import type { Ship } from './Ship';

export const HEALTH_KEYS = [
  'structure', 'hull', 'engA', 'engB', 'genA', 'genB', 'busA', 'busB', 'hydA', 'hydB', 'coolA', 'coolB',
  'fuelPumpA', 'fuelPumpB', 'surfaces', 'rcs', 'avionics', 'xpdr', 'nav', 'jammer', 'coilA', 'coilB',
  'gearNose', 'gearLeft', 'gearRight', 'sensors',
] as const;
export type HealthKey = (typeof HEALTH_KEYS)[number];

/** Per-subsystem health 0..1. Systems read it; physics/events/fire write it. */
export class DamageModel {
  health: Record<string, number> = {};
  log: string[] = [];
  constructor() {
    for (const k of HEALTH_KEYS) this.health[k] = 1;
  }

  hit(key: string, amount: number): void {
    if (!(key in this.health) || amount <= 0) return;
    this.health[key] = Math.max(0, this.health[key] - amount);
  }

  /** Aggregate 0..1 damage figure for the results screen. */
  overall(): number {
    let s = 0;
    for (const k of HEALTH_KEYS) s += 1 - this.health[k];
    return s / HEALTH_KEYS.length;
  }

  /** Random subsystem damage (micrometeor, collision). */
  randomHit(ship: Ship, severity: number): string {
    const keys = ['hydA', 'hydB', 'coolA', 'coolB', 'rcs', 'avionics', 'xpdr', 'nav', 'jammer', 'coilA', 'coilB', 'fuelPumpA', 'fuelPumpB', 'busA', 'busB', 'sensors'];
    const k = ship.rng.pick(keys);
    this.hit(k, severity);
    if (k === 'hydA' || k === 'hydB') ship.hyd[k === 'hydA' ? 'A' : 'B'].leak += 0.02 * severity * 5;
    if (k === 'coolA' || k === 'coolB') ship.thermal.loop[k === 'coolA' ? 'A' : 'B'].leak += 0.015 * severity * 5;
    this.hit('structure', severity * 0.15);
    return k;
  }
}
