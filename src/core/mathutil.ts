export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
/** Exponential approach factor for a first-order lag with time constant tau. */
export const approach = (cur: number, target: number, tau: number, dt: number) =>
  tau <= 0 ? target : cur + (target - cur) * (1 - Math.exp(-dt / tau));
export const moveToward = (cur: number, target: number, maxDelta: number) =>
  Math.abs(target - cur) <= maxDelta ? target : cur + Math.sign(target - cur) * maxDelta;
export const logistic = (x: number) => 1 / (1 + Math.exp(-x));
export const wrap360 = (a: number) => ((a % 360) + 360) % 360;
export const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

export function fmtTime(t: number): string {
  if (!Number.isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
