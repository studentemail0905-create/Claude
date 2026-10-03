import * as THREE from 'three';
import { canvas, MONO } from '../render/textures';
import { RAD, DEG, wrap360 } from '../core/mathutil';
import type { Run } from '../core/Run';

/**
 * Combiner-glass head-up display. Because the pilot's head only rotates about the
 * design eye, projecting body-frame directions onto this plane is exactly conformal.
 */
export class HUD {
  mesh: THREE.Mesh;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private W = 640;
  private H = 500;
  readonly zPlane = -0.62;
  readonly cy = 0.0;
  readonly width = 0.27;
  readonly height = 0.21;
  private mat: THREE.MeshBasicMaterial;
  private acc = 0;

  constructor() {
    const [c, g] = canvas(this.W, this.H);
    this.g = g;
    this.tex = new THREE.CanvasTexture(c);
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.width, this.height), this.mat);
    this.mesh.position.set(0, this.cy, this.zPlane);
    this.mesh.renderOrder = 10;
  }

  private proj(dBody: THREE.Vector3): [number, number] | null {
    if (dBody.z > -0.05) return null;
    const t = this.zPlane / dBody.z;
    const x = dBody.x * t, y = dBody.y * t;
    return [((x + this.width / 2) / this.width) * this.W, ((this.cy + this.height / 2 - y) / this.height) * this.H];
  }

  update(dt: number, run: Run, powered: boolean, bright: number): void {
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    const g = this.g;
    g.clearRect(0, 0, this.W, this.H);
    this.mat.opacity = bright;
    if (!powered || bright < 0.05) {
      this.tex.needsUpdate = true;
      return;
    }
    const s = run.ship;
    const e = s.env;
    const inv = s.quat.clone().invert();
    const toBody = (w: THREE.Vector3) => w.clone().applyQuaternion(inv);
    const col = 'rgba(120,255,150,0.95)';
    g.strokeStyle = col;
    g.fillStyle = col;
    g.lineWidth = 2.5;
    g.font = `bold 20px ${MONO}`;
    g.textBaseline = 'middle';
    // horizon-referenced pitch ladder along current heading
    const hdg = e.attitude.heading;
    const dirAt = (elev: number, az: number) =>
      e.east.clone().multiplyScalar(Math.sin(az) * Math.cos(elev)).addScaledVector(e.north, Math.cos(az) * Math.cos(elev)).addScaledVector(e.up, Math.sin(elev));
    for (let a = -90; a <= 90; a += 5) {
      const el = a * DEG;
      const left = this.proj(toBody(dirAt(el, hdg - (a === 0 ? 14 : 5) * DEG)));
      const right = this.proj(toBody(dirAt(el, hdg + (a === 0 ? 14 : 5) * DEG)));
      const inL = this.proj(toBody(dirAt(el, hdg - 1.6 * DEG)));
      const inR = this.proj(toBody(dirAt(el, hdg + 1.6 * DEG)));
      if (!left || !right || !inL || !inR) continue;
      g.setLineDash(a < 0 ? [8, 6] : []);
      g.beginPath();
      if (a === 0) {
        g.moveTo(left[0], left[1]);
        g.lineTo(right[0], right[1]);
      } else {
        g.moveTo(left[0], left[1]);
        g.lineTo(inL[0], inL[1]);
        g.moveTo(inR[0], inR[1]);
        g.lineTo(right[0], right[1]);
      }
      g.stroke();
      g.setLineDash([]);
      if (a !== 0 && a % 10 === 0) {
        g.textAlign = 'right';
        g.fillText(String(a), left[0] - 6, left[1]);
      }
    }
    // boresight
    g.beginPath();
    g.moveTo(this.W / 2 - 18, this.H * 0.5 - (this.cy / this.height) * this.H);
    const bs = this.proj(new THREE.Vector3(0, 0, -1))!;
    g.moveTo(bs[0] - 20, bs[1]);
    g.lineTo(bs[0] - 8, bs[1]);
    g.lineTo(bs[0], bs[1] + 8);
    g.lineTo(bs[0] + 8, bs[1]);
    g.lineTo(bs[0] + 20, bs[1]);
    g.stroke();
    // flight path vector (velocity relative to air in atmosphere, inertial in space)
    const vRef = e.q > 200 ? s.vel.clone().sub(e.windWorld) : s.vel.clone();
    if (vRef.length() > 15) {
      const fp = this.proj(toBody(vRef.normalize()));
      if (fp) {
        g.beginPath();
        g.arc(fp[0], fp[1], 9, 0, Math.PI * 2);
        g.moveTo(fp[0] - 24, fp[1]);
        g.lineTo(fp[0] - 9, fp[1]);
        g.moveTo(fp[0] + 9, fp[1]);
        g.lineTo(fp[0] + 24, fp[1]);
        g.moveTo(fp[0], fp[1] - 9);
        g.lineTo(fp[0], fp[1] - 19);
        g.stroke();
      }
      // prograde marker in space
      if (e.q < 200) {
        const rp = this.proj(toBody(s.vel.clone().normalize().negate()));
        if (rp) {
          g.beginPath();
          g.arc(rp[0], rp[1], 9, 0, Math.PI * 2);
          g.moveTo(rp[0] - 7, rp[1] - 7);
          g.lineTo(rp[0] + 7, rp[1] + 7);
          g.moveTo(rp[0] + 7, rp[1] - 7);
          g.lineTo(rp[0] - 7, rp[1] + 7);
          g.stroke();
        }
      }
    }
    // flight director cue
    if (run.fd.valid && s.controls.get('fd') === 1) {
      const p = this.proj(run.fd.cueBody.clone().normalize());
      g.strokeStyle = 'rgba(255,140,255,0.95)';
      if (p) {
        g.beginPath();
        g.arc(p[0], p[1], 14, 0, Math.PI * 2);
        g.moveTo(p[0] - 5, p[1]);
        g.lineTo(p[0] + 5, p[1]);
        g.stroke();
      } else {
        // off-scale arrow
        const ang = Math.atan2(-run.fd.cueBody.y, run.fd.cueBody.x);
        const cx = this.W / 2, cy = this.H / 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(ang) * 180, cy + Math.sin(ang) * 180);
        g.lineTo(cx + Math.cos(ang + 0.1) * 150, cy + Math.sin(ang + 0.1) * 150);
        g.lineTo(cx + Math.cos(ang - 0.1) * 150, cy + Math.sin(ang - 0.1) * 150);
        g.closePath();
        g.stroke();
      }
      g.strokeStyle = col;
    }
    // escape vector diamond
    if (s.avionics.escLoaded && s.avionics.navReady) {
      const p = this.proj(toBody(s.escapeVector));
      if (p) {
        g.strokeStyle = 'rgba(140,220,255,0.95)';
        g.beginPath();
        g.moveTo(p[0], p[1] - 14);
        g.lineTo(p[0] + 14, p[1]);
        g.lineTo(p[0], p[1] + 14);
        g.lineTo(p[0] - 14, p[1]);
        g.closePath();
        g.stroke();
        g.strokeStyle = col;
      }
    }
    // readouts
    g.textAlign = 'left';
    g.fillText(`${Math.round(e.eas)}`, 30, this.H * 0.45);
    g.fillText(`M${e.mach.toFixed(2)}`, 30, this.H * 0.45 + 28);
    g.fillText(`G${e.nz.toFixed(1)}`, 30, this.H * 0.45 + 56);
    g.fillText(`α${(e.alpha * RAD).toFixed(0)}`, 30, this.H * 0.45 + 84);
    g.textAlign = 'right';
    const alt = e.altitude;
    g.fillText(alt < 20_000 ? `${Math.round(alt)}` : `${(alt / 1000).toFixed(1)}K`, this.W - 30, this.H * 0.45);
    g.fillText(`${e.vs >= 0 ? '+' : ''}${Math.round(e.vs)}`, this.W - 30, this.H * 0.45 + 28);
    g.textAlign = 'center';
    g.fillText(String(Math.round(wrap360(hdg * RAD))).padStart(3, '0'), this.W / 2, 22);
    if (run.interceptors.missileInbound) {
      g.fillStyle = 'rgba(255,120,90,1)';
      g.font = `bold 34px ${MONO}`;
      g.fillText('MISSILE', this.W / 2, this.H - 40);
    } else if (e.stalled && e.q > 300 && !e.onGround) {
      g.font = `bold 34px ${MONO}`;
      g.fillText('STALL', this.W / 2, this.H - 40);
    }
    this.tex.needsUpdate = true;
  }
}
