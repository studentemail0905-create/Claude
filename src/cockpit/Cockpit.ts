import * as THREE from 'three';
import { Panel } from './Panel';
import { Toggle3D, Guard3D, Button3D, Rotary3D, Knob3D, Lever3D, Pull3D, Breaker3D, Stick3D, TrimWheel3D, MAT, type Control3D } from './controls/Controls3D';
import { drawPFD, drawND, drawEICAS, drawSYS, drawCOMM, drawJUMP, drawJAM, drawClock, drawFuelMini, drawOverheadMini, drawAnnunciator, ANNUNCIATORS, PALETTES, type Palette, Display } from './Displays';
import { HUD } from './HUD';
import { canvas, canvasTexture, FONT, MONO, PAINTS, wornMetal } from '../render/textures';
import type { Run } from '../core/Run';
import type { Ship } from '../ship/Ship';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const FWD = V(0, 0, -1);

const on = (s: Ship, id: string) => s.controls.get(id) === 1;
const LIT_GREEN = 0x3cff6a, LIT_AMBER = 0xffaa22, LIT_RED = 0xff3020, LIT_WHITE = 0xfff2d8, LIT_BLUE = 0x6fd0ff;

/**
 * The cockpit: a single interconnected machine. Every control below is bound to a
 * ControlState id that the simulation reads; every lamp reads real system state.
 */
export class Cockpit {
  root = new THREE.Group();
  panels: Panel[] = [];
  controls: Control3D[] = [];
  hitMeshes: THREE.Mesh[] = [];
  hud = new HUD();
  stick: Stick3D;
  annunciator: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D; w: number; h: number; acc: number; mat: THREE.MeshBasicMaterial };
  kneeboard: { tex: THREE.CanvasTexture; c: HTMLCanvasElement; g: CanvasRenderingContext2D };
  domeLight: THREE.PointLight;
  floodLight: THREE.PointLight;
  warnLight: THREE.PointLight;
  palette: Palette = PALETTES.green;
  masterCaution = false;
  masterWarning = false;
  private seenCaution = new Set<string>();
  private seenWarning = new Set<string>();
  private obstruction: THREE.Mesh;
  private shellMats: THREE.MeshStandardMaterial[] = [];
  private lastAck = { c: -1 as number, w: -1 as number };

  constructor(paintId = 'paint_standard') {
    const paint = PAINTS[paintId] ?? PAINTS.paint_standard;
    this.buildShell(paint);
    this.stick = new Stick3D();
    this.stick.root.position.set(0, -0.98, -0.36);
    this.root.add(this.stick.root);
    this.controls.push(this.stick);

    this.buildMain(paint);
    this.buildGlare(paint);
    this.buildLeftWing(paint);
    this.buildEvac(paint);
    this.buildEngines(paint);
    this.buildFuel(paint);
    this.buildComms(paint);
    this.buildNav(paint);
    this.buildOverhead(paint);
    this.buildSep(paint);
    this.buildJump();
    this.buildJammer();
    this.buildBreakers(paint);
    this.buildDecals();
    // annunciator strip (real lamps rendered as one texture)
    const [ac, ag] = canvas(1240, 120);
    const at = new THREE.CanvasTexture(ac);
    at.colorSpace = THREE.SRGBColorSpace;
    const amat = new THREE.MeshBasicMaterial({ map: at, toneMapped: false });
    const am = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.06), amat);
    const main = this.panels[0];
    am.position.copy(main.p(0.65, 0.045, 0.003));
    main.group.add(am);
    this.annunciator = { tex: at, g: ag, w: 1240, h: 120, acc: 0, mat: amat };

    // kneeboard (paper): callsign, squawk, authentication table — regenerated each run
    const [kc, kg] = canvas(512, 720);
    const kt = canvasTexture(kc);
    this.kneeboard = { tex: kt, c: kc, g: kg };
    const kb = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.24), new THREE.MeshStandardMaterial({ map: kt, roughness: 0.95 }));
    const kbGroup = new THREE.Group();
    kbGroup.add(kb);
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 0.008), MAT.metal);
    clip.position.set(0, 0.115, 0.004);
    kbGroup.add(clip);
    this.placeGroup(kbGroup, V(-0.655, -0.33, -0.08), V(1, 0.25, 0.25), UP);
    this.root.add(kbGroup);

    // HUD combiner glass + frame
    this.root.add(this.hud.mesh);
    const comb = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.22), new THREE.MeshStandardMaterial({ color: 0x88aa99, transparent: true, opacity: 0.06, roughness: 0.05, metalness: 0.2, depthWrite: false }));
    comb.position.set(0, 0, -0.621);
    this.root.add(comb);
    for (const x of [-0.145, 0.145]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.13, 0.01), MAT.darkMetal);
      post.position.set(x, -0.075, -0.64);
      this.root.add(post);
    }

    // lights
    this.domeLight = new THREE.PointLight(0xffd9a8, 0.0, 2.2, 1.6);
    this.domeLight.position.set(0, 0.33, 0.05);
    this.floodLight = new THREE.PointLight(0xffe2b8, 0.0, 1.6, 1.4);
    this.floodLight.position.set(0, -0.05, -0.35);
    this.warnLight = new THREE.PointLight(0xff2010, 0.0, 1.4, 1.5);
    this.warnLight.position.set(0, -0.1, -0.55);
    this.root.add(this.domeLight, this.floodLight, this.warnLight);

    // loose panel for mechanical obstruction events
    this.obstruction = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.004), new THREE.MeshStandardMaterial({ color: 0x5a5d60, metalness: 0.6, roughness: 0.5 }));
    this.obstruction.visible = false;
    this.root.add(this.obstruction);

    for (const c of this.controls) for (const h of c.hit) this.hitMeshes.push(h);
  }

  private placeGroup(g: THREE.Object3D, center: THREE.Vector3, normal: THREE.Vector3, up: THREE.Vector3): void {
    const z = normal.clone().normalize();
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    g.position.copy(center);
  }

  private panel(p: Panel, center: THREE.Vector3, normal: THREE.Vector3, up: THREE.Vector3): Panel {
    p.finish();
    p.place(center, normal, up);
    this.root.add(p.group);
    this.panels.push(p);
    for (const c of p.controls) this.controls.push(c);
    return p;
  }

  private guarded(p: Panel, ctrl: Control3D, u: number, v: number, label: string, gw = 0.03, gh = 0.046, opts: any = {}): void {
    p.add(ctrl, u, v, label, opts);
    const gd = new Guard3D(ctrl.def.guard!, gw, gh);
    gd.root.position.copy(p.p(u, v, 0.001));
    p.group.add(gd.root);
    p.controls.push(gd);
  }

  // ───────────────────────────────────────────── shell
  private buildShell(paint: string): void {
    const shellTex = canvasTexture(wornMetal(512, 512, '#2c2e30', 1.5), true, true);
    shellTex.repeat.set(2, 2);
    const shell = new THREE.MeshStandardMaterial({ map: shellTex, roughness: 0.8, metalness: 0.2 });
    const panelMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(paint).multiplyScalar(0.8), roughness: 0.75, metalness: 0.25 });
    this.shellMats.push(shell, panelMat);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat = shell, rx = 0, ry = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, 0);
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
      return m;
    };
    box(1.6, 0.04, 1.8, 0, -1.2, -0.15);
    box(0.28, 0.5, 0.9, -0.5, -0.91, -0.12, panelMat);
    box(0.28, 0.5, 0.9, 0.5, -0.91, -0.12, panelMat);
    box(1.4, 0.55, 0.22, 0, -0.42, -0.97, panelMat);
    box(0.9, 0.42, 0.3, 0, -0.98, -0.8, panelMat);
    box(0.04, 1.1, 1.5, -0.74, -0.63, -0.15);
    box(0.04, 1.1, 1.5, 0.74, -0.63, -0.15);
    box(1.5, 1.6, 0.04, 0, -0.4, 0.58);
    box(1.25, 0.04, 1.1, 0, 0.5, -0.02);
    // glareshield hood
    box(1.36, 0.05, 0.27, 0, -0.105, -0.85, new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.95 }));
    // seat
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x3b2f26, roughness: 0.95 });
    box(0.55, 0.8, 0.1, 0, -0.42, 0.42, seatMat, -0.12);
    box(0.32, 0.22, 0.1, 0, 0.1, 0.36, seatMat, -0.05);
    box(0.52, 0.1, 0.5, 0, -0.84, 0.12, seatMat);
    // harness straps
    const strap = new THREE.MeshStandardMaterial({ color: 0x8a6b1e, roughness: 0.9 });
    box(0.05, 0.6, 0.01, -0.12, -0.3, 0.36, strap, -0.12);
    box(0.05, 0.6, 0.01, 0.12, -0.3, 0.36, strap, -0.12);

    // canopy frame
    const B = [V(-0.72, -0.1, -0.78), V(-0.4, -0.085, -0.96), V(0, -0.08, -1.0), V(0.4, -0.085, -0.96), V(0.72, -0.1, -0.78)];
    const T = [V(-0.56, 0.44, -0.42), V(-0.3, 0.48, -0.58), V(0, 0.5, -0.62), V(0.3, 0.48, -0.58), V(0.56, 0.44, -0.42)];
    const SB = [V(-0.72, -0.1, 0.3), V(0.72, -0.1, 0.3)];
    const ST = [V(-0.58, 0.44, 0.3), V(0.58, 0.44, 0.3)];
    const frame = new THREE.MeshStandardMaterial({ color: 0x232527, roughness: 0.6, metalness: 0.4 });
    const beam = (a: THREE.Vector3, b: THREE.Vector3, t = 0.045) => {
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.BoxGeometry(t, t, len), frame);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.lookAt(b.clone().add(this.root.position));
      m.castShadow = true;
      this.root.add(m);
    };
    for (let i = 0; i < 5; i++) beam(B[i], T[i], i === 2 ? 0.035 : 0.05);
    for (let i = 0; i < 4; i++) {
      beam(B[i], B[i + 1], 0.04);
      beam(T[i], T[i + 1], 0.05);
    }
    beam(B[0], SB[0], 0.05);
    beam(B[4], SB[1], 0.05);
    beam(T[0], ST[0], 0.05);
    beam(T[4], ST[1], 0.05);
    beam(SB[0], ST[0], 0.06);
    beam(SB[1], ST[1], 0.06);
    // glass panes (very faint, with grime)
    const [gc, gg] = canvas(256, 256);
    gg.fillStyle = 'rgba(255,255,255,0.0)';
    gg.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 120; i++) {
      gg.fillStyle = `rgba(200,200,190,${Math.random() * 0.25})`;
      gg.beginPath();
      gg.arc(Math.random() * 256, Math.random() * 256, Math.random() * 3, 0, Math.PI * 2);
      gg.fill();
    }
    const grd = gg.createLinearGradient(0, 200, 0, 256);
    grd.addColorStop(0, 'rgba(180,170,150,0)');
    grd.addColorStop(1, 'rgba(180,170,150,0.35)');
    gg.fillStyle = grd;
    gg.fillRect(0, 0, 256, 256);
    const grime = canvasTexture(gc);
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfd4e0, map: grime, transparent: true, opacity: 0.12, roughness: 0.04, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    const pane = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray()], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, glass);
      m.renderOrder = 8;
      this.root.add(m);
    };
    for (let i = 0; i < 4; i++) pane(B[i], B[i + 1], T[i + 1], T[i]);
    pane(SB[0], B[0], T[0], ST[0]);
    pane(B[4], SB[1], ST[1], T[4]);
  }

  // ───────────────────────────────────────────── panels
  private buildMain(paint: string): void {
    const p = new Panel('MAIN', 1.3, 0.4, paint, { ppm: 1500 });
    p.display(0.17, 0.235, 0.27, 0.27, 512, 512, drawPFD, 20);
    p.display(0.48, 0.235, 0.27, 0.27, 512, 512, drawND, 10);
    p.display(0.82, 0.235, 0.27, 0.27, 512, 512, drawEICAS, 10);
    p.display(1.13, 0.235, 0.27, 0.27, 512, 512, drawSYS, 6);
    p.display(0.16, 0.045, 0.15, 0.04, 300, 80, drawClock, 10, 'EMER');
    p.text(0.17, 0.385, 'PRIMARY FLIGHT', 0.008);
    p.text(0.48, 0.385, 'NAVIGATION', 0.008);
    p.text(0.82, 0.385, 'PROPULSION', 0.008);
    p.text(1.13, 0.385, 'SYSTEMS', 0.008);
    p.placard(1.13, 0.018, 0.25, ['PLANETARY CIVIL FLIGHT AUTHORITY', 'CERTIFIED BY 14 DEPARTMENTS · TYPE C-17'], 0.0055, '#d9d3c0', '#1c2a44');
    this.panel(p, V(0, -0.37, -0.82), V(0, 0.26, 1), UP);
  }

  private buildGlare(paint: string): void {
    const p = new Panel('GLARE', 1.02, 0.1, paint, { ppm: 1900 });
    const L = 0.0058;
    p.add(new Button3D('masterCaution', ['MASTER', 'CAUTION'], () => (this.masterCaution ? 1 : 0), '#ffb030', 0.034, 0.026), 0.05, 0.055);
    p.add(new Toggle3D('fd'), 0.15, 0.06, 'FLT DIR', { labelSize: L, labelOffset: 0.036 });
    p.add(new Rotary3D('navSource', true), 0.26, 0.062, 'NAV SOURCE', { labelSize: L, labelOffset: 0.04 });
    p.add(new Toggle3D('routeMkr'), 0.37, 0.06, 'ROUTE MKR', { labelSize: L, labelOffset: 0.036 });
    p.add(new Button3D('apMaster', ['AP'], (s) => (s.fcs.apEngaged ? 1 : 0), '#7dff9a', 0.032, 0.024), 0.47, 0.055, 'AUTOPILOT', { labelSize: L, labelOffset: 0.032 });
    p.add(new Rotary3D('fcsMode', true), 0.58, 0.062, 'FCS MODE', { labelSize: L, labelOffset: 0.04 });
    p.add(new Toggle3D('sas'), 0.68, 0.06, 'STAB AUG', { labelSize: L, labelOffset: 0.036 });
    p.add(new Toggle3D('tvc'), 0.77, 0.06, 'THRUST VEC', { labelSize: L, labelOffset: 0.036 });
    p.add(new Knob3D('hudBright'), 0.86, 0.06, 'HUD BRT', { labelSize: L, labelOffset: 0.036 });
    p.add(new Button3D('masterWarn', ['MASTER', 'WARNING'], () => (this.masterWarning ? 1 : 0), '#ff4030', 0.034, 0.026), 0.965, 0.055);
    this.panel(p, V(0, -0.118, -0.705), V(0, 0.45, 1), UP);
  }

  private buildLeftWing(paint: string): void {
    const p = new Panel('LWING', 0.3, 0.4, paint, { title: 'GEAR · COOLING · FIRE' });
    p.add(new Toggle3D('gear', true), 0.06, 0.1, 'LANDING\nGEAR', { posLabels: true, labelOffset: 0.04 });
    const gearLamp = (key: string) => (r: Run) => {
      const s = r.ship;
      if (!s.sep.moduleAttached || s.elec.volts.EMER < 18) return null;
      if (s.damage.health[key] <= 0.05) return LIT_RED;
      return s.gear.pos > 0.98 ? LIT_GREEN : s.gear.pos > 0.02 ? LIT_RED : null;
    };
    p.lamp(0.13, 0.075, 0.006, gearLamp('gearNose'), 'N');
    p.lamp(0.165, 0.075, 0.006, gearLamp('gearLeft'), 'L');
    p.lamp(0.2, 0.075, 0.006, gearLamp('gearRight'), 'R');
    p.lamp(0.165, 0.115, 0.005, (r) => (r.ship.gear.wow && r.ship.elec.volts.EMER > 18 ? LIT_WHITE : null), 'WOW');
    p.add(new Toggle3D('parkBrake'), 0.25, 0.1, 'PARK BRK');
    p.add(new Toggle3D('coolA'), 0.06, 0.215, 'COOL A');
    p.add(new Toggle3D('coolB'), 0.13, 0.215, 'COOL B');
    p.add(new Rotary3D('coolPrio'), 0.225, 0.22, 'COOL PRIO', { labelOffset: 0.038 });
    p.add(new Pull3D('fireA', 'FIRE A', 0xa31a14, 0.04, 0.075), 0.08, 0.33);
    p.add(new Pull3D('fireB', 'FIRE B', 0xa31a14, 0.04, 0.075), 0.22, 0.33);
    p.lamp(0.08, 0.295, 0.006, (r) => (r.ship.engines.A.fire > 0 ? LIT_RED : null));
    p.lamp(0.22, 0.295, 0.006, (r) => (r.ship.engines.B.fire > 0 ? LIT_RED : null));
    p.text(0.15, 0.375, 'PULL — FUEL CUT + BOTTLE DISCHARGE', 0.0048, '#e0b0a0');
    this.panel(p, V(-0.83, -0.4, -0.63), V(0.75, 0.22, 0.65), UP);
  }

  private buildEvac(paint: string): void {
    const p = new Panel('EVAC', 0.3, 0.4, paint, { title: 'PASSENGER EVACUATION' });
    p.add(new Button3D('restraint', ['RSTR', 'CMD'], (s) => (on(s, 'restraint') && s.elec.volts.EMER > 18 ? 1 : 0), '#ffd27a'), 0.06, 0.085, 'RESTRAINT', { labelOffset: 0.024 });
    p.add(new Toggle3D('podPower'), 0.15, 0.085, 'POD PWR');
    p.add(new Toggle3D('podGuidance'), 0.235, 0.085, 'POD GUID');
    p.add(new Rotary3D('returnProg'), 0.075, 0.2, 'RETURN PROG', { labelOffset: 0.04 });
    for (let i = 0; i < 4; i++) {
      p.lamp(0.15 + i * 0.033, 0.175, 0.0055, (r) => {
        const s = r.ship;
        if (s.elec.volts.CAB < 18 && s.sep.moduleAttached) return null;
        const pd = s.pax.pods[i];
        if (!pd.attached) return pd.outcome === 'lost' ? LIT_RED : LIT_BLUE;
        return pd.occupants >= 10 ? (pd.charge >= 0.5 ? LIT_GREEN : LIT_AMBER) : pd.occupants > 0 ? LIT_AMBER : null;
      }, `P${i + 1}`);
    }
    p.lamp(0.2, 0.225, 0.006, (r) => (r.ship.elec.volts.EMER > 18 && r.ship.pax.occupancyClear ? LIT_GREEN : r.ship.elec.volts.EMER > 18 ? LIT_RED : null), 'CABIN CLEAR');
    this.guarded(p, new Toggle3D('evacArm'), 0.075, 0.32, 'EVAC ARM');
    this.guarded(p, new Button3D('podRelease', ['POD', 'REL'], (s) => (on(s, 'evacArm') && s.elec.volts.EMER > 18 ? 1 : 0), '#ff6a4a', 0.026, 0.02), 0.215, 0.32, 'POD RELEASE', 0.034, 0.034);
    p.placard(0.15, 0.36, 0.26, ['CAPSULE RELEASE IS IRREVERSIBLE'], 0.0052);
    this.panel(p, V(0.83, -0.4, -0.63), V(-0.75, 0.22, 0.65), UP);
  }

  private buildEngines(paint: string): void {
    const p = new Panel('ENG', 0.22, 0.44, paint, { title: 'PROPULSION' });
    p.add(new Lever3D('throttleA', 0.15, 0x1b1b1b, 0.03), 0.045, 0.17);
    p.add(new Lever3D('throttleB', 0.15, 0x1b1b1b, 0.03), 0.09, 0.17);
    p.text(0.045, 0.265, 'A', 0.008);
    p.text(0.09, 0.265, 'B', 0.008);
    p.text(0.0675, 0.03, 'MAX', 0.006);
    p.text(0.0675, 0.25, 'IDLE', 0.006);
    p.add(new Lever3D('speedBrake', 0.1, 0x6a6a64, 0.022), 0.17, 0.15);
    p.text(0.17, 0.085, 'SPD BRK', 0.0058);
    p.add(new Rotary3D('thrustLimit'), 0.06, 0.34, 'THRUST LIMIT', { labelOffset: 0.04 });
    p.add(new Toggle3D('engMaster'), 0.14, 0.34, 'ENG MASTER');
    p.add(new Button3D('ignA', ['START', 'A'], (s) => (s.engines.A.state === 'starting' ? 1 : s.engines.A.running ? 0.35 : 0), '#9cff9c', 0.022, 0.018), 0.19, 0.31);
    p.add(new Button3D('ignB', ['START', 'B'], (s) => (s.engines.B.state === 'starting' ? 1 : s.engines.B.running ? 0.35 : 0), '#9cff9c', 0.022, 0.018), 0.19, 0.37);
    this.panel(p, V(-0.47, -0.625, -0.33), V(0.35, 1, 0.12), FWD);
  }

  private buildFuel(paint: string): void {
    const p = new Panel('FUEL', 0.22, 0.34, paint, { title: 'FUEL' });
    p.display(0.11, 0.06, 0.18, 0.06, 320, 80, drawFuelMini, 6);
    p.add(new Toggle3D('fuelPumpA'), 0.045, 0.14, 'PUMP A');
    p.add(new Toggle3D('fuelPumpB'), 0.11, 0.14, 'PUMP B');
    p.add(new Toggle3D('crossfeed'), 0.175, 0.14, 'XFEED');
    p.add(new Toggle3D('isoA'), 0.045, 0.225, 'ISOL A');
    p.add(new Toggle3D('isoB'), 0.11, 0.225, 'ISOL B');
    p.add(new Toggle3D('fuelXfer'), 0.175, 0.225, 'XFER');
    this.guarded(p, new Toggle3D('svcFuel'), 0.06, 0.305, 'SVC LINE');
    p.placard(0.16, 0.285, 0.1, ['SERVICE MODULE', 'GOVERNMENT', 'PROPERTY'], 0.005);
    this.panel(p, V(-0.48, -0.605, 0.07), V(0.35, 1, 0), FWD);
  }

  private buildComms(paint: string): void {
    const p = new Panel('COMM', 0.22, 0.44, paint, { title: 'COMMUNICATION · TRANSPONDER' });
    p.display(0.11, 0.08, 0.19, 0.11, 380, 220, drawCOMM, 8, 'EMER');
    p.add(new Toggle3D('comms'), 0.04, 0.18, 'COMMS');
    p.add(new Toggle3D('tx'), 0.1, 0.18, 'TX');
    p.add(new Rotary3D('freq', true), 0.17, 0.185, 'FREQ', { labelOffset: 0.036 });
    p.add(new Knob3D('rxVol'), 0.04, 0.26, 'RX VOL');
    p.add(new Button3D('ptt', ['ACK', 'PTT'], (s) => (s.comms.canTransmit(s) && s.controls.get('ptt') ? 1 : 0), '#e9e2c8'), 0.11, 0.26);
    p.add(new Button3D('ident', ['IDENT'], (s) => (s.xpdr.identTimer > 0 ? 1 : 0), '#e9e2c8'), 0.18, 0.26);
    p.add(new Rotary3D('xpdrMode', false), 0.06, 0.345, 'XPDR', { labelOffset: 0.04 });
    this.guarded(p, new Toggle3D('datalink'), 0.175, 0.345, 'AUTH DLINK');
    p.add(new Rotary3D('authCode', true, Math.PI * 1.6), 0.06, 0.415, '', { labelOffset: 0.03 });
    p.text(0.11, 0.395, 'AUTH', 0.006);
    p.add(new Button3D('authTx', ['AUTH', 'TX'], () => 0, '#e9e2c8'), 0.175, 0.415);
    p.placard(0.11, 0.3, 0.2, ['TRANSPONDER DEACTIVATION REQUIRES FORM PFA-883'], 0.0047);
    this.panel(p, V(0.47, -0.625, -0.33), V(-0.35, 1, 0.12), FWD);
  }

  private buildNav(paint: string): void {
    const p = new Panel('NAV', 0.22, 0.34, paint, { title: 'NAV · RCS · TRIM' });
    p.add(new Toggle3D('navComp'), 0.04, 0.07, 'NAV COMP');
    p.add(new Button3D('escLoad', ['ESC', 'LOAD'], (s) => (s.avionics.escLoading > 0 ? (Math.floor(s.time * 4) % 2) : s.avionics.escLoaded ? 0.6 : 0), '#9fe6ff'), 0.11, 0.07);
    // cartridge slot (black-market cartridge already inserted)
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.012), MAT.black);
    slot.position.copy(p.p(0.175, 0.07, 0.006));
    const cart = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.008, 0.02), new THREE.MeshStandardMaterial({ color: 0x8a2a8a, roughness: 0.4 }));
    cart.position.copy(p.p(0.175, 0.07, 0.016));
    p.group.add(slot, cart);
    p.text(0.175, 0.05, 'CART', 0.005);
    p.add(new Button3D('jumpSolve', ['JUMP', 'SOLVE'], (s) => (s.avionics.solveTimer > 0 ? (Math.floor(s.time * 4) % 2) : s.avionics.solutionValid ? 0.6 : 0), '#9fe6ff'), 0.045, 0.155);
    p.add(new Toggle3D('rcsMaster'), 0.115, 0.155, 'RCS');
    p.add(new Rotary3D('rcsMode', true), 0.18, 0.16, 'RCS MODE', { labelOffset: 0.036 });
    p.add(new TrimWheel3D('pitchTrim'), 0.06, 0.26, 'PITCH TRIM', { below: true, labelOffset: 0.05 });
    p.add(new Knob3D('yawTrim'), 0.165, 0.26, 'YAW TRIM');
    this.panel(p, V(0.48, -0.605, 0.07), V(-0.35, 1, 0), FWD);
  }

  private buildOverhead(paint: string): void {
    const p = new Panel('OVHD', 0.84, 0.4, paint, { title: 'ELECTRICAL                                         HYDRAULIC · PRESSURISATION' });
    p.box(0.01, 0.025, 0.41, 0.36);
    p.box(0.43, 0.025, 0.4, 0.36);
    p.add(new Toggle3D('batt'), 0.05, 0.08, 'BATTERY');
    p.add(new Toggle3D('extpwr'), 0.11, 0.08, 'EXT PWR');
    p.lamp(0.11, 0.115, 0.004, (r) => (r.ship.elec.extConnected ? LIT_GREEN : null));
    p.add(new Rotary3D('apu', true), 0.19, 0.085, 'APU', { labelOffset: 0.036 });
    p.lamp(0.19, 0.12, 0.004, (r) => (r.ship.elec.apuState === 'running' ? LIT_GREEN : r.ship.elec.apuState === 'starting' ? LIT_AMBER : null));
    p.add(new Toggle3D('genA'), 0.27, 0.08, 'GEN A');
    p.lamp(0.27, 0.115, 0.004, (r) => (r.ship.elec.genOnline.A ? LIT_GREEN : r.ship.elec.volts.EMER > 18 ? LIT_AMBER : null));
    p.add(new Toggle3D('genB'), 0.34, 0.08, 'GEN B');
    p.lamp(0.34, 0.115, 0.004, (r) => (r.ship.elec.genOnline.B ? LIT_GREEN : r.ship.elec.volts.EMER > 18 ? LIT_AMBER : null));
    p.add(new Toggle3D('busTie'), 0.05, 0.2, 'BUS TIE');
    p.add(new Toggle3D('avionics'), 0.11, 0.2, 'AVIONICS');
    p.lamp(0.11, 0.235, 0.004, (r) => (r.ship.elec.tripped.AV ? LIT_RED : null));
    p.add(new Toggle3D('cabinBus'), 0.17, 0.2, 'CABIN BUS');
    p.lamp(0.17, 0.235, 0.004, (r) => (r.ship.elec.tripped.CAB ? LIT_RED : null));
    this.guarded(p, new Toggle3D('jumpBus'), 0.25, 0.2, 'JUMP BUS');
    p.lamp(0.25, 0.24, 0.004, (r) => (r.ship.elec.tripped.JUMP ? LIT_RED : r.ship.elec.volts.JUMP > 18 ? LIT_BLUE : null));
    p.display(0.345, 0.22, 0.1, 0.075, 200, 80, drawOverheadMini, 6, 'EMER');
    p.placard(0.2, 0.31, 0.32, ['INTERSTELLAR DRIVE BUS', 'AUTHORIZED OPERATORS ONLY'], 0.0055);
    p.add(new Toggle3D('hydA'), 0.48, 0.08, 'HYD PUMP A');
    p.add(new Toggle3D('hydB'), 0.56, 0.08, 'HYD PUMP B');
    p.add(new Rotary3D('pressMode', true), 0.66, 0.085, 'PRESS MODE', { labelOffset: 0.036 });
    p.add(new Toggle3D('o2'), 0.76, 0.08, 'PILOT O2');
    p.add(new Toggle3D('cockpitSeal'), 0.5, 0.21, 'COCKPIT SEAL');
    p.add(new Toggle3D('cabinIsol'), 0.6, 0.21, 'CABIN ISOL');
    p.lamp(0.7, 0.2, 0.005, (r) => (r.ship.press.cockpit < 57_000 && r.ship.elec.volts.EMER > 18 ? LIT_RED : null), 'CKPT ALT');
    p.lamp(0.77, 0.2, 0.005, (r) => (r.ship.controls.get('o2') && r.ship.elec.volts.EMER > 18 ? LIT_GREEN : null), 'O2 FLOW');
    p.placard(0.64, 0.3, 0.3, ['DO NOT OPEN COCKPIT SEAL', 'ABOVE CABIN ALTITUDE LIMITS'], 0.0052);
    this.panel(p, V(0, 0.405, -0.33), V(0, -1, 0.55), V(0, 0, 1));
  }

  private buildSep(paint: string): void {
    const p = new Panel('SEP', 0.4, 0.2, paint, { title: 'MODULE SEPARATION' });
    p.stripes(0.0, 0.0, 0.4, 0.008);
    p.stripes(0.0, 0.192, 0.4, 0.008);
    p.add(new Toggle3D('sepElec'), 0.05, 0.08, 'UMBILICAL');
    this.guarded(p, new Toggle3D('mechLock'), 0.13, 0.08, 'MECH LOCKS');
    this.guarded(p, new Toggle3D('sepArm'), 0.21, 0.08, 'SEP CHARGES');
    this.guarded(p, new Pull3D('sepHandle', 'SEPARATE', 0xd6ad1c, 0.05, 0.09), 0.325, 0.1, 'EMERGENCY\nSEPARATION', 0.11, 0.05, { labelOffset: 0.05 });
    p.lamp(0.05, 0.155, 0.005, (r) => (r.ship.elec.volts.EMER < 18 ? null : r.ship.controls.get('sepElec') ? LIT_GREEN : LIT_AMBER), 'UMB');
    p.lamp(0.1, 0.155, 0.005, (r) => (r.ship.elec.volts.EMER < 18 || !r.ship.sep.moduleAttached ? null : r.ship.sep.lockPos >= 0.99 ? LIT_GREEN : r.ship.sep.lockPos > 0.01 ? LIT_AMBER : LIT_RED), 'LOCKS');
    p.lamp(0.15, 0.155, 0.005, (r) => (r.ship.elec.volts.EMER < 18 ? null : r.ship.controls.get('sepArm') ? LIT_RED : null), 'PYRO');
    p.lamp(0.2, 0.155, 0.005, (r) => (r.ship.elec.volts.EMER < 18 ? null : r.ship.pax.occupancyClear ? LIT_GREEN : LIT_RED), 'CLEAR');
    p.lamp(0.25, 0.155, 0.005, (r) => (r.ship.elec.volts.EMER < 18 ? null : r.ship.controls.get('svcFuel') ? LIT_GREEN : LIT_AMBER), 'SVC FUEL');
    p.placard(0.325, 0.163, 0.13, ['DO NOT OPERATE', 'WHILE OCCUPIED'], 0.0052);
    this.panel(p, V(-0.25, -0.67, -0.69), V(0, 0.85, 0.55), UP);
  }

  private buildJump(): void {
    const p = new Panel('JUMP', 0.42, 0.21, '#1c1d1e', { aftermarket: true, title: 'INTERSTELLAR DRIVE — AUTHORIZED OPERATORS ONLY' });
    p.display(0.125, 0.11, 0.21, 0.15, 480, 340, drawJUMP, 10, 'JUMP');
    p.add(new Toggle3D('jumpCharge'), 0.28, 0.06, 'CAP CHG', { labelOffset: 0.024, labelSize: 0.0058 });
    this.guarded(p, new Toggle3D('coilArm'), 0.36, 0.06, 'COILS', 0.03, 0.046, { labelOffset: 0.03, labelSize: 0.0058 });
    p.add(new Button3D('jumpSync', ['SYNC'], (s) => (s.jump.synced ? 0.8 : s.jump.syncing ? Math.floor(s.time * 4) % 2 : 0), '#9fe6ff', 0.022, 0.016), 0.28, 0.125);
    p.add(new Button3D('capDump', ['CAP', 'DUMP'], (s) => (s.jump.dumping > 0 ? 1 : 0), '#ffb060', 0.022, 0.016), 0.36, 0.125);
    p.add(new Pull3D('safetyPin', 'SAFETY', 0xc0201a, 0.035, 0.05), 0.28, 0.18);
    this.guarded(p, new Button3D('jumpEngage', ['JUMP'], (s) => (s.jump.sequence >= 0 ? 1 : s.jump.coilsArmed && s.controls.get('safetyPin') ? 0.4 : 0), '#ff80ff', 0.03, 0.022), 0.365, 0.18, '', 0.04, 0.036);
    this.panel(p, V(0.25, -0.67, -0.69), V(0, 0.85, 0.55), UP);
    // the box is bolted on top of the regulation panel: exposed cable loom
    const loom = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 }));
    loom.position.set(0.47, -0.74, -0.66);
    loom.rotation.set(0.4, 0.8, 0.2);
    this.root.add(loom);
  }

  private buildJammer(): void {
    const p = new Panel('JAM', 0.34, 0.21, '#1c1d1e', { aftermarket: true, title: 'SIGNAL MASKING UNIT (NOT CERTIFIED)' });
    p.display(0.095, 0.11, 0.17, 0.15, 400, 352, drawJAM, 12, 'JAM');
    const L = 0.0055;
    p.add(new Toggle3D('jammerBus'), 0.215, 0.05, 'BUS', { labelSize: L, labelOffset: 0.022 });
    p.add(new Toggle3D('jamCool'), 0.27, 0.05, 'COOL', { labelSize: L, labelOffset: 0.022 });
    p.add(new Toggle3D('jamCharge'), 0.318, 0.05, 'CHG', { labelSize: L, labelOffset: 0.022 });
    p.add(new Rotary3D('jamProfile', true), 0.235, 0.112, '', {});
    p.add(new Button3D('decoy', ['DECOY'], (s) => (s.jammer.powered ? 0.3 : 0), '#ffcf7a', 0.022, 0.016), 0.315, 0.112);
    this.guarded(p, new Toggle3D('jamArm'), 0.215, 0.17, '', 0.026, 0.04);
    p.add(new Button3D('jamEngage', ['ENG'], (s) => (s.jammer.active ? 1 : on(s, 'jamEngage') ? 0.3 : 0), '#7fe6ff', 0.022, 0.018), 0.268, 0.17);
    this.guarded(p, new Button3D('jamOverdrive', ['OVR', 'DRV'], (s) => (on(s, 'jamOverdrive') ? 1 : 0), '#ff6a4a', 0.02, 0.016), 0.318, 0.17, '', 0.026, 0.03);
    p.text(0.215, 0.198, 'ARM', L);
    p.text(0.318, 0.198, 'OVERDRIVE', L);
    this.panel(p, V(0.66, -0.27, -0.2), V(-1, 0.22, 0.3), UP);
  }

  private buildBreakers(paint: string): void {
    const p = new Panel('CB', 0.25, 0.13, paint, { title: 'CIRCUIT BREAKERS' });
    const ids = ['cb_fcs', 'cb_nav', 'cb_disp', 'cb_xpdr', 'cb_comms', 'cb_dlink', 'cb_rcs', 'cb_pods', 'cb_jam', 'cb_jump', 'cb_fuelx', 'cb_press'];
    const names = ['FCS', 'NAV', 'DISP', 'XPDR', 'COMM', 'DLINK', 'RCS', 'POD', 'JAM', 'JUMP', 'F.XFR', 'PRESS'];
    ids.forEach((id, i) => {
      const u = 0.028 + (i % 6) * 0.038, v = 0.05 + Math.floor(i / 6) * 0.05;
      p.add(new Breaker3D(id), u, v);
      p.text(u, v + 0.016, names[i], 0.0048);
    });
    this.panel(p, V(0.69, -0.3, 0.2), V(-1, 0.18, -0.12), UP);
  }

  private buildDecals(): void {
    const decal = (text: string[], w: number, h: number, pos: THREE.Vector3, normal: THREE.Vector3, bg = '#e7e1cd', fg = '#7a1010') => {
      const [c, g] = canvas(512, Math.round((512 * h) / w));
      g.fillStyle = bg;
      g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = fg;
      g.lineWidth = 6;
      g.strokeRect(8, 8, c.width - 16, c.height - 16);
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      text.forEach((t, i) => {
        g.font = `bold ${i === 0 ? 38 : 28}px ${FONT}`;
        g.fillText(t, 256, c.height / 2 + (i - (text.length - 1) / 2) * 42);
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: canvasTexture(c), roughness: 0.8 }));
      const grp = new THREE.Group();
      grp.add(m);
      this.placeGroup(grp, pos, normal, UP);
      this.root.add(grp);
    };
    decal(['UNSCHEDULED ORBITAL DEPARTURE', 'IS A CRIMINAL OFFENCE'], 0.22, 0.06, V(-0.715, -0.12, -0.45), V(1, 0, 0.1));
    decal(['THIS VESSEL IS MONITORED', 'FOR YOUR COMPLIANCE'], 0.2, 0.055, V(0.715, -0.05, 0.05), V(-1, 0, 0));
    decal(['CABIN PRESSURE DOOR', 'KEEP CLEAR'], 0.18, 0.05, V(-0.25, -0.2, 0.555), V(0, 0, -1), '#d8b218', '#111');
    decal(['NO SMOKING · NO EMIGRATION'], 0.24, 0.04, V(0.25, -0.15, 0.555), V(0, 0, -1));
  }

  // ───────────────────────────────────────────── per-run setup
  setupRun(run: Run): void {
    const g = this.kneeboard.g;
    const c = this.kneeboard.c;
    g.fillStyle = '#ece6d4';
    g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(120,100,60,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * 512, Math.random() * 720, 60, 30);
    }
    g.fillStyle = '#2a2a2a';
    g.textAlign = 'left';
    g.font = `bold 26px ${FONT}`;
    g.fillText('FLIGHT CARD — PCFA FORM 12-B', 24, 50);
    g.font = `22px ${MONO}`;
    const fc = run.flightCommand;
    const lines = [`CALLSIGN  ${fc.callsign.toUpperCase()}`, `SQUAWK    ${fc.squawk}`, `ROUTE     OTL-3 RWY 09`, `CEILING   85 KM`, `ESC CART  ${run.escape.designation}`];
    lines.forEach((l, i) => g.fillText(l, 24, 100 + i * 32));
    g.font = `bold 24px ${FONT}`;
    g.fillText('AUTHENTICATION TABLE (TODAY)', 24, 290);
    g.font = `22px ${MONO}`;
    fc.authTable.forEach((a, i) => {
      g.fillText(`${a.word.padEnd(8)} ${a.digit}`, 24 + (i % 2) * 240, 330 + Math.floor(i / 2) * 32);
    });
    g.strokeStyle = '#1a3a7a';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(30, 560);
    g.bezierCurveTo(120, 520, 200, 620, 300, 560);
    g.stroke();
    g.fillStyle = '#1a3a7a';
    g.font = `italic 22px ${FONT}`;
    g.fillText('dont forget the pin. — M.', 30, 600);
    g.fillStyle = '#7a1010';
    g.font = `bold 18px ${FONT}`;
    g.fillText('CARRYING THIS CARD OUTSIDE THE LANE IS AN OFFENCE', 24, 690);
    this.kneeboard.tex.needsUpdate = true;
    this.seenCaution.clear();
    this.seenWarning.clear();
    this.masterCaution = this.masterWarning = false;
    this.lastAck = { c: -1, w: -1 };
  }

  setPalette(name: string): void {
    this.palette = PALETTES[name] ?? PALETTES.green;
  }

  // ───────────────────────────────────────────── per frame
  sync(run: Run, dt: number, t: number, nightFactor: number, reducedFlashing: boolean): void {
    const s = run.ship;
    const emer = s.elec.volts.EMER > 18;
    const busA = s.elec.volts.A > 18;
    const panelLit = (busA ? 0.12 + nightFactor * 0.6 : 0) * (s.jump.sequence >= 0 ? Math.random() : 1);
    for (const p of this.panels) {
      p.sync(run, dt, panelLit);
      for (const d of p.displays) {
        const powered = d.bus === 'AV' ? s.avionics.displaysOn : d.bus === 'EMER' ? emer : d.bus === 'JAM' ? s.jammer.powered : s.jump.controlPowered;
        d.update(dt, run, t, this.palette, powered, d.bus === 'AV' ? s.avionics.flicker : 0);
      }
    }
    this.stick.sync(s.controls);
    this.hud.update(dt, run, s.avionics.hudOn, s.controls.get('hudBright'));
    // annunciators & master caution/warning latching
    const a = this.annunciator;
    a.acc += dt;
    if (a.acc > 0.1) {
      a.acc = 0;
      drawAnnunciator(a.g, a.w, a.h, run, t, false, emer);
      a.tex.needsUpdate = true;
    }
    if (emer) {
      for (const [name, fn] of ANNUNCIATORS) {
        const sev = fn(run);
        if (sev === 2 && !this.seenWarning.has(name)) {
          this.seenWarning.add(name);
          this.masterWarning = true;
          s.bus.emit('sfx', { id: 'master_warning' });
        } else if (sev === 1 && !this.seenCaution.has(name)) {
          this.seenCaution.add(name);
          this.masterCaution = true;
          s.bus.emit('sfx', { id: 'master_caution' });
        }
        if (sev === 0) {
          this.seenWarning.delete(name);
          this.seenCaution.delete(name);
        }
      }
    }
    // acknowledge: the momentary press edge is consumed by the sim step, so read its timestamp
    const mc = s.controls.changedAt['masterCaution'];
    if (mc !== undefined && mc !== this.lastAck.c) { this.lastAck.c = mc; this.masterCaution = false; }
    const mw = s.controls.changedAt['masterWarn'];
    if (mw !== undefined && mw !== this.lastAck.w) { this.lastAck.w = mw; this.masterWarning = false; }
    // lighting
    this.domeLight.intensity = emer ? 0.25 + nightFactor * 0.5 : 0;
    this.floodLight.intensity = busA ? 0.15 + nightFactor * 0.45 : 0;
    const flash = this.masterWarning && (Math.floor(t * 2.5) % 2 === 0) && !reducedFlashing;
    this.warnLight.intensity = flash ? 0.45 : this.masterWarning && reducedFlashing ? 0.12 : 0;
    // obstruction visual
    const ob = s.flags.obstruction as string | null;
    this.obstruction.visible = !!ob;
    if (ob) {
      const ctrl = this.controls.find((c) => c.id === ob);
      if (ctrl) {
        ctrl.root.getWorldPosition(this.obstruction.position);
        this.root.worldToLocal(this.obstruction.position);
        this.obstruction.position.y += 0.01;
        this.obstruction.rotation.z = 0.3 + Math.sin(t * 20) * 0.02;
      }
    }
  }

  /** Displays exposed for debug. */
  allDisplays(): Display[] {
    return this.panels.flatMap((p) => p.displays);
  }
}
