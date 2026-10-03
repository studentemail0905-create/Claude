import type { Ship } from '../Ship';

export interface TxRecord {
  time: number;
  freq: number;
  kind: 'ack' | 'auth';
  value: number;
}

/** Radio: receiver on the selected frequency, transmitter for readbacks and authentication. */
export class CommunicationSystem {
  txLog: TxRecord[] = [];
  static = 0; // 0..1 interference (jammer, flare)
  /** Hot mic: PA broadcast leaking onto the external transmitter (event). */
  hotMic = false;

  powered(ship: Ship): boolean {
    return ship.controls.get('comms') === 1 && ship.controls.get('cb_comms') === 1 && ship.elec.volts.EMER > 19;
  }

  canHear(ship: Ship, freq: number): boolean {
    return this.powered(ship) && ship.controls.get('freq') === freq;
  }

  canTransmit(ship: Ship): boolean {
    return this.powered(ship) && ship.controls.get('tx') === 1;
  }

  update(dt: number, ship: Ship): void {
    const c = ship.controls;
    if (c.get('comms') === 1 && c.get('cb_comms') === 1) ship.elec.demand('EMER', 0.6 + (c.get('tx') ? 0.3 : 0));
    this.static = Math.min(1, ship.jammer.field * 0.7 + ship.elec.noise * 0.8);
    if (c.pressed('ptt') && this.canTransmit(ship)) {
      this.txLog.push({ time: ship.time, freq: c.get('freq'), kind: 'ack', value: 0 });
      ship.bus.emit('sfx', { id: 'ptt' });
    }
    if (c.pressed('authTx') && this.canTransmit(ship)) {
      this.txLog.push({ time: ship.time, freq: c.get('freq'), kind: 'auth', value: c.get('authCode') });
      ship.bus.emit('sfx', { id: 'ptt' });
    }
    if (this.txLog.length > 40) this.txLog.splice(0, this.txLog.length - 40);
  }

  /** Most recent transmission of a kind after time t on a frequency. */
  since(t: number, kind: 'ack' | 'auth', freq = 0): TxRecord | undefined {
    for (let i = this.txLog.length - 1; i >= 0; i--) {
      const r = this.txLog[i];
      if (r.time < t) break;
      if (r.kind === kind && r.freq === freq) return r;
    }
    return undefined;
  }
}
