import * as THREE from 'three';
import { canvas, canvasTexture, wornMetal, screw, hazardStripes, FONT } from '../render/textures';
import { Control3D, Rotary3D, Toggle3D } from './controls/Controls3D';
import { Display, type Painter } from './Displays';
import type { Run } from '../core/Run';

export interface Lamp {
  mesh: THREE.Mesh;
  fn: (run: Run) => number | null; // hex colour or null (off)
  mat: THREE.MeshBasicMaterial;
}

export interface PanelOpts {
  ppm?: number;
  depth?: number;
  aftermarket?: boolean;
  title?: string;
  wear?: number;
}

/**
 * A physical panel: worn painted metal with printed legends, fasteners, and mounted
 * controls / lamps / CRTs. Local frame: x right, y up, front face at z = 0.
 */
export class Panel {
  group = new THREE.Group();
  readonly ppm: number;
  private c: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private ec: HTMLCanvasElement;
  private eg: CanvasRenderingContext2D;
  controls: Control3D[] = [];
  lamps: Lamp[] = [];
  displays: Display[] = [];
  emissiveMat!: THREE.MeshStandardMaterial;

  constructor(public name: string, public w: number, public h: number, paint: string, private opts: PanelOpts = {}) {
    this.ppm = opts.ppm ?? Math.min(2400, 2040 / w);
    const pw = Math.round(w * this.ppm), ph = Math.round(h * this.ppm);
    this.c = wornMetal(pw, ph, opts.aftermarket ? '#1c1d1e' : paint, opts.wear ?? 1);
    this.g = this.c.getContext('2d')!;
    [this.ec, this.eg] = canvas(pw, ph);
    this.eg.fillStyle = '#000';
    this.eg.fillRect(0, 0, pw, ph);
    // border + fasteners
    const g = this.g;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = Math.max(2, this.ppm * 0.002);
    g.strokeRect(2, 2, pw - 4, ph - 4);
    const sr = this.ppm * 0.0028;
    const inset = this.ppm * 0.009;
    for (const [x, y] of [[inset, inset], [pw - inset, inset], [inset, ph - inset], [pw - inset, ph - inset]]) screw(g, x, y, sr);
    if (opts.aftermarket) {
      // crude hand-stencilled legends and exposed hex bolts
      for (let i = 0; i < 6; i++) screw(g, inset + (i / 5) * (pw - inset * 2), ph - inset * 0.6, sr * 1.3);
    }
    if (opts.title) this.text(w / 2, 0.012, opts.title, 0.0075, opts.aftermarket ? '#d6d0b8' : '#cfc9b6');
  }

  /** Panel-local position from top-left (u, v) in metres. */
  p(u: number, v: number, z = 0): THREE.Vector3 {
    return new THREE.Vector3(u - this.w / 2, this.h / 2 - v, z);
  }

  text(u: number, v: number, s: string, size: number, color = '#e7e2d2', align: CanvasTextAlign = 'center', glow = true): void {
    for (const [g, col] of [[this.g, color], [this.eg, glow ? '#fff3d0' : '#000']] as const) {
      g.font = `bold ${Math.round(size * this.ppm)}px ${FONT}`;
      g.textAlign = align;
      g.textBaseline = 'middle';
      g.fillStyle = col;
      g.fillText(s, u * this.ppm, v * this.ppm);
    }
  }

  box(u: number, v: number, w: number, h: number, color = 'rgba(230,226,210,0.55)', lw = 0.0012): void {
    const g = this.g;
    g.strokeStyle = color;
    g.lineWidth = lw * this.ppm;
    g.strokeRect(u * this.ppm, v * this.ppm, w * this.ppm, h * this.ppm);
  }

  fill(u: number, v: number, w: number, h: number, color: string): void {
    this.g.fillStyle = color;
    this.g.fillRect(u * this.ppm, v * this.ppm, w * this.ppm, h * this.ppm);
  }

  stripes(u: number, v: number, w: number, h: number): void {
    hazardStripes(this.g, u * this.ppm, v * this.ppm, w * this.ppm, h * this.ppm, this.ppm * 0.008);
  }

  /** Warning placard (bureaucratic, red-bordered). */
  placard(u: number, v: number, w: number, lines: string[], size = 0.0055, bg = '#e9e3cf', fg = '#7a1010'): void {
    const g = this.g;
    const h = lines.length * size * 1.35 + size * 0.8;
    g.fillStyle = bg;
    g.fillRect((u - w / 2) * this.ppm, v * this.ppm, w * this.ppm, h * this.ppm);
    g.strokeStyle = fg;
    g.lineWidth = this.ppm * 0.0008;
    g.strokeRect((u - w / 2) * this.ppm, v * this.ppm, w * this.ppm, h * this.ppm);
    lines.forEach((l, i) => this.text(u, v + size * (1.0 + i * 1.35), l, size, fg, 'center', false));
  }

  add<T extends Control3D>(ctrl: T, u: number, v: number, label?: string, opts: { below?: boolean; posLabels?: boolean; labelSize?: number; labelOffset?: number } = {}): T {
    ctrl.root.position.copy(this.p(u, v));
    this.group.add(ctrl.root);
    this.controls.push(ctrl);
    const ls = opts.labelSize ?? 0.0068;
    const lo = opts.labelOffset ?? 0.026;
    if (label) {
      const lines = label.split('\n');
      lines.forEach((l, i) => this.text(u, opts.below ? v + lo + i * ls * 1.2 : v - lo - (lines.length - 1 - i) * ls * 1.2, l, ls));
    }
    if (opts.posLabels !== false && ctrl.def?.positions) {
      const pos = ctrl.def.positions;
      if (ctrl instanceof Toggle3D) {
        const n = pos.length;
        const sz = 0.0052;
        if (n === 2) {
          this.text(u, v - 0.017, pos[1], sz, '#bdb8a8');
          this.text(u, v + 0.017, pos[0], sz, '#bdb8a8');
        } else {
          this.text(u, v - 0.017, pos[2], sz, '#bdb8a8');
          this.text(u + 0.014, v, pos[1], sz * 0.9, '#bdb8a8', 'left');
          this.text(u, v + 0.017, pos[0], sz, '#bdb8a8');
        }
      } else if (ctrl instanceof Rotary3D) {
        const rr = 0.024;
        pos.forEach((pn, i) => {
          const a = ctrl.angleFor(i);
          this.text(u + Math.sin(a) * rr, v - Math.cos(a) * rr, pn, 0.0048, '#bdb8a8');
        });
      }
    }
    return ctrl;
  }

  lamp(u: number, v: number, r: number, fn: (run: Run) => number | null, legend?: string): Lamp {
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1a18, toneMapped: false });
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 16), mat);
    m.position.copy(this.p(u, v, 0.0015));
    this.group.add(m);
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r * 1.35, 16), new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.7, roughness: 0.4 }));
    ring.position.copy(this.p(u, v, 0.0012));
    this.group.add(ring);
    if (legend) this.text(u, v + r + 0.007, legend, 0.0048, '#bdb8a8');
    const lamp = { mesh: m, fn, mat };
    this.lamps.push(lamp);
    return lamp;
  }

  display(u: number, v: number, w: number, h: number, pxW: number, pxH: number, painter: Painter, hz = 15, bus: Display['bus'] = 'AV'): Display {
    const d = new Display(w, h, pxW, pxH, painter, hz, bus);
    d.mesh.position.copy(this.p(u, v, 0.0035));
    this.group.add(d.mesh);
    // bezel
    const bz = new THREE.Mesh(new THREE.BoxGeometry(w + 0.022, h + 0.022, 0.006), new THREE.MeshStandardMaterial({ color: 0x1b1c1d, roughness: 0.6 }));
    bz.position.copy(this.p(u, v, -0.0005));
    this.group.add(bz);
    this.displays.push(d);
    return d;
  }

  /** Bake textures and create the panel slab. */
  finish(): THREE.Mesh {
    const depth = this.opts.depth ?? 0.02;
    const map = canvasTexture(this.c);
    const em = canvasTexture(this.ec);
    this.emissiveMat = new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: 0xffe0a0, emissiveIntensity: 0.0, roughness: 0.75, metalness: 0.25 });
    const side = new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: 0.7 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(this.w, this.h, depth), [side, side, side, side, this.emissiveMat, side]);
    mesh.position.z = -depth / 2;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  /** Orient: centre position, facing normal, and which way is "up" on the panel. */
  place(center: THREE.Vector3, normal: THREE.Vector3, upHint: THREE.Vector3): this {
    const z = normal.clone().normalize();
    const x = new THREE.Vector3().crossVectors(upHint, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    this.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    this.group.position.copy(center);
    return this;
  }

  sync(run: Run, dt: number, lit: number): void {
    const cs = run.ship.controls;
    for (const c of this.controls) c.sync(cs, run.ship, dt);
    for (const l of this.lamps) {
      const col = l.fn(run);
      if (col === null) l.mat.color.setHex(0x1a1a18);
      else l.mat.color.setHex(col);
    }
    this.emissiveMat.emissiveIntensity = lit;
  }
}

export const _unused = canvas;
