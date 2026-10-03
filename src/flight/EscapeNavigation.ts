import { Vector3 } from 'three';
import type { RNG } from '../core/RNG';
import { DEG } from '../core/mathutil';

/**
 * The illegal escape vector: an inertial direction (jump corridor) stored on a
 * black-market cartridge. Rolled per run, generally up and ahead of the lane.
 */
export function rollEscapeVector(rng: RNG): { vec: Vector3; azimuth: number; elevation: number; designation: string } {
  const r = rng.fork('escape');
  const az = (62 + r.range(-45, 70)) * DEG;
  const el = r.range(22, 58) * DEG;
  // launch-site local frame: up = +Y, east = +X, north = -Z
  const vec = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  const designation = `${String.fromCharCode(65 + r.int(0, 25))}${String.fromCharCode(65 + r.int(0, 25))}-${r.int(100, 999)}`;
  return { vec, azimuth: az, elevation: el, designation };
}
