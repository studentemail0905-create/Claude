/** Hidden progression zones (never shown, never lock controls). */
export const ZONE_NAMES = ['ground', 'launch', 'controlled airspace', 'upper atmosphere', 'near-space', 'orbital control region', 'escape vector', 'jump preparation'];
export const ZONE_REWARD = [0, 2, 5, 9, 14, 20, 26, 32];
export const ZONE_HOLD = 6; // seconds sustained to bank a zone

export interface ZoneTracker {
  current: number;
  held: number[];
  banked: boolean[];
  best: number;
  nextProgress: number; // 0..1 toward next zone at the moment of failure
}

export function newZoneTracker(): ZoneTracker {
  return { current: 0, held: new Array(8).fill(0), banked: new Array(8).fill(false), best: 0, nextProgress: 0 };
}

export interface ZoneInputs {
  airborne: boolean;
  altitude: number;
  separated: boolean;
  aligned: boolean; // < 10°
  solution: boolean;
  chargeFrac: number; // charge / required
  coilsArmed: boolean;
}

export function zoneOf(z: ZoneInputs): number {
  if (!z.airborne) return 0;
  let k = 1;
  if (z.altitude > 3000) k = 2;
  if (z.altitude > 20_000) k = 3;
  if (z.altitude > 60_000) k = 4;
  if (z.altitude > 100_000) k = 5;
  if (k >= 5 && z.altitude > 110_000 && z.separated && z.aligned && z.solution) k = 6;
  if (k >= 6 && z.chargeFrac > 0.7 && z.coilsArmed) k = 7;
  return k;
}

const ZONE_ALT = [0, 1, 3000, 20_000, 60_000, 100_000, 110_000, 110_000];

export function updateZones(t: ZoneTracker, zin: ZoneInputs, dt: number): void {
  const z = zoneOf(zin);
  t.current = z;
  for (let i = 1; i <= z; i++) {
    t.held[i] += dt;
    if (t.held[i] >= ZONE_HOLD) t.banked[i] = true;
  }
  t.best = Math.max(t.best, z);
  const next = Math.min(7, z + 1);
  t.nextProgress = next <= 5 ? Math.min(1, zin.altitude / ZONE_ALT[next]) : z >= next ? 1 : 0.5;
}

export interface RewardInput {
  zones: ZoneTracker;
  escaped: boolean;
  runTime: number;
  tracePeak: number;
  alertPeak: number;
  eventStatus: string;
  passengersSafe: number;
  maskingTime: number;
  damage: number;
}

export interface RewardBreakdown {
  lines: { label: string; amount: number }[];
  total: number;
  pity: number;
}

export function calculateReward(r: RewardInput): RewardBreakdown {
  const lines: { label: string; amount: number }[] = [];
  let zoneSum = 0;
  for (let i = 1; i < 8; i++) if (r.zones.banked[i]) zoneSum += ZONE_REWARD[i];
  if (zoneSum) lines.push({ label: 'Sustained progress', amount: zoneSum });
  let pity = 0;
  if (!r.escaped) {
    const best = r.zones.best;
    // committed toward the next zone but did not hold it: 1–2 credits, never full value
    if (best >= 1 && !r.zones.banked[Math.min(7, best + 1)] && r.zones.nextProgress > 0.8) pity = r.zones.nextProgress > 0.93 ? 2 : 1;
    if (best >= 1 && !r.zones.banked[best] && r.zones.held[best] > ZONE_HOLD * 0.6) pity = Math.max(pity, 1);
    if (pity) lines.push({ label: 'Near-breakthrough', amount: pity });
  } else {
    lines.push({ label: 'Escape', amount: 120 });
    const speed = Math.max(0, Math.round((540 - r.runTime) / 4));
    if (speed) lines.push({ label: 'Speed', amount: speed });
    const stealth = Math.round((1 - Math.min(1, r.tracePeak)) * 40 + (r.alertPeak < 45 ? 25 : 0));
    if (stealth) lines.push({ label: 'Stealth', amount: stealth });
    if (r.passengersSafe) lines.push({ label: 'Passengers delivered', amount: r.passengersSafe });
    if (r.damage > 0.25) lines.push({ label: 'Risk (damage carried)', amount: Math.round(r.damage * 40) });
  }
  if (r.eventStatus === 'resolved') lines.push({ label: 'Event resolved', amount: 15 });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, total, pity };
}
