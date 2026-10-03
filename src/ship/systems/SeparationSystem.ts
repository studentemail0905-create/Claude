import { Vector3 } from 'three';
import { clamp01 } from '../../core/mathutil';
import type { Ship } from '../Ship';

/**
 * Passenger/service module separation.
 * Mechanical locks (hydraulic) + pyrotechnic bolts (EMER bus, ARM) + umbilicals.
 * Whatever state those are in when the bolts fire is what you get.
 */
export class SeparationSystem {
  moduleAttached = true;
  lockPos = 0; // 0 locked .. 1 released
  pyrosFired = false;
  umbilicalTorn = false;
  violent = false;
  separatedAt = -1;
  incomplete = false;
  /** Module free-body state after separation. */
  module = { pos: new Vector3(), vel: new Vector3(), quat: null as any, omega: new Vector3() };
  private prevHandle = 0;
  shearRisk = 0;
  clean = true;
  issues: string[] = [];

  update(dt: number, ship: Ship): void {
    const c = ship.controls;
    if (!this.moduleAttached) return;
    // lock actuators
    const target = c.get('mechLock') === 1 ? 1 : 0;
    const P = Math.max(ship.hyd.A.pressure, ship.hyd.B.pressure);
    if (this.lockPos !== target && P > 8) {
      const step = dt / 1.6;
      this.lockPos = target > this.lockPos ? Math.min(1, this.lockPos + step) : Math.max(0, this.lockPos - step);
      ship.hyd.draw('AB', 3);
      if (this.lockPos === target) ship.bus.emit('sfx', { id: target ? 'lock_release' : 'lock_engage' });
    }

    const handle = c.get('sepHandle');
    if (handle === 1 && this.prevHandle === 0) {
      const armed = c.get('sepArm') === 1 && ship.elec.powered('EMER', 19);
      if (armed && !this.pyrosFired) {
        this.pyrosFired = true;
        ship.bus.emit('sfx', { id: 'pyro_bang' });
        ship.bus.emit('shake', { amount: 0.7 });
        if (this.lockPos < 0.99) {
          this.incomplete = true;
          ship.damage.hit('structure', 0.28 * (1 - this.lockPos) + 0.05);
          ship.log('SEPARATION INCOMPLETE — LOCKS ENGAGED');
        }
      } else ship.bus.emit('sfx', { id: 'clunk' });
    }
    this.prevHandle = handle;

    if (this.pyrosFired && this.lockPos >= 0.99) {
      this.separate(ship, false);
      return;
    }
    // released locks + aerodynamic load can shear the bolts on their own
    if (!this.pyrosFired && this.lockPos > 0.9) {
      const q = ship.env.q;
      const nz = Math.abs(ship.env.nz);
      this.shearRisk = clamp01((q - 16_000) / 20_000) + clamp01((nz - 2.5) / 2);
      if (this.shearRisk > 0 && ship.rng.chance(this.shearRisk * 0.6 * dt)) {
        ship.log('MODULE TORE FREE');
        this.separate(ship, true);
      }
    }
  }

  separate(ship: Ship, violent: boolean): void {
    const c = ship.controls;
    this.moduleAttached = false;
    this.violent = violent;
    this.separatedAt = ship.time;
    this.issues = [];
    // record module free-body state from current ship state
    this.module.pos.copy(ship.bodyToWorld(new Vector3(0, -3.6, 11.5)));
    const down = new Vector3(0, -1, 0).applyQuaternion(ship.quat);
    this.module.vel.copy(ship.vel).addScaledVector(down, violent ? 0.5 : 1.6);
    this.module.quat = ship.quat.clone();
    this.module.omega.copy(ship.omega).multiplyScalar(0.8);

    if (c.get('sepElec') === 0) {
      this.umbilicalTorn = true;
      ship.elec.shortCircuit.B += 22;
      ship.elec.genTripped.B = true;
      ship.bus.emit('sfx', { id: 'spark' });
      this.issues.push('umbilical torn');
    }
    if (c.get('svcFuel') === 0) {
      ship.fuel.svcRuptured = true;
      this.issues.push('fuel line ruptured');
    }
    if (c.get('cabinIsol') === 0) {
      ship.press.ductRuptured = true;
      this.issues.push('pressure duct torn');
    }
    if (c.get('cockpitSeal') === 0) this.issues.push('cockpit open to space');
    if (violent) {
      ship.omega.add(new Vector3((ship.rng.next() - 0.5) * 0.5, (ship.rng.next() - 0.5) * 0.3, (ship.rng.next() - 0.5) * 0.9));
      ship.damage.hit('structure', 0.15);
      this.issues.push('uncontrolled release');
    }
    // core gets the reaction impulse (much lighter → larger kick)
    const up = new Vector3(0, 1, 0).applyQuaternion(ship.quat);
    ship.vel.addScaledVector(up, violent ? 0.4 : 0.9);
    this.clean = this.issues.length === 0;
    ship.press.podBaysOpen = 0;
    ship.bus.emit('separation', { clean: this.clean });
    ship.bus.emit('sfx', { id: 'separation' });
    ship.bus.emit('shake', { amount: 1.0, duration: 1.2 });
    ship.log(this.clean ? 'SEPARATION CLEAN' : 'SEPARATION: ' + this.issues.join(', ').toUpperCase());
    ship.onSeparated();
  }
}
