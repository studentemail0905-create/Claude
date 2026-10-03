type Handler<T> = (payload: T) => void;

/** Minimal typed pub/sub used for audio cues, UI and cockpit feedback. */
export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler<any>>>();

  on<K extends keyof Events>(type: K, h: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(h);
    return () => set!.delete(h);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (set) for (const h of set) h(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}

export interface SimEvents {
  [k: string]: unknown;
  /** One-shot sound cue from simulation. */
  sfx: { id: string; gain?: number; pan?: number };
  /** Radio transmission received/heard. */
  radio: { from: string; text: string; tone: 'normal' | 'query' | 'suspicious' | 'hostile' | 'system' | 'pa' };
  /** Camera shake impulse (0..1+). */
  shake: { amount: number; duration?: number };
  /** A control was physically actuated (for audio). */
  control: { id: string; kind: string; value: number };
  separation: { clean: boolean };
  podRelease: { index: number; safe: boolean };
  jump: { phase: 'start' | 'success' | 'fail' };
}
