import { Vector3 } from 'three';
import { clamp, DEG, RAD } from '../core/mathutil';
import type { LegalFlightPlan, RouteQuery } from './LegalFlightPlan';
import type { Ship } from '../ship/Ship';

/**
 * Computes the flight-director cue (where the nose should point) for the selected
 * NAV SOURCE and the autopilot rate commands that chase it.
 */
export class FlightDirector {
  desired = new Vector3(); // world unit vector for nose
  valid = false;
  cueBody = new Vector3(); // desired direction in body frame
  errPitch = 0; // deg, + means pull up
  errYaw = 0; // deg, + means yaw right
  routeQ: RouteQuery | null = null;
  insHold = new Vector3(0, 0, -1);
  private insCaptured = false;
  targetPoint = new Vector3();

  constructor(public plan: LegalFlightPlan) {}

  update(ship: Ship): void {
    const c = ship.controls;
    const src = c.get('navSource');
    const av = ship.avionics;
    this.routeQ = this.plan.query(ship.pos.clone().sub(av.spoofOffset));
    this.valid = false;
    if (!av.displaysOn) return;
    if (src === 0) {
      // LEGAL: chase a look-ahead point on the corridor (shifted by any spoofing)
      const q = this.routeQ;
      const look = clamp(ship.env.groundSpeed * 14, 2500, 60_000);
      this.plan.pointAtS(Math.max(q.s, 0) + look, this.targetPoint).add(av.spoofOffset);
      const toT = this.targetPoint.clone().sub(ship.pos).normalize();
      // nose leads flight path by current AoA in atmosphere
      const up = ship.env.up;
      const fpaUp = toT.clone().addScaledVector(up, Math.sin(clamp(ship.env.alpha, -5 * DEG, 12 * DEG) * (ship.env.q > 500 ? 1 : 0)));
      this.desired.copy(fpaUp.normalize());
      this.valid = true;
      this.insCaptured = false;
    } else if (src === 1) {
      if (!this.insCaptured || c.get('apMaster') === 0) {
        ship.forward(this.insHold);
        this.insCaptured = true;
      }
      this.desired.copy(this.insHold);
      this.valid = true;
    } else {
      this.insCaptured = false;
      if (av.navReady && av.escLoaded) {
        this.desired.copy(ship.escapeVector);
        this.valid = true;
      }
    }
    if (this.valid) {
      const inv = ship.quat.clone().invert();
      this.cueBody.copy(this.desired).applyQuaternion(inv);
      this.errPitch = Math.atan2(this.cueBody.y, -this.cueBody.z) * RAD;
      this.errYaw = Math.atan2(this.cueBody.x, -this.cueBody.z) * RAD;
    }
  }

  /** Autopilot: body-rate commands (pitch up+, roll right+, yaw right+) in rad/s. */
  apCommand(ship: Ship): { pitchRate: number; rollRate: number; yawRate: number } {
    if (!this.valid) return { pitchRate: 0, rollRate: -ship.env.attitude.roll * 0.5, yawRate: 0 };
    const e = ship.env;
    const post = !ship.sep.moduleAttached;
    const maxP = (post ? 18 : 8) * DEG;
    const maxR = (post ? 60 : 25) * DEG;
    const ep = this.errPitch * DEG;
    const ey = this.errYaw * DEG;
    if (e.q > 1500) {
      // atmosphere: bank to turn, pitch to follow
      const bankCmd = clamp(ey * 2.2, -30 * DEG, 30 * DEG);
      const rollRate = clamp((bankCmd - e.attitude.roll) * 1.4, -maxR, maxR);
      const cosR = Math.cos(e.attitude.roll);
      const pitchRate = clamp(ep * 0.9 * cosR, -maxP, maxP);
      return { pitchRate, rollRate, yawRate: 0 };
    }
    // vacuum: point the nose directly, hold wings level relative to horizon
    const pitchRate = clamp(ep * 0.8, -maxP, maxP);
    const yawRate = clamp(ey * 0.8, -maxP, maxP);
    const rollRate = clamp(-e.attitude.roll * 0.6, -maxR * 0.3, maxR * 0.3) * (Math.abs(e.attitude.pitch) < 75 * DEG ? 1 : 0);
    return { pitchRate, rollRate, yawRate };
  }
}
