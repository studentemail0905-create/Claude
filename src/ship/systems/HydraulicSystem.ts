import { clamp01 } from '../../core/mathutil';
import type { Ship } from '../Ship';

/** One hydraulic circuit: electric pump → pressure (MPa) → actuators. */
export class HydCircuit {
  pressure = 0;
  quantity = 1; // reservoir fraction
  leak = 0; // fraction per second
  demand = 0; // MPa/s requested by actuators this tick
  pumpRunning = false;
  constructor(public id: 'A' | 'B') {}
}

export const HYD_NOMINAL = 20.7;

export class HydraulicSystem {
  A = new HydCircuit('A');
  B = new HydCircuit('B');

  /** Actuators call this with an activity level (normalised actuator speed). */
  draw(circuit: 'A' | 'B' | 'AB', amount: number): void {
    if (circuit === 'AB') {
      const tot = this.A.pressure + this.B.pressure;
      if (tot <= 0) return;
      this.A.demand += (amount * this.A.pressure) / tot;
      this.B.demand += (amount * this.B.pressure) / tot;
    } else this[circuit].demand += amount;
  }

  /** Best available pressure for dual-redundant actuators (control surfaces). */
  get surfacePressure(): number {
    return Math.max(this.A.pressure, this.B.pressure);
  }

  update(dt: number, ship: Ship): void {
    const c = ship.controls;
    for (const h of [this.A, this.B]) {
      const bus = h.id;
      const sw = c.get('hyd' + h.id) === 1;
      const pf = ship.elec.factor(bus);
      const health = ship.damage.health['hyd' + h.id];
      h.pumpRunning = sw && pf > 0.25 && health > 0.05;
      if (sw) ship.elec.demand(bus, 9 * (0.4 + 0.6 * clamp01(h.demand / 4)));
      const cav = clamp01(h.quantity / 0.25);
      const flow = h.pumpRunning ? pf * ship.machine.hydHealth[h.id] * health * cav : 0;
      const internal = 0.075 + h.leak * 3;
      const dP = 1.2 * flow * (22 - h.pressure) - h.demand - internal * h.pressure;
      h.pressure = Math.max(0, h.pressure + dP * dt);
      if (h.quantity <= 0.02) h.pressure = Math.max(0, h.pressure - 8 * dt);
      h.quantity = Math.max(0, h.quantity - h.leak * dt);
      h.demand = 0;
    }
  }
}
