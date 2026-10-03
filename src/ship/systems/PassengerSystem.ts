import { Vector3 } from 'three';
import { BAL } from '../../data/Balance';
import { clamp01 } from '../../core/mathutil';
import type { Ship } from '../Ship';

export interface Pod {
  index: number;
  attached: boolean;
  occupants: number;
  charge: number;
  releaseAt: number; // scheduled release time (-1 none)
  outcome: 'pending' | 'safe' | 'injured' | 'lost';
  survival: number;
  revealAt: number;
  pos: Vector3;
  vel: Vector3;
  reason: string;
}

/**
 * 40 passengers, 4 evacuation capsules (10 seats each) docked to the cabin.
 * RESTRAINT CMD makes passengers board; capsules need charge, guidance and a sane
 * release envelope. Every capsule's fate is rolled from the conditions at release.
 */
export class PassengerSystem {
  pods: Pod[] = [];
  inCabin = BAL.podCount * BAL.passengersPerPod;
  boarding = 0; // fractional boarding progress accumulator
  boardingStarted = false;
  released = 0;
  lostPassengers = 0;
  safePassengers = 0;
  private boardRate = 1;

  init(ship: Ship): void {
    const r = ship.machine;
    this.pods = [];
    for (let i = 0; i < BAL.podCount; i++) {
      this.pods.push({
        index: i, attached: true, occupants: 0, charge: r.podCharge[i], releaseAt: -1, outcome: 'pending', survival: 1,
        revealAt: -1, pos: new Vector3(), vel: new Vector3(), reason: '',
      });
    }
    this.boardRate = r.boardRate;
  }

  get evacuated(): number {
    return this.pods.reduce((s, p) => s + (p.attached ? 0 : p.occupants), 0);
  }

  get occupancyClear(): boolean {
    return this.inCabin === 0 && this.pods.every((p) => !p.attached || p.occupants === 0);
  }

  update(dt: number, ship: Ship): void {
    const c = ship.controls;
    const attached = ship.sep.moduleAttached;
    const cab = ship.elec.volts.CAB > 19;
    const podSys = c.get('cb_pods') === 1 && cab;

    for (const p of this.pods) {
      if (!p.attached && p.outcome === 'pending' && ship.time >= p.revealAt) {
        p.outcome = ship.rngEvents.next() < p.survival ? (p.survival < 0.7 && ship.rngEvents.chance(0.5) ? 'injured' : 'safe') : 'lost';
        if (p.outcome === 'lost') this.lostPassengers += p.occupants;
        else this.safePassengers += p.occupants;
        ship.log(`CAPSULE ${p.index + 1}: ${p.outcome === 'lost' ? 'NO TELEMETRY' : p.outcome === 'injured' ? 'HARD LANDING' : 'CHUTE NOMINAL'}`);
      }
    }
    if (!attached) return;
    // capsule charging
    if (c.get('podPower') === 1 && podSys) {
      ship.elec.demand('CAB', 1.5 * this.pods.filter((p) => p.attached && p.charge < 1).length);
      for (const p of this.pods) if (p.attached) p.charge = Math.min(1, p.charge + dt * 0.011 * ship.elec.factor('CAB'));
    }
    if (cab) ship.elec.demand('CAB', 11);

    // boarding
    if (c.get('restraint') === 1) {
      if (!this.boardingStarted) {
        this.boardingStarted = true;
        ship.bus.emit('radio', { from: 'CABIN PA', text: 'Attention passengers. Please proceed calmly to your assigned capsule and fasten all restraints. This is routine.', tone: 'pa' });
      }
      let rate = 1.35 * this.boardRate; // passengers per second, whole cabin
      if (!cab) rate *= 0.35; // dark cabin, no PA
      if (ship.press.cabin < 60_000) rate *= 0.5;
      const g = Math.abs(ship.env.nz);
      if (g > 1.6) rate *= clamp01(1 - (g - 1.6) / 1.6) * 0.8 + 0.1;
      if (ship.env.turbulenceLevel > 0.5) rate *= 0.6;
      this.boarding += rate * dt;
      while (this.boarding >= 1 && this.inCabin > 0) {
        const free = this.pods.filter((p) => p.attached && p.occupants < BAL.passengersPerPod);
        if (!free.length) break;
        free.sort((a, b) => a.occupants - b.occupants);
        free[0].occupants++;
        this.inCabin--;
        this.boarding -= 1;
      }
    }

    // release
    if (c.pressed('podRelease')) {
      const armed = c.get('evacArm') === 1 && ship.elec.powered('EMER', 19);
      if (armed && c.get('cb_pods') === 1) {
        let k = 0;
        for (const p of this.pods) if (p.attached && p.releaseAt < 0) p.releaseAt = ship.time + 0.15 + 0.45 * k++;
        ship.bus.emit('sfx', { id: 'pyro_arm' });
      } else ship.bus.emit('sfx', { id: 'clunk' });
    }
    for (const p of this.pods) if (p.attached && p.releaseAt >= 0 && ship.time >= p.releaseAt) this.releasePod(p, ship);
  }

  private releasePod(p: Pod, ship: Ship): void {
    p.attached = false;
    this.released++;
    p.revealAt = ship.time + 5;
    const env = ship.env;
    const powered = p.charge >= 0.5;
    const guid = ship.controls.get('podGuidance') === 1 && powered;
    const prog = ship.controls.get('returnProg');
    let s = 0.995;
    const reasons: string[] = [];
    if (!powered) { s *= 0.1; reasons.push('no power'); }
    const fast = env.mach > 4 || env.altitude > 60_000;
    if (!guid) {
      const mild = env.altitude < 15_000 && env.mach < 1.2;
      s *= mild ? 0.85 : 0.33;
      reasons.push('unguided');
    }
    if (prog === 0) { s *= 0.5; reasons.push('no return program'); }
    else if (prog === 1 && fast) { s *= 0.55; reasons.push('nearest-site overshoot'); }
    else if (prog === 2 && env.altitude < 3000 && env.mach < 0.6) { s *= 0.8; reasons.push('ocean out of reach'); }
    if (env.q > 30_000) { s *= env.q > 50_000 ? 0.1 : 0.4; reasons.push('dynamic pressure'); }
    if (env.mach > 9) { s *= 0.5; reasons.push('reentry heating'); }
    if (env.altitude > 100_000 && env.tas > 3000 && !guid) { s *= 0.1; reasons.push('no deorbit'); }
    if (env.agl < 150 && env.tas > 120) { s *= 0.6; reasons.push('low and fast'); }
    if (env.onGround && env.groundSpeed < 5 && powered) s = Math.max(s, 0.97);
    if (Math.abs(ship.omegaDegMag) > 25) { s *= 0.6; reasons.push('tumbling release'); }
    p.survival = clamp01(s * ship.machine.podQuality);
    p.reason = reasons.join(', ');
    // physical departure
    const up = new Vector3(0, 1, 0).applyQuaternion(ship.quat);
    const side = new Vector3(p.index % 2 === 0 ? -1 : 1, 0, 0).applyQuaternion(ship.quat);
    p.pos.copy(ship.bodyToWorld(new Vector3(p.index % 2 === 0 ? -3.3 : 3.3, -3.3, p.index < 2 ? 6.5 : 12.5)));
    p.vel.copy(ship.vel).addScaledVector(side, 9).addScaledVector(up, powered ? 14 : 3);
    ship.press.podBaysOpen++;
    ship.bus.emit('podRelease', { index: p.index, safe: p.survival > 0.8 });
    ship.bus.emit('sfx', { id: 'pod_fire' });
    ship.bus.emit('shake', { amount: 0.25 });
    ship.flags.podsSeen = true;
  }
}
