import * as THREE from 'three';
import { CONTROL_MAP, type ControlDef, type ControlState } from '../../ship/Controls';
import { canvas, canvasTexture, FONT } from '../../render/textures';
import type { Ship } from '../../ship/Ship';

/** Shared materials (one per look) to keep draw state small. */
export const MAT = {
  metal: new THREE.MeshStandardMaterial({ color: 0x9a9890, metalness: 0.85, roughness: 0.35 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x2a2b2d, metalness: 0.6, roughness: 0.5 }),
  black: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55 }),
  knob: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.2 }),
  white: new THREE.MeshStandardMaterial({ color: 0xe4e1d6, roughness: 0.5 }),
  red: new THREE.MeshStandardMaterial({ color: 0xa31a14, roughness: 0.45 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xd6ad1c, roughness: 0.5 }),
  hit: new THREE.MeshBasicMaterial({ visible: false }),
};

const G = {
  nut: new THREE.CylinderGeometry(0.0075, 0.0075, 0.004, 6).rotateX(Math.PI / 2),
  bat: new THREE.CylinderGeometry(0.0018, 0.0026, 0.024, 8).translate(0, 0.012, 0),
  batTip: new THREE.SphereGeometry(0.0034, 10, 8).translate(0, 0.024, 0),
  knob: new THREE.CylinderGeometry(0.011, 0.012, 0.013, 20).rotateX(Math.PI / 2).translate(0, 0, 0.0065),
  knobSmall: new THREE.CylinderGeometry(0.008, 0.009, 0.012, 16).rotateX(Math.PI / 2).translate(0, 0, 0.006),
  pointer: new THREE.BoxGeometry(0.0022, 0.012, 0.002).translate(0, 0.005, 0.0135),
  breaker: new THREE.CylinderGeometry(0.0042, 0.0042, 0.012, 12).rotateX(Math.PI / 2),
  breakerCollar: new THREE.CylinderGeometry(0.0044, 0.0044, 0.004, 12).rotateX(Math.PI / 2),
};

export type DragMode = 'none' | 'x' | 'y';

/** Base physical control bound to one ControlState id. */
export abstract class Control3D {
  root = new THREE.Group();
  hit: THREE.Mesh[] = [];
  def: ControlDef;
  /** Highlightable materials (cloned per control). */
  protected hl: THREE.MeshStandardMaterial[] = [];
  hovered = false;
  drag: DragMode = 'none';
  guardId: string | null = null;

  constructor(public id: string) {
    this.def = CONTROL_MAP[id];
    this.guardId = this.def?.guard ?? null;
  }

  protected own(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    const m = mat.clone();
    this.hl.push(m);
    return m;
  }

  protected addHit(w: number, h: number, d: number, z = d / 2, x = 0, y = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT.hit);
    m.position.set(x, y, z);
    m.userData.control = this;
    this.root.add(m);
    this.hit.push(m);
    return m;
  }

  setHover(on: boolean): void {
    if (this.hovered === on) return;
    this.hovered = on;
    for (const m of this.hl) m.emissive.setHex(on ? 0x2a3a2a : 0x000000);
  }

  label(cs: ControlState): string {
    const v = cs.get(this.id);
    const pos = this.def.positions ? this.def.positions[v] : this.def.kind === 'knob' || this.def.kind === 'lever' ? `${Math.round(v * 100)}%` : '';
    return pos ? `${this.def.label} — ${pos}` : this.def.label;
  }

  /** Primary (LMB) / secondary (RMB) click. Return true if something physically moved. */
  click(_btn: number, _cs: ControlState): boolean { return false; }
  release(_cs: ControlState): void {}
  wheel(_d: number, _cs: ControlState): boolean { return false; }
  dragBy(_dx: number, _dy: number, _cs: ControlState): void {}
  abstract sync(cs: ControlState, ship: Ship, dt: number): void;
}

const step = (cs: ControlState, id: string, d: number) => {
  const def = CONTROL_MAP[id];
  const n = def.positions!.length;
  const v = cs.get(id);
  const nv = Math.max(0, Math.min(n - 1, v + d));
  if (nv === v) return false;
  return cs.set(id, nv);
};

export class Toggle3D extends Control3D {
  private lever = new THREE.Group();
  private angle = 0;
  constructor(id: string, big = false) {
    super(id);
    const s = big ? 1.5 : 1;
    const nut = new THREE.Mesh(G.nut, MAT.metal);
    nut.scale.setScalar(s);
    this.root.add(nut);
    const bat = new THREE.Mesh(G.bat, this.own(MAT.metal));
    const tip = new THREE.Mesh(G.batTip, this.own(MAT.metal));
    this.lever.add(bat, tip);
    this.lever.rotation.x = 0;
    this.lever.scale.setScalar(s);
    this.root.add(this.lever);
    this.addHit(0.022 * s, 0.04 * s, 0.03 * s, 0.015 * s);
  }
  private targetAngle(cs: ControlState): number {
    const n = this.def.positions!.length;
    const v = cs.get(this.id);
    if (n === 2) return v ? 0.5 : -0.5;
    return (v - (n - 1) / 2) * 0.5;
  }
  click(btn: number, cs: ControlState): boolean {
    const n = this.def.positions!.length;
    if (n === 2) return cs.set(this.id, btn === 2 ? 0 : cs.get(this.id) ? 0 : 1);
    return step(cs, this.id, btn === 2 ? -1 : 1);
  }
  wheel(d: number, cs: ControlState): boolean {
    return step(cs, this.id, d > 0 ? 1 : -1);
  }
  sync(cs: ControlState, _s: Ship, dt: number): void {
    const t = this.targetAngle(cs);
    this.angle += (t - this.angle) * Math.min(1, dt * 30);
    // bat geometry is authored along +y; neutral sticks out of the panel (+z), higher positions tilt toward +y
    this.lever.rotation.x = Math.PI / 2 - this.angle;
  }
}

export class Guard3D extends Control3D {
  private pivot = new THREE.Group();
  private open = 0;
  constructor(id: string, w = 0.03, h = 0.046, striped = true) {
    super(id);
    const [c, g] = canvas(64, 96);
    g.fillStyle = '#b01c16';
    g.fillRect(0, 0, 64, 96);
    if (striped) {
      g.fillStyle = '#e0b520';
      for (let i = -96; i < 96; i += 24) {
        g.beginPath();
        g.moveTo(i, 96);
        g.lineTo(i + 12, 96);
        g.lineTo(i + 12 + 96, 0);
        g.lineTo(i + 96, 0);
        g.fill();
      }
    }
    const mat = this.own(new THREE.MeshStandardMaterial({ map: canvasTexture(c), roughness: 0.5, transparent: false }));
    const cover = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.022), mat);
    cover.position.set(0, -h / 2, 0.011);
    this.pivot.add(cover);
    this.pivot.position.set(0, h / 2, 0.002);
    this.root.add(this.pivot);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(w + 0.004, h + 0.004, 0.03), MAT.hit);
    hb.position.set(0, -h / 2, 0.015);
    hb.userData.control = this;
    this.pivot.add(hb);
    this.hit.push(hb);
  }
  click(btn: number, cs: ControlState): boolean {
    const nv = btn === 2 ? 0 : cs.get(this.id) ? 0 : 1;
    const ok = cs.set(this.id, nv);
    if (ok && nv === 0) {
      // closing a guard pushes the guarded switch to its safe position
      for (const d of Object.values(CONTROL_MAP)) if (d.guard === this.id && d.guardSafe !== undefined) cs.set(d.id, d.guardSafe);
    }
    return ok;
  }
  label(cs: ControlState): string {
    return `${this.def.label} — ${cs.get(this.id) ? 'OPEN' : 'CLOSED'}`;
  }
  sync(cs: ControlState, _s: Ship, dt: number): void {
    const t = cs.get(this.id) ? 1 : 0;
    this.open += (t - this.open) * Math.min(1, dt * 14);
    this.pivot.rotation.x = -this.open * 1.95;
  }
}

/** Push button with lit legend. `lit` decides the lamp from real system state. */
export class Button3D extends Control3D {
  private cap: THREE.Mesh;
  private press = 0;
  private legendMat: THREE.MeshStandardMaterial;
  private pressedFor = 0;
  constructor(id: string, legend: string[], private lit: (s: Ship, cs: ControlState) => number = () => 0, color = '#e9e2c8', w = 0.024, h = 0.018) {
    super(id);
    const [c, g] = canvas(96, 72);
    g.fillStyle = '#181818';
    g.fillRect(0, 0, 96, 72);
    g.font = `bold ${legend.length > 1 ? 22 : 26}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    legend.forEach((l, i) => g.fillText(l, 48, 36 + (i - (legend.length - 1) / 2) * 24));
    const tex = canvasTexture(c);
    this.legendMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.4 });
    this.hl.push(this.legendMat);
    const body = new THREE.BoxGeometry(w, h, 0.009);
    this.cap = new THREE.Mesh(body, [MAT.black, MAT.black, MAT.black, MAT.black, this.legendMat, MAT.black]);
    this.cap.position.z = 0.0045;
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.005, h + 0.005, 0.003), MAT.darkMetal);
    bezel.position.z = 0.0015;
    this.root.add(bezel, this.cap);
    this.addHit(w + 0.006, h + 0.006, 0.02, 0.01);
  }
  setHover(on: boolean): void {
    this.hovered = on;
  }
  click(btn: number, cs: ControlState): boolean {
    if (btn !== 0) return false;
    const def = this.def;
    if (def.kind === 'latch') return cs.set(this.id, cs.get(this.id) ? 0 : 1);
    const ok = cs.press(this.id);
    if (ok) {
      this.pressedFor = 0.18;
      cs.values[this.id] = 1;
    }
    return ok;
  }
  release(cs: ControlState): void {
    if (this.def.kind === 'button') cs.values[this.id] = 0;
  }
  sync(cs: ControlState, s: Ship, dt: number): void {
    this.pressedFor -= dt;
    const down = this.def.kind === 'latch' ? cs.get(this.id) * 0.5 : this.pressedFor > 0 || cs.get(this.id) ? 1 : 0;
    this.press += (down - this.press) * Math.min(1, dt * 40);
    this.cap.position.z = 0.0045 - this.press * 0.003;
    const l = this.lit(s, cs);
    this.legendMat.emissiveIntensity = l * 1.6 + (this.hovered ? 0.25 : 0);
    this.legendMat.emissive.setHex(l > 0 ? 0xffffff : 0x335533);
  }
}

export class Rotary3D extends Control3D {
  private knob = new THREE.Group();
  private ang = 0;
  readonly span: number;
  constructor(id: string, small = false, span?: number) {
    super(id);
    const n = this.def.positions!.length;
    this.span = span ?? Math.min(Math.PI * 1.4, (n - 1) * 0.55);
    const k = new THREE.Mesh(small ? G.knobSmall : G.knob, this.own(MAT.knob));
    const p = new THREE.Mesh(G.pointer, this.own(MAT.white));
    if (small) p.scale.setScalar(0.75);
    this.knob.add(k, p);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(small ? 0.011 : 0.015, small ? 0.011 : 0.015, 0.002, 24).rotateX(Math.PI / 2), MAT.darkMetal);
    this.root.add(skirt, this.knob);
    this.addHit(small ? 0.024 : 0.032, small ? 0.024 : 0.032, 0.02, 0.01);
  }
  angleFor(i: number): number {
    const n = this.def.positions!.length;
    return n === 1 ? 0 : -this.span / 2 + (this.span * i) / (n - 1);
  }
  click(btn: number, cs: ControlState): boolean {
    return step(cs, this.id, btn === 2 ? -1 : 1);
  }
  wheel(d: number, cs: ControlState): boolean {
    return step(cs, this.id, d > 0 ? 1 : -1);
  }
  sync(cs: ControlState, _s: Ship, dt: number): void {
    const t = this.angleFor(cs.get(this.id));
    this.ang += (t - this.ang) * Math.min(1, dt * 25);
    this.knob.rotation.z = -this.ang;
  }
}

export class Knob3D extends Control3D {
  private knob = new THREE.Group();
  constructor(id: string) {
    super(id);
    const k = new THREE.Mesh(G.knobSmall, this.own(MAT.knob));
    const p = new THREE.Mesh(G.pointer, this.own(MAT.white));
    p.scale.setScalar(0.7);
    this.knob.add(k, p);
    this.root.add(this.knob);
    this.addHit(0.024, 0.024, 0.02, 0.01);
    this.drag = 'x';
  }
  wheel(d: number, cs: ControlState): boolean {
    return cs.set(this.id, cs.get(this.id) + Math.sign(d) * (this.def.step ?? 0.05));
  }
  dragBy(dx: number, _dy: number, cs: ControlState): void {
    cs.set(this.id, cs.get(this.id) + dx * 0.004);
  }
  click(btn: number, cs: ControlState): boolean {
    return this.wheel(btn === 2 ? -1 : 1, cs);
  }
  sync(cs: ControlState): void {
    this.knob.rotation.z = -(cs.get(this.id) - 0.5) * 2.6;
  }
}

/** Trim wheel: a vertical wheel on the console rolled with drag or mouse wheel. */
export class TrimWheel3D extends Control3D {
  private wheelMesh: THREE.Mesh;
  constructor(id: string) {
    super(id);
    const geo = new THREE.CylinderGeometry(0.04, 0.04, 0.018, 28);
    geo.rotateZ(Math.PI / 2);
    const mat = this.own(new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }));
    this.wheelMesh = new THREE.Mesh(geo, mat);
    this.wheelMesh.position.z = 0.012;
    for (let i = 0; i < 18; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.004, 0.006), MAT.white);
      const a = (i / 18) * Math.PI * 2;
      rib.position.set(0, Math.sin(a) * 0.04, Math.cos(a) * 0.04);
      rib.rotation.x = -a;
      this.wheelMesh.add(rib);
    }
    this.root.add(this.wheelMesh);
    this.addHit(0.03, 0.06, 0.06, 0.02);
    this.drag = 'y';
  }
  wheel(d: number, cs: ControlState): boolean {
    return cs.set(this.id, cs.get(this.id) + Math.sign(d) * 0.01);
  }
  dragBy(_dx: number, dy: number, cs: ControlState): void {
    cs.set(this.id, cs.get(this.id) - dy * 0.0015);
  }
  click(btn: number, cs: ControlState): boolean {
    return this.wheel(btn === 2 ? -1 : 1, cs);
  }
  label(cs: ControlState): string {
    const v = (cs.get(this.id) - 0.5) * 2;
    return `${this.def.label} — ${v > 0.01 ? 'NOSE UP ' : v < -0.01 ? 'NOSE DN ' : ''}${Math.abs(v * 100).toFixed(0)}%`;
  }
  sync(cs: ControlState): void {
    this.wheelMesh.rotation.x = (cs.get(this.id) - 0.5) * 12;
  }
}

/** Lever moving along a slot (throttle, speed brake). Drag toward panel top to increase. */
export class Lever3D extends Control3D {
  private arm = new THREE.Group();
  constructor(id: string, private travel = 0.12, handleColor = 0x1a1a1a, handleW = 0.034) {
    super(id);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.008, travel + 0.02, 0.002), MAT.black);
    slot.position.z = 0.001;
    this.root.add(slot);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.05), MAT.metal);
    shaft.position.z = 0.025;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(handleW, 0.022, 0.03), this.own(new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.45 })));
    handle.position.z = 0.058;
    this.arm.add(shaft, handle);
    this.root.add(this.arm);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(handleW + 0.01, 0.034, 0.08), MAT.hit);
    hb.position.z = 0.045;
    hb.userData.control = this;
    this.arm.add(hb);
    this.hit.push(hb);
    this.drag = 'y';
  }
  wheel(d: number, cs: ControlState): boolean {
    return cs.set(this.id, cs.get(this.id) + Math.sign(d) * (this.def.step ?? 0.04));
  }
  dragBy(_dx: number, dy: number, cs: ControlState): void {
    cs.set(this.id, cs.get(this.id) - dy * 0.003);
  }
  sync(cs: ControlState): void {
    const v = cs.get(this.id);
    this.arm.position.y = -this.travel / 2 + v * this.travel;
    this.arm.rotation.x = (v - 0.5) * 0.4;
  }
}

/** Pull handle: grab and drag toward you to pull; RMB or drag back to stow. */
export class Pull3D extends Control3D {
  private handle = new THREE.Group();
  private pos = 0;
  private acc = 0;
  constructor(id: string, legend: string, color = 0xa31a14, private distance = 0.045, wide = 0.07) {
    super(id);
    const mat = this.own(new THREE.MeshStandardMaterial({ color, roughness: 0.45 }));
    const grip = new THREE.Mesh(new THREE.BoxGeometry(wide, 0.016, 0.018), mat);
    grip.position.z = 0.02;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.02, 8).rotateX(Math.PI / 2), MAT.metal);
    stem.position.z = 0.01;
    const [c, g] = canvas(256, 48);
    g.fillStyle = '#' + color.toString(16).padStart(6, '0');
    g.fillRect(0, 0, 256, 48);
    g.font = `bold 30px ${FONT}`;
    g.fillStyle = color === 0xd6ad1c ? '#111' : '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(legend, 128, 25);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(wide * 0.92, 0.014), new THREE.MeshBasicMaterial({ map: canvasTexture(c) }));
    face.position.z = 0.0295;
    this.handle.add(grip, stem, face);
    this.root.add(this.handle);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(wide + 0.01, 0.03, 0.04), MAT.hit);
    hb.position.z = 0.02;
    hb.userData.control = this;
    this.handle.add(hb);
    this.hit.push(hb);
    this.drag = 'y';
  }
  click(btn: number, cs: ControlState): boolean {
    this.acc = 0;
    if (btn === 2) return cs.set(this.id, 0);
    return false; // must be pulled deliberately (drag)
  }
  dragBy(_dx: number, dy: number, cs: ControlState): void {
    this.acc += dy;
    if (this.acc > 55 && cs.get(this.id) === 0) {
      cs.set(this.id, 1);
      this.acc = 0;
    } else if (this.acc < -55 && cs.get(this.id) === 1) {
      cs.set(this.id, 0);
      this.acc = 0;
    }
  }
  label(cs: ControlState): string {
    return `${this.def.label} — ${cs.get(this.id) ? 'PULLED' : 'STOWED'} (drag to ${cs.get(this.id) ? 'stow' : 'pull'})`;
  }
  sync(cs: ControlState, _s: Ship, dt: number): void {
    const t = cs.get(this.id) ? 1 : 0;
    this.pos += (t - this.pos) * Math.min(1, dt * 18);
    this.handle.position.z = this.pos * this.distance;
  }
}

export class Breaker3D extends Control3D {
  private body = new THREE.Group();
  private pos = 0;
  constructor(id: string) {
    super(id);
    const cap = new THREE.Mesh(G.breaker, this.own(MAT.black));
    cap.position.z = 0.006;
    const collar = new THREE.Mesh(G.breakerCollar, MAT.white);
    collar.position.z = 0.001;
    this.body.add(cap, collar);
    this.root.add(this.body);
    this.addHit(0.016, 0.018, 0.02, 0.01);
  }
  click(btn: number, cs: ControlState): boolean {
    return cs.set(this.id, btn === 2 ? 1 : cs.get(this.id) ? 0 : 1);
  }
  label(cs: ControlState): string {
    return `CB ${this.def.label} — ${cs.get(this.id) ? 'IN' : 'PULLED'}`;
  }
  sync(cs: ControlState, _s: Ship, dt: number): void {
    const t = cs.get(this.id) ? 0 : 1;
    this.pos += (t - this.pos) * Math.min(1, dt * 25);
    this.body.position.z = this.pos * 0.007;
  }
}

/** Centre stick. Grabbed via InteractionManager; mouse deflects it. */
export class Stick3D extends Control3D {
  private pivot = new THREE.Group();
  constructor() {
    super('stick');
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.05, 16), MAT.black);
    boot.position.y = 0.025;
    this.root.add(boot);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.24, 10), MAT.darkMetal);
    shaft.position.y = 0.12;
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.07, 4, 12), this.own(new THREE.MeshStandardMaterial({ color: 0x1d1d1b, roughness: 0.8 })));
    grip.position.set(0, 0.27, 0.006);
    grip.rotation.x = 0.15;
    const trig = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.02, 0.01), MAT.red);
    trig.position.set(0, 0.265, -0.022);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.008, 8), MAT.metal);
    hat.position.set(0, 0.315, 0.004);
    this.pivot.add(shaft, grip, trig, hat);
    this.root.add(this.pivot);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.07), MAT.hit);
    hb.position.set(0, 0.25, 0);
    hb.userData.control = this;
    this.pivot.add(hb);
    this.hit.push(hb);
  }
  label(cs: ControlState): string {
    return `CONTROL STICK — P ${(cs.stickPitch * 100).toFixed(0)} R ${(cs.stickRoll * 100).toFixed(0)}`;
  }
  sync(cs: ControlState): void {
    this.pivot.rotation.x = -cs.stickPitch * 0.32;
    this.pivot.rotation.z = -cs.stickRoll * 0.32;
  }
}
