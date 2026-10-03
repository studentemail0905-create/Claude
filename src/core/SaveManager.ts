/** Versioned local persistence with migration + corruption recovery. */
export const SAVE_KEY = 'noclearance.save';
export const SAVE_VERSION = 2;

export interface Settings {
  sensitivity: number;
  invertY: boolean;
  fov: number;
  master: number;
  radio: number;
  effects: number;
  music: number;
  shake: number;
  quality: 'low' | 'medium' | 'high';
  resolutionScale: number;
  reducedFlashing: boolean;
  reducedMotion: boolean;
  tooltips: boolean;
  radioVoice: boolean;
}

export interface RunRecord {
  n: number;
  seed: string;
  time: number;
  escaped: boolean;
  cause: string;
  maxAlt: number;
  event: string;
  credits: number;
  date: number;
}

export interface SaveData {
  version: number;
  credits: number;
  runs: number;
  escapes: number;
  failures: number;
  personalBest: number | null; // best escape time
  bestAltitude: number;
  failureCauses: Record<string, number>;
  eventsSeen: string[];
  recentEvents: string[];
  owned: string[];
  equipped: string[];
  cosmetics: { paint: string; reticle: string; display: string; snark: boolean };
  settings: Settings;
  history: RunRecord[];
  achievements: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1, invertY: false, fov: 75, master: 0.8, radio: 0.9, effects: 0.85, music: 0.4, shake: 1,
  quality: 'medium', resolutionScale: 1, reducedFlashing: false, reducedMotion: false, tooltips: true, radioVoice: false,
};

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION, credits: 0, runs: 0, escapes: 0, failures: 0, personalBest: null, bestAltitude: 0,
    failureCauses: {}, eventsSeen: [], recentEvents: [], owned: ['paint_standard', 'reticle_dot'], equipped: [],
    cosmetics: { paint: 'paint_standard', reticle: 'reticle_dot', display: 'green', snark: false },
    settings: { ...DEFAULT_SETTINGS }, history: [], achievements: [],
  };
}

/** Migrate any older/partial object to the current schema. Exported for tests. */
export function migrate(raw: any): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  let v = Number(raw.version) || 1;
  const o: any = { ...raw };
  if (v < 2) {
    // v1 stored `pb` and flat `paint`
    if (typeof o.pb === 'number') o.personalBest = o.pb;
    if (typeof o.paint === 'string') o.cosmetics = { ...d.cosmetics, paint: o.paint };
    delete o.pb;
    delete o.paint;
    v = 2;
  }
  const out: SaveData = {
    ...d,
    ...o,
    version: SAVE_VERSION,
    settings: { ...d.settings, ...(o.settings ?? {}) },
    cosmetics: { ...d.cosmetics, ...(o.cosmetics ?? {}) },
  };
  // type guards
  for (const k of ['credits', 'runs', 'escapes', 'failures', 'bestAltitude'] as const) if (!Number.isFinite(out[k])) (out as any)[k] = 0;
  for (const k of ['eventsSeen', 'recentEvents', 'owned', 'equipped', 'history', 'achievements'] as const) if (!Array.isArray(out[k])) (out as any)[k] = [];
  if (typeof out.failureCauses !== 'object' || !out.failureCauses) out.failureCauses = {};
  if (out.personalBest !== null && !Number.isFinite(out.personalBest)) out.personalBest = null;
  return out;
}

export class SaveManager {
  data: SaveData;
  recovered = false;

  constructor(private storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null) {
    this.data = this.load();
  }

  load(): SaveData {
    try {
      const s = this.storage?.getItem(SAVE_KEY);
      if (!s) return defaultSave();
      return migrate(JSON.parse(s));
    } catch {
      this.recovered = true;
      try {
        const bad = this.storage?.getItem(SAVE_KEY);
        if (bad) this.storage?.setItem(SAVE_KEY + '.corrupt', bad);
      } catch { /* ignore */ }
      return defaultSave();
    }
  }

  save(): void {
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch { /* storage unavailable */ }
  }

  reset(): void {
    this.data = defaultSave();
    this.save();
  }
}
