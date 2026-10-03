import { Vector3 } from 'three';
import type { Ship } from '../Ship';

/**
 * Displays, HUD and the navigation computer (which holds the escape vector
 * and computes jump navigation solutions). Power loss wipes volatile state.
 */
export class AvionicsSystem {
  displaysOn = false;
  flicker = 0;
  hudOn = false;
  navOn = false;
  navBoot = 0; // seconds since power-up; computer usable after 4 s
  escLoaded = false;
  escLoading = 0; // >0 while reading the cartridge
  solveTimer = 0; // >0 while solving
  solutionValid = false;
  solutionPos = new Vector3();
  solutionTime = 0;
  /** Navigation spoof: offset injected into position solution (m). */
  spoofOffset = new Vector3();
  clockDesync = false;
  insDrift = new Vector3();
  private unpoweredFor = 0;
  lastLoadFailed = false;

  update(dt: number, ship: Ship): void {
    const c = ship.controls;
    const av = ship.elec.volts.AV;
    const dispCB = c.get('cb_disp') === 1;
    if (dispCB) ship.elec.demand('AV', 3.5);
    this.displaysOn = dispCB && av > 18 && ship.damage.health.avionics > 0.1;
    this.flicker = av > 18 && av < 22 ? (22 - av) / 4 : 0;
    if (ship.elec.noise > 0) this.flicker = Math.max(this.flicker, ship.elec.noise * 0.6);
    this.hudOn = this.displaysOn && c.get('hudBright') > 0.05;

    const navPowered = c.get('navComp') === 1 && c.get('cb_nav') === 1 && av > 19 && ship.damage.health.nav > 0.1;
    if (c.get('navComp') === 1 && c.get('cb_nav') === 1) ship.elec.demand('AV', 1.2 + (this.solveTimer > 0 ? 1.5 : 0));
    if (!navPowered) {
      this.unpoweredFor += dt;
      if (this.unpoweredFor > 0.35) {
        // volatile memory lost
        if (this.escLoaded || this.solutionValid) ship.log('NAV COMPUTER RESET');
        this.navOn = false;
        this.navBoot = 0;
        this.escLoaded = false;
        this.escLoading = 0;
        this.solveTimer = 0;
        this.solutionValid = false;
      }
    } else {
      this.unpoweredFor = 0;
      this.navOn = true;
      this.navBoot += dt;
    }
    const ready = this.navOn && this.navBoot > 4;

    // INS drift grows slowly; sensor damage accelerates it.
    this.insDrift.x += (ship.rng.next() - 0.5) * dt * 2 * (2 - ship.damage.health.sensors);
    this.insDrift.z += (ship.rng.next() - 0.5) * dt * 2 * (2 - ship.damage.health.sensors);

    if (c.pressed('escLoad')) {
      if (ready && !this.escLoaded && this.escLoading <= 0) {
        this.escLoading = 6;
        ship.bus.emit('sfx', { id: 'cartridge' });
      }
    }
    if (this.escLoading > 0) {
      this.escLoading -= dt;
      if (!ready) this.escLoading = 0;
      else if (this.escLoading <= 0) {
        this.escLoaded = true;
        ship.log('ESCAPE VECTOR LOADED');
        ship.bus.emit('sfx', { id: 'nav_beep' });
      }
    }

    if (c.pressed('jumpSolve')) {
      if (ready && this.escLoaded && this.solveTimer <= 0) {
        this.solveTimer = this.clockDesync ? 14 : 7.5;
        this.solutionValid = false;
        ship.bus.emit('sfx', { id: 'nav_beep' });
      } else if (ready) ship.bus.emit('sfx', { id: 'nav_reject' });
    }
    if (this.solveTimer > 0) {
      this.solveTimer -= dt;
      if (!ready || !this.escLoaded) this.solveTimer = 0;
      else if (this.solveTimer <= 0) {
        if (this.clockDesync && ship.rng.chance(0.6)) {
          this.solutionValid = false;
          ship.log('SOLVE FAILED: CLOCK');
          ship.bus.emit('sfx', { id: 'nav_reject' });
        } else {
          this.solutionValid = true;
          this.solutionPos.copy(ship.pos).add(this.spoofOffset);
          this.solutionTime = ship.time;
          ship.log('JUMP SOLUTION VALID');
          ship.bus.emit('sfx', { id: 'nav_beep' });
        }
      }
    }
  }

  /** Angular error (deg) of the stored solution vs current true position. */
  solutionError(ship: Ship): number {
    if (!this.solutionValid) return 180;
    const dist = this.solutionPos.distanceTo(ship.pos);
    const age = ship.time - this.solutionTime;
    return dist / 40_000 + age * 0.004 + (this.clockDesync ? 6 : 0);
  }

  get navReady(): boolean {
    return this.navOn && this.navBoot > 4;
  }
}
