import { clamp } from '../core/mathutil';
import type { Run } from '../core/Run';
import type { Fix } from './TrackingNetwork';
import type { RNG } from '../core/RNG';

export type AlertLevel = 'NORMAL' | 'QUERY' | 'SUSPICIOUS' | 'ALERT' | 'HOSTILE';
type Tone = 'normal' | 'query' | 'suspicious' | 'hostile' | 'system' | 'pa';

interface PendingAck {
  text: string;
  sentAt: number;
  deadline: number;
  penalty: number;
  retries: number;
  key: string;
}

export interface Challenge {
  word: string;
  expected: number;
  sentAt: number;
  deadline: number;
  kind: 'auth' | 'toll';
  resolved: boolean;
}

/**
 * Planetary Civil Flight Authority — bureaucratic ATC with a suspicion model.
 * Alert rises from what the network actually observes; it never reads the ship's mind.
 */
export class FlightCommand {
  alert = 0;
  alertPeak = 0;
  floor = 0;
  level: AlertLevel = 'NORMAL';
  callsign: string;
  squawk: string;
  authTable: { word: string; digit: number }[] = [];
  pending: PendingAck[] = [];
  challenge: Challenge | null = null;
  remoteOverride = -1; // countdown seconds, -1 inactive
  lastMsgTime = -99;
  heard: { t: number; from: string; text: string; tone: Tone }[] = [];
  private said = new Set<string>();
  private xpdrWasReplying = false;
  private xpdrLostAt = -1;
  private datalinkWas = true;
  private lastCompliance = 0;
  private secureRequestedAt = -1;
  private rng: RNG;
  private spoofReplies = 0;
  private lastPrimaryOnly = -99;

  constructor(private run: Run) {
    this.rng = run.rng.fork('atc');
    const r = this.rng;
    const names = ['Shuttle 17', 'Civil 409', 'Transit 22', 'Shuttle 4-Echo', 'Civil 7-1-1', 'Charter 56'];
    this.callsign = r.pick(names);
    this.squawk = `${r.int(1, 6)}${r.int(0, 7)}${r.int(0, 7)}${r.int(0, 7)}`;
    const words = ['ALPHA', 'BRAVO', 'DELTA', 'ECHO', 'KILO', 'LIMA', 'OSCAR', 'ROMEO', 'TANGO', 'VICTOR', 'YANKEE', 'ZULU'];
    for (const w of words) this.authTable.push({ word: w, digit: r.int(0, 9) });
  }

  get ship() {
    return this.run.ship;
  }

  /** Transmit on a frequency; only heard if the receiver is tuned and powered. */
  say(text: string, tone: Tone = 'normal', opts: { key?: string; ack?: boolean; penalty?: number; freq?: number; from?: string; force?: boolean } = {}): void {
    const ship = this.ship;
    if (opts.key) {
      if (this.said.has(opts.key)) return;
      this.said.add(opts.key);
    }
    const freq = opts.freq ?? 0;
    const from = opts.from ?? 'FLIGHT CMD';
    const full = text.replace(/\$CS/g, this.callsign).replace(/\$SQ/g, this.squawk);
    this.lastMsgTime = ship.time;
    // hostile calls go out on GOV and EMER simultaneously
    const heard = ship.comms.canHear(ship, freq) || (tone === 'hostile' && ship.comms.canHear(ship, 2));
    if (heard) {
      this.heard.push({ t: ship.time, from, text: full, tone });
      if (this.heard.length > 30) this.heard.shift();
      ship.bus.emit('radio', { from, text: full, tone });
    }
    if (opts.ack) {
      this.pending.push({ text: full, sentAt: ship.time, deadline: ship.time + 16, penalty: opts.penalty ?? 6, retries: 1, key: opts.key ?? full });
    }
  }

  raise(amount: number, reason: string): void {
    this.alert = clamp(this.alert + amount, 0, 100);
    this.alertPeak = Math.max(this.alertPeak, this.alert);
    this.floor = Math.max(this.floor, this.alertPeak * 0.45);
    this.run.stats.suspicionLog.push({ t: this.ship.time, amount, reason });
  }

  // ── observations from the tracking network ───────────────
  onFix(f: Fix): void {
    const ship = this.ship;
    if (f.source === 'spoof') return;
    const q = this.run.plan.query(f.pos);
    const dev = Math.max(q.latRatio, q.vertRatio);
    if (ship.env.altitude > 1500 && dev > 1) {
      this.raise(Math.min(10, 1.5 + (dev - 1) * 4), 'route deviation');
      if (dev > 1.2) {
        if (q.latRatio > q.vertRatio) this.say('$CS, confirm assigned heading. You are drifting from the Transit Lane Three corridor.', 'query', { key: 'dev_lat_' + Math.floor(ship.time / 60), ack: true });
        else this.say('$CS, confirm assigned altitude. Altitude deviation noted.', 'query', { key: 'dev_alt_' + Math.floor(ship.time / 60), ack: true });
      }
    } else if (ship.env.altitude > 1500) this.lastCompliance = ship.time;
    if (f.pos.length() - 6_371_000 > 85_000 + 4000) {
      this.raise(9, 'above lane ceiling');
      this.say('$CS, you are above the eight-five kilometre lane ceiling. Descend immediately.', 'suspicious', { key: 'ceiling' });
    }
  }

  onPrimaryOnly(): void {
    const ship = this.ship;
    if (ship.time - this.lastPrimaryOnly < 3) return;
    this.lastPrimaryOnly = ship.time;
    this.raise(7, 'primary target without transponder');
    this.say('$CS, radar contact, no transponder reply. Squawk $SQ and ident.', 'suspicious', { key: 'primary_' + Math.floor(ship.time / 45), ack: true, penalty: 8 });
  }

  onSpoofReply(): void {
    this.spoofReplies++;
    // a ghost reply on the filed route looks compliant
    this.alert = Math.max(this.floor, this.alert - 0.6);
  }

  onSpoofConflict(): void {
    this.raise(14, 'conflicting tracks');
    this.say('$CS, we have two returns for your code. Explain.', 'suspicious', { key: 'conflict_' + Math.floor(this.ship.time / 60) });
  }

  onJammingDetected(): void {
    this.raise(5, 'jamming detected');
    this.say('All stations, Flight Command is observing electromagnetic interference in sector four.', 'suspicious', { key: 'esm_' + Math.floor(this.ship.time / 50) });
  }

  onGravimetric(): void {
    this.raise(9, 'gravimetric anomaly');
    this.say('$CS, orbital sensors report a gravimetric anomaly at your position. Interstellar drive operation is prohibited.', 'suspicious', { key: 'grav_' + Math.floor(this.ship.time / 40) });
  }

  onTelemetry(): void {
    const ship = this.ship;
    const c = ship.controls;
    // the datalink reports configuration — the government sees switch positions
    if (ship.elec.volts.JAM > 15) { this.raise(1.5, 'jammer bus energised'); this.say('$CS, telemetry shows an unregistered load on bus B. Report.', 'query', { key: 'tlm_jam' }); }
    if (ship.elec.volts.JUMP > 15) { this.raise(2, 'jump bus energised'); this.say('$CS, telemetry shows your interstellar bus energised. That bus is sealed by regulation.', 'suspicious', { key: 'tlm_jump' }); }
    if (c.get('evacArm') === 1 || c.get('restraint') === 1) { this.raise(1, 'evacuation armed'); this.say('$CS, your cabin evacuation system reports armed. Confirm no emergency.', 'query', { key: 'tlm_evac', ack: true }); }
    if (c.get('sepArm') === 1) { this.raise(1.5, 'separation armed'); this.say('$CS, separation pyrotechnics show armed. Disarm and report.', 'suspicious', { key: 'tlm_sep', ack: true }); }
    if (!ship.xpdr.replying(ship) && ship.env.altitude > 200) { this.raise(1.5, 'xpdr off per telemetry'); }
  }

  onPodsSeen(): void {
    this.raise(28, 'evacuation capsules observed');
    this.say('$CS, we observe capsules departing your vessel. Declare your emergency. Rescue services are being... considered.', 'suspicious', { key: 'pods' });
  }

  onSeparationSeen(): void {
    this.raise(32, 'vessel split');
    this.say('$CS, your radar return has split into two objects. Unauthorised orbital departure is a criminal offence.', 'hostile', { key: 'sep' });
  }

  // ── tick ───────────────────────────────────────────────
  update(dt: number): void {
    const run = this.run;
    const ship = this.ship;
    const t = ship.time;
    const e = ship.env;

    // scripted-by-state (not by stage) clearances
    if (t > 1.5) this.say('$CS, Civil Flight Authority. Cleared departure runway zero-niner, Orbital Transit Lane Three. Squawk $SQ, mode ALT. Datalink is mandatory.', 'normal', { key: 'clearance', ack: true, penalty: 4 });
    if (!e.onGround && e.agl > 50 && ship.vel.length() > 60) this.say('$CS, airborne. Climb via the lane, follow the markers. Report passing two-zero kilometres.', 'normal', { key: 'airborne', ack: true, penalty: 3 });
    if (e.altitude > 20_000) {
      this.say('$CS, Upper Control. Passing three-zero kilometres, squawk SECURE.', 'normal', { key: 'secure', ack: true, penalty: 4 });
      if (this.secureRequestedAt < 0) this.secureRequestedAt = t;
    }
    if (e.altitude > 32_000 && this.secureRequestedAt > 0 && ship.xpdr.replying(ship) && ship.xpdr.mode(ship) !== 'SECURE') {
      if (Math.floor(t) % 15 === 0 && Math.floor(t - dt) % 15 !== 0) {
        this.raise(3, 'xpdr mode non-compliant');
        this.say('$CS, you are not squawking SECURE. Comply.', 'query', { key: 'secure_rem_' + Math.floor(t / 15) });
      }
    }
    if (e.altitude > 50_000) this.say('$CS, Transit Lane Three ceiling eight-five kilometres. Maintain lane. Have a compliant day.', 'normal', { key: 'lane' });

    // transponder loss / recovery (only noticed if they had replies)
    const replying = ship.xpdr.replying(ship);
    if (this.xpdrWasReplying && !replying) {
      this.xpdrLostAt = t;
    }
    if (this.xpdrLostAt > 0 && !replying && t - this.xpdrLostAt > 5 && t - this.xpdrLostAt < 5 + dt * 1.5) {
      this.raise(9, 'transponder lost');
      this.say('$CS, we have lost your transponder. Recycle and squawk $SQ.', 'query', { key: 'xpdr_lost_' + Math.floor(t / 30), ack: true, penalty: 6 });
    }
    if (replying && this.xpdrLostAt > 0) {
      if (t - this.xpdrLostAt < 25) this.alert = Math.max(this.floor, this.alert - 5);
      this.xpdrLostAt = -1;
    }
    this.xpdrWasReplying = replying;

    // datalink loss
    const dl = run.datalinkUp();
    if (this.datalinkWas && !dl) {
      this.raise(10, 'datalink lost');
      this.say('$CS, Authority datalink lost. Restore immediately — disabling it requires Form PFA-883.', 'query', { key: 'dl_lost_' + Math.floor(t / 40), ack: true, penalty: 7 });
    }
    this.datalinkWas = dl;

    // readback timeouts
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      const acked = ship.comms.since(p.sentAt, 'ack', 0);
      if (acked) { this.pending.splice(i, 1); continue; }
      if (t > p.deadline) {
        if (p.retries > 0) {
          p.retries--;
          p.deadline = t + 14;
          this.raise(p.penalty * 0.4, 'no readback');
          this.say('$CS, Flight Command, how do you read? Acknowledge.', 'query');
        } else {
          this.raise(p.penalty, 'unanswered');
          this.pending.splice(i, 1);
        }
      }
    }

    // challenges (auth / toll)
    const ch = this.challenge;
    if (ch && !ch.resolved) {
      const tx = ship.comms.since(ch.sentAt, 'auth', 0);
      if (tx) {
        ch.resolved = true;
        if (ch.kind === 'auth') {
          if (tx.value === ch.expected) { this.alert = Math.max(this.floor, this.alert - 15); this.say('$CS, authentication correct. Carry on.', 'normal'); }
          else { this.raise(25, 'wrong authentication'); this.say('$CS, authentication INCORRECT. Hold for interception.', 'hostile'); }
        } else {
          this.raise(4, 'toll DF fix');
          this.say('Orbital Toll Authority: account ' + tx.value + '000-' + this.squawk + ' debited. Thank you for travelling.', 'system', { from: 'TOLL AUTH' });
        }
        run.events.onChallengeResolved(ch, tx.value === ch.expected);
      } else if (t > ch.deadline) {
        ch.resolved = true;
        this.raise(ch.kind === 'auth' ? 25 : 18, ch.kind === 'auth' ? 'failed to authenticate' : 'toll evasion');
        this.say(ch.kind === 'auth' ? '$CS, no authentication received. Your clearance is suspended.' : 'Orbital Toll Authority: unpaid toll. Your vessel has been referred to Flight Command.', ch.kind === 'auth' ? 'hostile' : 'system', { from: ch.kind === 'auth' ? 'FLIGHT CMD' : 'TOLL AUTH' });
        run.events.onChallengeResolved(ch, false);
      }
    }

    // decay toward compliance when they can see you behaving
    const trace = run.tracking.trace;
    if (t - this.lastCompliance < 6 && this.alert < 70) this.alert = Math.max(this.floor, this.alert - 0.35 * dt);
    else if (trace < 0.2 && this.alert < 60) this.alert = Math.max(this.floor, this.alert - 0.12 * dt);

    // escalation messaging
    const prev = this.level;
    this.level = this.alert >= 90 ? 'HOSTILE' : this.alert >= 70 ? 'ALERT' : this.alert >= 45 ? 'SUSPICIOUS' : this.alert >= 20 ? 'QUERY' : 'NORMAL';
    if (this.level !== prev) {
      const order: AlertLevel[] = ['NORMAL', 'QUERY', 'SUSPICIOUS', 'ALERT', 'HOSTILE'];
      if (order.indexOf(this.level) > order.indexOf(prev)) {
        if (this.level === 'QUERY') this.say('$CS, Flight Command. Confirm intentions.', 'query', { ack: true, key: 'lvl_q' });
        if (this.level === 'SUSPICIOUS') this.say('$CS, your trajectory does not correspond to filed routing. Report intentions immediately.', 'suspicious', { key: 'lvl_s' });
        if (this.level === 'ALERT') this.say('$CS, restore transponder and datalink. Interceptors are being dispatched as a courtesy.', 'hostile', { key: 'lvl_a' });
        if (this.level === 'HOSTILE') this.say('Unauthorized craft, reduce thrust and accept remote navigation authority. This is your final administrative notice.', 'hostile', { key: 'lvl_h' });
      }
    }

    // remote navigation override via datalink when hostile
    if (this.level === 'HOSTILE' && dl) {
      if (this.remoteOverride < 0) {
        this.remoteOverride = 12;
        this.say('$CS, REMOTE NAVIGATION AUTHORITY ENGAGING VIA DATALINK. Release the controls.', 'hostile', { key: 'override_' + Math.floor(t / 60) });
        ship.bus.emit('sfx', { id: 'alarm_override' });
      }
      this.remoteOverride -= dt;
      if (this.remoteOverride <= 0) run.fail('remote_override', 'Remote navigation authority via datalink');
    } else if (this.remoteOverride >= 0 && !dl) {
      this.remoteOverride = -1;
    }
  }

  issueChallenge(kind: 'auth' | 'toll'): Challenge {
    const ship = this.ship;
    const entry = this.rng.pick(this.authTable);
    const word = kind === 'auth' ? `${entry.word} ${this.rng.int(1, 9)}` : 'ACCOUNT';
    this.challenge = { word, expected: entry.digit, sentAt: ship.time, deadline: ship.time + (kind === 'auth' ? 28 : 32), kind, resolved: false };
    if (kind === 'auth') this.say(`$CS, security check. Authenticate ${entry.word}. Respond on AUTH.`, 'suspicious', { force: true });
    else this.say('Orbital Toll Authority. Your vessel has entered a tolled corridor. Transmit account digit on AUTH within thirty seconds.', 'system', { from: 'TOLL AUTH' });
    this.challenge.word = entry.word;
    return this.challenge;
  }
}
