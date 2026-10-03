import type { Ship } from '../Ship';

export const XPDR_MODES = ['OFF', 'STBY', 'ON', 'ALT', 'SECURE'] as const;
export type XpdrMode = (typeof XPDR_MODES)[number];

/**
 * Transponder. Replies to government interrogation in ON/ALT/SECURE.
 * Needs avionics power + breaker, 5 s warm-up. A firmware fault can make it
 * boot itself to ALT and ignore the selector until its breaker is pulled.
 */
export class TransponderSystem {
  warm = 0;
  forcedOn = false;
  identTimer = 0;
  replyFlash = 0;
  lastReply = -99;

  powered(ship: Ship): boolean {
    return ship.controls.get('cb_xpdr') === 1 && ship.elec.volts.AV > 19 && ship.damage.health.xpdr > 0.05;
  }

  /** Effective transmitting mode. */
  mode(ship: Ship): XpdrMode {
    if (!this.powered(ship) || this.warm < 5) return 'OFF';
    if (this.forcedOn) return 'ALT';
    return XPDR_MODES[ship.controls.get('xpdrMode')];
  }

  replying(ship: Ship): boolean {
    const m = this.mode(ship);
    return m === 'ON' || m === 'ALT' || m === 'SECURE';
  }

  update(dt: number, ship: Ship): void {
    const c = ship.controls;
    const sel = c.get('xpdrMode');
    if (this.powered(ship) && (sel > 0 || this.forcedOn)) {
      this.warm += dt;
      ship.elec.demand('AV', 0.3);
    } else this.warm = 0;
    if (!this.powered(ship)) this.forcedOn = false; // breaker pull clears the fault
    if (c.pressed('ident') && this.replying(ship)) {
      this.identTimer = 18;
      ship.bus.emit('sfx', { id: 'button_light' });
    }
    this.identTimer = Math.max(0, this.identTimer - dt);
    this.replyFlash = Math.max(0, this.replyFlash - dt * 4);
  }

  /** Called by the interrogator. */
  interrogated(ship: Ship): boolean {
    if (!this.replying(ship)) return false;
    this.replyFlash = 1;
    this.lastReply = ship.time;
    return true;
  }
}
