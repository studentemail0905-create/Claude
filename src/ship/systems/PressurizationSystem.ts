import { clamp01 } from '../../core/mathutil';
import type { Ship } from '../Ship';

/**
 * Cockpit and passenger cabin pressures (Pa).
 * COCKPIT SEAL door joins/splits the two volumes. CABIN ISOLATION closes the cabin's
 * supply duct from the core pressurisation pack. DUMP opens the outflow valves.
 */
export class PressurizationSystem {
  cockpit = 101_325;
  cabin = 101_325;
  o2Quantity = 1;
  hypoxia = 0; // 0..1 → blackout
  cockpitLeak = 0; // m² effective hole area
  cabinLeak = 0;
  ductRuptured = false;
  podBaysOpen = 0; // count of open pod docking hatches
  explosive = 0; // recent explosive decompression intensity (for effects)
  packRunning = false;

  update(dt: number, ship: Ship): void {
    const c = ship.controls;
    const pAmb = ship.env.atmo.pressure;
    const mode = c.get('pressMode');
    const sealed = c.get('cockpitSeal') === 1;
    const isol = c.get('cabinIsol') === 1;
    const attached = ship.sep.moduleAttached;
    const ctl = c.get('cb_press') === 1 && ship.elec.factor('A') > 0.3;
    if (c.get('cb_press') === 1) ship.elec.demand('A', 6);
    this.packRunning = ctl && mode !== 2;

    const Vc = 14;
    const Vk = 160;
    const target = mode === 0 ? Math.max(pAmb, 78_000) : 70_000;

    // pack supply (Pa/s for the cockpit volume) – limited air mass.
    let supply = 0;
    if (this.packRunning) supply = Math.max(0, target - this.cockpit) * 0.8;
    if (this.ductRuptured) supply *= 0.15;

    const flow = (p: number, area: number, vol: number) => {
      // choked-ish orifice outflow approximation (Pa/s)
      const dp = p - pAmb;
      if (dp <= 0) return 0;
      return (Math.sqrt(dp) * 950 * area * 1000) / vol;
    };

    // outflow (normal leakage + dump)
    const dumpArea = mode === 2 ? 0.06 : 0;
    let dC = supply - flow(this.cockpit, 0.0004 + this.cockpitLeak + dumpArea, Vc);

    if (attached) {
      let supplyK = 0;
      if (this.packRunning && !isol) supplyK = Math.max(0, target - this.cabin) * 0.35;
      const podHoles = this.podBaysOpen * 0.35;
      let dK = supplyK - flow(this.cabin, 0.001 + this.cabinLeak + podHoles + dumpArea * 0.5, Vk);
      if (!sealed) {
        // door open: volumes equalise quickly
        const eq = (this.cockpit - this.cabin) * 3.5;
        dC -= eq;
        dK += (eq * Vc) / Vk;
      }
      this.cabin = Math.max(pAmb * 0.98, this.cabin + dK * dt);
      if (this.cabin < pAmb) this.cabin = pAmb;
    } else {
      this.cabin = pAmb;
      if (!sealed) dC -= flow(this.cockpit, 1.2, Vc); // open to space where the cabin was
    }
    const before = this.cockpit;
    this.cockpit = Math.max(pAmb, this.cockpit + dC * dt);
    if (this.cockpit < 0) this.cockpit = 0;
    const rate = (before - this.cockpit) / Math.max(dt, 1e-6);
    this.explosive = Math.max(this.explosive * Math.exp(-dt * 1.5), clamp01(rate / 40_000));

    // Pilot oxygen
    const o2 = c.get('o2') === 1 && ship.elec.powered('EMER', 18) && this.o2Quantity > 0;
    if (c.get('o2') === 1) this.o2Quantity = Math.max(0, this.o2Quantity - dt / 1500);
    if (!o2 && this.cockpit < 57_000) {
      const sev = clamp01((57_000 - this.cockpit) / 45_000);
      this.hypoxia = Math.min(1, this.hypoxia + dt * (0.004 + sev * sev * 0.09));
    } else this.hypoxia = Math.max(0, this.hypoxia - dt * 0.05);
  }

  /** Cockpit altitude equivalent (m) for the gauge. */
  get cockpitAltitude(): number {
    const p = Math.max(1, this.cockpit);
    return 44330 * (1 - Math.pow(p / 101325, 0.1903));
  }
}
