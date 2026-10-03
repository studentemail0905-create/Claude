import type { Run } from '../core/Run';
import type { RNG } from '../core/RNG';

export interface EventState {
  t: number;
  rng: RNG;
  data: Record<string, any>;
}

/** A major run-changing disruption. It manipulates real systems; it is never a minigame. */
export interface MajorEvent {
  id: string;
  name: string;
  weight: number;
  /** Preferred altitude band for triggering (m). */
  minAlt?: number;
  maxAlt?: number;
  canTrigger(run: Run): boolean;
  begin(run: Run, s: EventState): void;
  update(dt: number, run: Run, s: EventState): void;
  isResolved(run: Run, s: EventState): boolean;
  hasFailed(run: Run, s: EventState): boolean;
  cleanup(run: Run, s: EventState): void;
  onChallenge?(run: Run, s: EventState, ok: boolean): void;
}

export function defineEvent(e: Partial<MajorEvent> & Pick<MajorEvent, 'id' | 'name' | 'weight' | 'begin'>): MajorEvent {
  return {
    canTrigger: () => true,
    update: () => {},
    isResolved: (_r, s) => s.t > 60,
    hasFailed: () => false,
    cleanup: () => {},
    ...e,
  };
}
