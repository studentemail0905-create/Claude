import type { Run } from '../core/Run';
import type { RNG } from '../core/RNG';
import type { EventState, MajorEvent } from './EventDefinition';
import { HOSTILE_EVENTS } from './defs/hostile';
import { SYSTEM_EVENTS } from './defs/systems';
import { BUREAUCRACY_EVENTS } from './defs/bureaucracy';
import { clamp01 } from '../core/mathutil';
import type { Challenge } from '../government/FlightCommand';

export const ALL_EVENTS: MajorEvent[] = [...HOSTILE_EVENTS, ...SYSTEM_EVENTS, ...BUREAUCRACY_EVENTS];

export type EventStatus = 'pending' | 'active' | 'resolved' | 'failed' | 'expired';

/**
 * Picks ONE major event per run (seeded, weighted, repeat-protected) and fires it
 * from a hazard function of altitude, time, alert and ship state — never a fixed timer.
 */
export class EventDirector {
  selected: MajorEvent;
  status: EventStatus = 'pending';
  state: EventState | null = null;
  triggerAlt: number;
  triggeredAt = -1;
  hazard = 0;
  forced: MajorEvent | null = null;
  private rng: RNG;
  private substituted = false;

  constructor(private run: Run, recent: string[]) {
    this.rng = run.rng.fork('events');
    const pool = ALL_EVENTS.filter((e) => !recent.slice(-3).includes(e.id));
    this.selected = this.rng.weighted(pool.length ? pool : ALL_EVENTS, (e) => e.weight);
    this.triggerAlt = this.rng.range(28_000, 105_000);
    if (this.selected.minAlt) this.triggerAlt = Math.max(this.triggerAlt, this.selected.minAlt + 3000);
    if (this.selected.maxAlt) this.triggerAlt = Math.min(this.triggerAlt, this.selected.maxAlt - 4000);
  }

  get active(): MajorEvent | null {
    return this.status === 'active' ? this.selected : null;
  }

  trigger(ev?: MajorEvent): void {
    if (ev) this.selected = ev;
    this.status = 'active';
    this.triggeredAt = this.run.ship.time;
    this.state = { t: 0, rng: this.rng.fork(this.selected.id), data: {} };
    this.selected.begin(this.run, this.state);
    this.run.split('major event');
    this.run.ship.bus.emit('sfx', { id: 'master_caution' });
  }

  onSweep(): void {}

  onChallengeResolved(_ch: Challenge, ok: boolean): void {
    if (this.status === 'active' && this.selected.onChallenge && this.state) this.selected.onChallenge(this.run, this.state, ok);
  }

  update(dt: number): void {
    const run = this.run;
    const ship = run.ship;
    if (this.status === 'pending') {
      const e = ship.env;
      if (e.onGround || run.ship.time < 20) return;
      const sel = this.selected;
      const inBand = (!sel.minAlt || e.altitude >= sel.minAlt) && (!sel.maxAlt || e.altitude <= sel.maxAlt);
      const altScore = clamp01(e.altitude / this.triggerAlt);
      const timeScore = clamp01((ship.time - 60) / 240);
      const alertScore = run.flightCommand.alert / 100;
      const sepScore = ship.sep.moduleAttached ? 0 : 0.25;
      this.hazard = 0.002 + 0.06 * Math.pow(altScore * 0.65 + timeScore * 0.25 + alertScore * 0.15 + sepScore, 3);
      const can = inBand && sel.canTrigger(run);
      if (can && (e.altitude >= this.triggerAlt || this.rng.next() < this.hazard * dt)) this.trigger();
      else if (!can && !this.substituted && (e.altitude > this.triggerAlt + 15_000 || (sel.maxAlt && e.altitude > sel.maxAlt))) {
        // the chosen event can no longer physically happen — the universe improvises
        this.substituted = true;
        const alts = ALL_EVENTS.filter((x) => x !== sel && (!x.minAlt || e.altitude >= x.minAlt) && (!x.maxAlt || e.altitude <= x.maxAlt) && x.canTrigger(run));
        if (alts.length) this.selected = this.rng.weighted(alts, (x) => x.weight);
        this.triggerAlt = e.altitude + this.rng.range(2000, 12_000);
      }
      return;
    }
    if (this.status !== 'active' || !this.state) return;
    this.state.t += dt;
    this.selected.update(dt, run, this.state);
    if (this.selected.hasFailed(run, this.state)) this.finish('failed');
    else if (this.selected.isResolved(run, this.state)) this.finish('resolved');
  }

  finish(status: EventStatus): void {
    if (this.state) this.selected.cleanup(this.run, this.state);
    this.status = status;
  }
}
