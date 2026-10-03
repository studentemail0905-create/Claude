import { Vector3 } from 'three';
import { BAL } from '../../data/Balance';
import type { Ship } from '../Ship';

/**
 * Reaction control: rotation (torque) and translation (force) jets.
 * Fed from its own propellant tank; valves powered from Bus A via the RCS breaker.
 */
export class RCSSystem {
  propellant = BAL.rcsPropCap;
  /** Commanded torque fraction per axis (-1..1) set by FCS. */
  rotCmd = new Vector3();
  /** Actual torque produced (body N·m). */
  torque = new Vector3();
  force = new Vector3();
  activity = 0; // 0..1 for audio
  stuckJet: Vector3 | null = null; // micrometeor damage: a jet stuck firing
  available = false;
  rotEnabled = false;
  transEnabled = false;
  static readonly maxTorque = new Vector3(95_000, 70_000, 14_000); // pitch, yaw, roll
  static readonly maxForce = 9_000;

  update(dt: number, ship: Ship): void {
    const c = ship.controls;
    const powered = c.get('rcsMaster') === 1 && c.get('cb_rcs') === 1 && ship.elec.factor('A') > 0.35;
    if (c.get('rcsMaster') === 1 && c.get('cb_rcs') === 1) ship.elec.demand('A', 2 + this.activity * 3);
    const mode = c.get('rcsMode');
    const health = ship.damage.health.rcs;
    this.available = powered && this.propellant > 0 && health > 0.05;
    this.rotEnabled = this.available && mode >= 1;
    this.transEnabled = this.available && mode >= 2;
    const eff = ship.machine.rcsEff * health * ship.elec.factor('A');

    this.torque.set(0, 0, 0);
    this.force.set(0, 0, 0);
    let use = 0;
    if (this.rotEnabled) {
      const mt = RCSSystem.maxTorque;
      this.torque.set(this.rotCmd.x * mt.x, this.rotCmd.y * mt.y, this.rotCmd.z * mt.z).multiplyScalar(eff);
      use += Math.abs(this.rotCmd.x) + Math.abs(this.rotCmd.y) + Math.abs(this.rotCmd.z) * 0.6;
    }
    if (this.transEnabled) {
      const t = c.trans;
      this.force.set(t.x, t.y, t.z).multiplyScalar(RCSSystem.maxForce * eff);
      use += (Math.abs(t.x) + Math.abs(t.y) + Math.abs(t.z)) * 1.1;
    }
    if (this.stuckJet && this.propellant > 0 && powered) {
      this.torque.add(this.stuckJet);
      use += 0.5;
    }
    // ~2 jets × 4.5 kN per unit command, Isp 285 s
    const flow = use * 9000 / (285 * 9.80665);
    this.propellant = Math.max(0, this.propellant - flow * dt);
    this.activity = Math.min(1, use * 0.6);
    this.rotCmd.set(0, 0, 0);
  }
}
