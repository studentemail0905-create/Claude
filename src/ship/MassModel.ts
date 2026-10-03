import { Vector3 } from 'three';
import { BAL } from '../data/Balance';
import type { Ship } from './Ship';

interface MassItem {
  m: number;
  p: Vector3; // body position
  I: Vector3; // own principal inertia (diag), about own centre
}

/** Box inertia helper: dims in body x,y,z. */
function boxI(m: number, x: number, y: number, z: number): Vector3 {
  return new Vector3((m * (y * y + z * z)) / 12, (m * (x * x + z * z)) / 12, (m * (x * x + y * y)) / 12);
}

// Body layout (origin = pilot eye, x right, y up, z aft).
export const LAYOUT = {
  core: new Vector3(0, -1.0, 7.0),
  module: new Vector3(0, -3.6, 11.5),
  coreTank: new Vector3(0, -1.0, 6.0),
  svcTank: new Vector3(0, -4.0, 14.0),
  rcsTank: new Vector3(0, -0.8, 3.5),
  pods: [new Vector3(-3.3, -3.3, 6.5), new Vector3(3.3, -3.3, 6.5), new Vector3(-3.3, -3.3, 12.5), new Vector3(3.3, -3.3, 12.5)],
  engines: { A: new Vector3(-1.5, -2.0, 17.5), B: new Vector3(1.5, -2.0, 17.5) },
  gear: {
    nose: new Vector3(0, -6.4, -0.5),
    left: new Vector3(-4.2, -6.4, 11.4),
    right: new Vector3(4.2, -6.4, 11.4),
  },
};

export class MassModel {
  mass = 0;
  com = new Vector3();
  inertia = new Vector3(1, 1, 1);
  private items: MassItem[] = [];

  compute(ship: Ship): void {
    const it = this.items;
    it.length = 0;
    const lateral = ship.fuel.imbalance;
    it.push({ m: BAL.coreDry * (ship.sep.moduleAttached ? 1 : 1), p: LAYOUT.core, I: boxI(BAL.coreDry, 3.2, 3.2, 22) });
    it.push({ m: Math.max(0, ship.fuel.core), p: new Vector3(lateral, LAYOUT.coreTank.y, LAYOUT.coreTank.z), I: boxI(ship.fuel.core, 2, 2, 7) });
    it.push({ m: ship.rcs.propellant, p: LAYOUT.rcsTank, I: new Vector3() });
    if (ship.sep.moduleAttached) {
      it.push({ m: BAL.moduleDry, p: LAYOUT.module, I: boxI(BAL.moduleDry, 24, 3.5, 22) });
      it.push({ m: Math.max(0, ship.fuel.svc), p: new Vector3(lateral * 2, LAYOUT.svcTank.y, LAYOUT.svcTank.z), I: boxI(ship.fuel.svc, 4, 2.5, 9) });
      const pax = ship.pax;
      for (let i = 0; i < 4; i++) {
        if (pax.pods[i].attached) {
          it.push({ m: BAL.podMass + pax.pods[i].occupants * BAL.passengerMass, p: LAYOUT.pods[i], I: new Vector3() });
        }
      }
      // passengers still in the cabin
      it.push({ m: pax.inCabin * BAL.passengerMass, p: new Vector3(0, -3.0, 9.5), I: new Vector3() });
    }
    let m = 0;
    const c = this.com.set(0, 0, 0);
    for (const i of it) {
      m += i.m;
      c.addScaledVector(i.p, i.m);
    }
    c.multiplyScalar(1 / Math.max(1, m));
    const I = this.inertia.set(0, 0, 0);
    for (const i of it) {
      const dx = i.p.x - c.x, dy = i.p.y - c.y, dz = i.p.z - c.z;
      I.x += i.I.x + i.m * (dy * dy + dz * dz);
      I.y += i.I.y + i.m * (dx * dx + dz * dz);
      I.z += i.I.z + i.m * (dx * dx + dy * dy);
    }
    this.mass = m;
  }
}
