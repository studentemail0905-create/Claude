import { BAL } from '../../data/Balance';
import { clamp01 } from '../../core/mathutil';
import type { Ship } from '../Ship';

export interface FeedState {
  pressure: number; // bar at engine inlet
  avail: number; // fraction of demanded flow that can be delivered
}

/**
 * Two-sided fuel system.
 *   Side A: CORE tank → Pump A → ISOL A → Engine A
 *   Side B: SERVICE tank (in module) → SVC line → Pump B → ISOL B → Engine B
 *   CROSSFEED joins the two manifolds. XFER pump moves service fuel into the core tank.
 */
export class FuelSystem {
  core = BAL.coreTankCap * 0.97;
  svc = BAL.svcTankCap * 0.95;
  pressA = 0;
  pressB = 0;
  feed: Record<'A' | 'B', FeedState> = { A: { pressure: 0, avail: 0 }, B: { pressure: 0, avail: 0 } };
  /** Demanded engine flow (kg/s) registered by engines last tick. */
  engDemand = { A: 0, B: 0 };
  leakCore = 0; // kg/s
  svcRuptured = false; // service line torn open at separation
  imbalance = 0; // lateral COM offset (m) from sloshing / event
  xferActive = false;
  totalUsed = 0;
  private apuDraw = 0;

  consumeApu(kg: number): void {
    this.apuDraw += kg;
  }

  get svcConnected(): boolean {
    return this.svcLineOpen && !this.svcRuptured;
  }
  svcLineOpen = true; // set by Ship from controls + module state

  update(dt: number, ship: Ship): void {
    const c = ship.controls;
    const m = ship.machine;
    const attached = ship.sep.moduleAttached;
    this.svcLineOpen = attached && c.get('svcFuel') === 0;

    const pumpA = c.get('fuelPumpA') === 1 && ship.elec.factor('A') > 0.3;
    const pumpB = c.get('fuelPumpB') === 1 && ship.elec.factor('B') > 0.3;
    if (c.get('fuelPumpA') === 1) ship.elec.demand('A', 4);
    if (c.get('fuelPumpB') === 1) ship.elec.demand('B', 4);

    const hA = ship.damage.health.fuelPumpA;
    const hB = ship.damage.health.fuelPumpB;
    // static pressure (bar) and flow capacity (kg/s)
    let pA = 0, capA = 0, pB = 0, capB = 0;
    if (this.core > 1) {
      pA = pumpA ? 3.2 * m.fuelPump.A * hA * ship.elec.factor('A') : 0.45;
      capA = pumpA ? 44 * m.fuelPump.A * hA * ship.elec.factor('A') : 7;
    }
    if (this.svcConnected && this.svc > 1) {
      pB = pumpB ? 3.2 * m.fuelPump.B * hB * ship.elec.factor('B') : 0.45;
      capB = pumpB ? 44 * m.fuelPump.B * hB * ship.elec.factor('B') : 7;
    }
    const xfeed = c.get('crossfeed') === 1;
    const valveA = c.get('isoA') === 1 && c.get('fireA') === 0;
    const valveB = c.get('isoB') === 1 && c.get('fireB') === 0;
    const dA = valveA ? this.engDemand.A : 0;
    const dB = valveB ? this.engDemand.B : 0;

    // service line torn: side B manifold vents overboard
    const sideBLeak = this.svcRuptured;
    let leakFlowB = 0;

    let usedCore = 0, usedSvc = 0;
    if (xfeed) {
      // Shared manifold. A torn side-B line drains the shared manifold.
      let p = Math.max(pA, pB);
      const cap = capA + capB;
      if (sideBLeak) {
        leakFlowB = Math.min(cap, 45);
        p *= 0.25;
      }
      const demand = dA + dB + leakFlowB;
      const ratio = cap > 0 ? demand / cap : 9;
      const avail = demand <= 0 ? 1 : clamp01(cap / Math.max(demand, 1e-6));
      const pe = p * (1 - 0.55 * Math.min(1, ratio) ** 2);
      this.feed.A = { pressure: valveA ? pe : 0, avail: valveA ? avail : 0 };
      this.feed.B = { pressure: valveB ? pe : 0, avail: valveB ? avail : 0 };
      const delivered = Math.min(demand, cap);
      const shareA = cap > 0 ? capA / cap : 0;
      usedCore += delivered * shareA;
      usedSvc += delivered * (1 - shareA);
      this.pressA = this.pressB = pe;
    } else {
      const ratioA = capA > 0 ? dA / capA : 9;
      const availA = dA <= 0 ? 1 : clamp01(capA / dA);
      this.pressA = pA * (1 - 0.55 * Math.min(1, ratioA) ** 2);
      this.feed.A = { pressure: valveA ? this.pressA : 0, avail: valveA ? availA : 0 };
      usedCore += Math.min(dA, capA);
      if (sideBLeak) {
        this.pressB = 0;
        this.feed.B = { pressure: 0, avail: 0 };
      } else {
        const ratioB = capB > 0 ? dB / capB : 9;
        const availB = dB <= 0 ? 1 : clamp01(capB / dB);
        this.pressB = pB * (1 - 0.55 * Math.min(1, ratioB) ** 2);
        this.feed.B = { pressure: valveB ? this.pressB : 0, avail: valveB ? availB : 0 };
        usedSvc += Math.min(dB, capB);
      }
    }

    // transfer pump
    this.xferActive = false;
    if (c.get('fuelXfer') === 1 && c.get('cb_fuelx') === 1 && ship.elec.factor('A') > 0.3) {
      ship.elec.demand('A', 3);
      if (this.svcConnected && this.svc > 1 && this.core < BAL.coreTankCap) {
        const amt = Math.min(70 * ship.elec.factor('A') * dt, this.svc, BAL.coreTankCap - this.core);
        this.svc -= amt;
        this.core += amt;
        this.xferActive = true;
      }
    }

    const leak = (this.leakCore + 0) * dt;
    this.core = Math.max(0, this.core - usedCore * dt - leak - this.apuDraw);
    this.svc = Math.max(0, this.svc - usedSvc * dt);
    this.totalUsed += (usedCore + usedSvc) * dt + this.apuDraw;
    this.apuDraw = 0;
    this.engDemand.A = this.engDemand.B = 0;
  }

  get total(): number {
    return this.core + this.svc;
  }
}
