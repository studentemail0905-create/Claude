import { Vector3 } from 'three';

/** Earth-like planet. SI units. Non-rotating for simulation simplicity. */
export const PLANET = {
  radius: 6_371_000,
  mu: 3.986004418e14,
  g0: 9.80665,
};

/** g(r) = μ / r² */
export function gravityMagnitude(r: number): number {
  return PLANET.mu / (r * r);
}

/** Gravity acceleration vector (planet-centred frame). Writes into out. */
export function gravityVector(pos: Vector3, out: Vector3): Vector3 {
  const r = pos.length();
  const g = gravityMagnitude(r);
  return out.copy(pos).multiplyScalar(-g / r);
}

export function altitudeOf(pos: Vector3): number {
  return pos.length() - PLANET.radius;
}

/** Circular orbital speed at radius r. */
export function circularSpeed(r: number): number {
  return Math.sqrt(PLANET.mu / r);
}

/** Specific orbital energy and apoapsis altitude (for nav display). */
export function apoapsisAltitude(pos: Vector3, vel: Vector3): number {
  const r = pos.length();
  const v2 = vel.lengthSq();
  const energy = v2 / 2 - PLANET.mu / r;
  if (energy >= 0) return Infinity;
  const a = -PLANET.mu / (2 * energy);
  const h = new Vector3().crossVectors(pos, vel).length();
  const e = Math.sqrt(Math.max(0, 1 - (h * h) / (PLANET.mu * a)));
  return a * (1 + e) - PLANET.radius;
}
