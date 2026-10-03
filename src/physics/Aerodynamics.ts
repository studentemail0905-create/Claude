import { Vector3 } from 'three';
import type { AeroConfig } from '../data/Balance';
import { clamp, DEG, lerp } from '../core/mathutil';

export interface AeroInput {
  cfg: AeroConfig;
  vAirBody: Vector3; // ship velocity relative to air mass, body frame (x right, y up, z aft)
  omega: Vector3; // body angular velocity
  rho: number;
  mach: number;
  xcg: number; // body z of centre of gravity (aft +)
  de: number; // elevator command, -1..1 (+ = nose up)
  da: number; // aileron, -1..1 (+ = roll right)
  dr: number; // rudder, -1..1 (+ = yaw right)
  surfaceAuth: number; // 0..1 achievable deflection fraction (hydraulics / hinge moment)
  speedBrake: number; // 0..1
  gearDrag: number; // 0..1
  extraDrag: number; // damage / pods
  turbulence: Vector3; // rad/s gust-induced rate disturbance
}

export interface AeroOutput {
  force: Vector3; // body frame, N
  torque: Vector3; // body frame, N·m (about CG)
  alpha: number; // rad
  beta: number; // rad
  q: number; // dynamic pressure Pa
  CL: number;
  CD: number;
  stalled: boolean;
  buffet: number; // 0..1
  liftN: number;
}

/** Lift-curve slope multiplier vs Mach (Prandtl–Glauert subsonic, Ackeret supersonic). */
export function machLiftFactor(M: number): number {
  if (M < 0.8) return 1 / Math.sqrt(1 - M * M);
  if (M < 1.2) return lerp(1 / Math.sqrt(1 - 0.64), 0.95, (M - 0.8) / 0.4);
  return clamp(1.6 / Math.sqrt(M * M - 1), 0.18, 1.0);
}

/** Zero-lift drag multiplier vs Mach (transonic wave-drag rise). */
export function machDragFactor(M: number): number {
  if (M < 0.82) return 1;
  if (M < 1.08) return lerp(1, 2.7, (M - 0.82) / 0.26);
  if (M < 2.5) return lerp(2.7, 1.55, (M - 1.08) / 1.42);
  return Math.max(1.15, 1.55 - (M - 2.5) * 0.05);
}

/** Control-surface effectiveness vs Mach (shock-induced loss at hypersonic speeds). */
export function machControlFactor(M: number): number {
  if (M < 0.9) return 1;
  if (M < 1.2) return 0.82;
  return clamp(1.1 / Math.sqrt(M), 0.3, 0.9);
}

const _v = new Vector3();
const _l = new Vector3();
const X = new Vector3(1, 0, 0);

export function computeAero(inp: AeroInput, out: AeroOutput): AeroOutput {
  const { cfg, vAirBody, rho, mach } = inp;
  const V = vAirBody.length();
  out.force.set(0, 0, 0);
  out.torque.set(0, 0, 0);
  out.q = 0.5 * rho * V * V;
  out.alpha = 0;
  out.beta = 0;
  out.CL = 0;
  out.CD = 0;
  out.stalled = false;
  out.buffet = 0;
  out.liftN = 0;
  if (V < 0.5 || rho < 1e-12) return out;

  const u = -vAirBody.z;
  const alpha = Math.atan2(-vAirBody.y, Math.max(1e-3, Math.abs(u))) * (u >= 0 ? 1 : -1);
  const beta = Math.asin(clamp(vAirBody.x / V, -1, 1));
  out.alpha = alpha;
  out.beta = beta;

  const fL = machLiftFactor(mach);
  const fD = machDragFactor(mach);
  const fC = machControlFactor(mach);
  const aS = cfg.alphaStall * DEG;
  const absA = Math.abs(alpha);
  let CL: number;
  const claM = cfg.cla * fL;
  if (absA <= aS) CL = claM * alpha;
  else {
    // post-stall: drop to ~60% then flat-plate behaviour
    const CLmax = claM * aS;
    const flat = 1.05 * Math.sin(2 * alpha);
    const t = clamp((absA - aS) / (8 * DEG), 0, 1);
    CL = lerp(Math.sign(alpha) * CLmax * 0.92, flat * 0.75, t);
    out.stalled = true;
  }
  // hypersonic Newtonian contribution
  if (mach > 3) CL += Math.sign(alpha) * 2 * Math.sin(absA) ** 2 * Math.cos(alpha) * clamp((mach - 3) / 3, 0, 1) * 0.5;
  const sinA = Math.sin(absA);
  let CD = cfg.cd0 * fD + (CL * CL) / (Math.PI * cfg.e * cfg.AR) + 1.4 * sinA * sinA * sinA + Math.abs(Math.sin(beta)) * 0.4;
  CD += inp.speedBrake * 0.055 + inp.gearDrag * 0.022 + inp.extraDrag;
  const CY = cfg.cyb * beta;
  out.CL = CL;
  out.CD = CD;
  out.buffet = clamp((absA - aS * 0.85) / (aS * 0.4), 0, 1) + (mach > 0.88 && mach < 1.1 ? 0.35 : 0);

  const qS = out.q * cfg.S;
  // directions
  _v.copy(vAirBody).multiplyScalar(1 / V);
  _l.crossVectors(X, _v);
  if (_l.lengthSq() < 1e-9) _l.set(0, 1, 0);
  _l.normalize();
  out.force.addScaledVector(_l, qS * CL);
  out.force.addScaledVector(_v, -qS * CD);
  out.force.x += qS * CY;
  out.liftN = qS * CL;

  // moments (aircraft convention: M + nose up, L + roll right, N + yaw right)
  const pitchRate = inp.omega.x + inp.turbulence.x;
  const rollRate = -inp.omega.z + inp.turbulence.z;
  const yawRate = -inp.omega.y + inp.turbulence.y;
  const cHat = cfg.c / (2 * V);
  const bHat = cfg.b / (2 * V);
  const xcp = cfg.xcp + (mach > 1.2 ? 0.6 : mach > 0.9 ? 0.3 : 0);
  const cma = -claM * ((xcp - inp.xcg) / cfg.c);
  const auth = inp.surfaceAuth * fC;
  let Cm = cma * (absA <= aS ? alpha : Math.sign(alpha) * aS + (alpha - Math.sign(alpha) * aS) * 0.4) + cfg.cmq * pitchRate * cHat + cfg.cmd * inp.de * auth;
  Cm += -inp.speedBrake * 0.02;
  const Cl = cfg.clb * beta + cfg.clp * rollRate * bHat + cfg.cld * inp.da * auth * (out.stalled ? 0.4 : 1);
  const Cn = cfg.cnb * beta + cfg.cnr * yawRate * bHat + cfg.cnd * inp.dr * auth;

  const M = qS * cfg.c * Cm;
  const L = qS * cfg.b * Cl;
  const N = qS * cfg.b * Cn;
  out.torque.set(M, -N, -L);
  return out;
}

export function newAeroOutput(): AeroOutput {
  return { force: new Vector3(), torque: new Vector3(), alpha: 0, beta: 0, q: 0, CL: 0, CD: 0, stalled: false, buffet: 0, liftN: 0 };
}
