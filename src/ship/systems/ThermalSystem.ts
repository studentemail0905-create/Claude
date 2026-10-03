import { BAL } from '../../data/Balance';
import { clamp01 } from '../../core/mathutil';
import type { Ship } from '../Ship';

const SIGMA = 5.670374e-8;

/**
 * Coolant loops A/B and the lumped hull-skin temperature.
 * Loop A serves Engine A + avionics + jump coils. Loop B serves Engine B + jammer + jump coils.
 * COOLANT PRIORITY splits each loop's capacity between propulsion and the "drive" consumers.
 */
export class ThermalSystem {
  hullTemp = 295; // K
  heatFlux = 0; // W/m² convective into skin
  stagnationTemp = 288;
  loop = {
    A: { quantity: 1, leak: 0, running: false, capacity: 0 },
    B: { quantity: 1, leak: 0, running: false, capacity: 0 },
  };
  /** Externally degraded efficiency (events). */
  effMul = { A: 1, B: 1 };

  private prioShares(ship: Ship): { eng: number; drive: number } {
    const p = ship.controls.get('coolPrio');
    return p === 0 ? { eng: 1, drive: 0.35 } : p === 1 ? { eng: 0.8, drive: 0.7 } : { eng: 0.5, drive: 1 };
  }

  /** 0..1 cooling available to an engine. */
  engineCooling(id: 'A' | 'B'): number {
    return this.loop[id].capacity * this._shares.eng;
  }

  /** 0..1 cooling available to jammer (loop B) or coils (A+B). */
  driveCooling(which: 'jammer' | 'coils'): number {
    if (which === 'jammer') return this.loop.B.capacity * this._shares.drive;
    return ((this.loop.A.capacity + this.loop.B.capacity) / 2) * this._shares.drive;
  }

  private _shares = { eng: 0.8, drive: 0.7 };

  update(dt: number, ship: Ship): void {
    const c = ship.controls;
    const m = ship.machine;
    this._shares = this.prioShares(ship);
    const rho = ship.env.atmo.density;
    // Radiators dump heat better into dense air.
    const radiator = 0.78 + 0.22 * clamp01(rho / 0.3);
    for (const id of ['A', 'B'] as const) {
      const L = this.loop[id];
      const sw = c.get('cool' + id) === 1;
      if (sw) ship.elec.demand(id, 5);
      const pf = ship.elec.factor(id);
      L.running = sw && pf > 0.25 && L.quantity > 0.05;
      L.quantity = Math.max(0, L.quantity - L.leak * dt);
      L.capacity = L.running ? pf * m.coolEff[id] * this.effMul[id] * clamp01(L.quantity / 0.35) * radiator * ship.damage.health['cool' + id] : 0;
    }

    // Hull skin heating: Sutton–Graves stagnation heating bounded by recovery temperature.
    const v = ship.env.tas;
    const Tamb = ship.env.atmo.temperature;
    const mach = ship.env.mach;
    this.stagnationTemp = Tamb * (1 + 0.2 * mach * mach * 0.89);
    const qSG = 1.83e-4 * Math.sqrt(rho / BAL.noseRadius) * v * v * v * 0.55;
    const hcoef = qSG / Math.max(50, this.stagnationTemp - 300);
    const qIn = hcoef * (this.stagnationTemp - this.hullTemp);
    this.heatFlux = qIn;
    const plasma = ship.jump.atmosphericPlasmaHeat; // W/m² from charging drive in air
    const Tenv = rho > 1e-4 ? Tamb : 250;
    const qOut = BAL.hullEmissivity * SIGMA * (Math.pow(this.hullTemp, 4) - Math.pow(Tenv, 4));
    // small conductive soak from engine fire
    const fire = (ship.engines.A.fire + ship.engines.B.fire) * 4000;
    const cap = BAL.hullHeatCapPerArea * (ship.sep.moduleAttached ? 1 : 0.85);
    this.hullTemp += ((qIn - qOut + plasma + fire) / cap) * dt;
    this.hullTemp = Math.max(150, this.hullTemp);

    const tol = ship.machine.structure * (ship.sep.moduleAttached ? 1 : 0.92);
    if (this.hullTemp > BAL.hullDamage * tol) {
      ship.damage.hit('structure', ((this.hullTemp - BAL.hullDamage * tol) / 300) * 0.05 * dt);
      ship.damage.hit('hull', ((this.hullTemp - BAL.hullDamage * tol) / 300) * 0.08 * dt);
    }
  }
}
