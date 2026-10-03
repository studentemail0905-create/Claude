import * as THREE from 'three';
import { canvas, canvasTexture, FONT, hazardStripes } from '../render/textures';

export interface ShipModelParts {
  root: THREE.Group;
  core: THREE.Group;
  module: THREE.Group;
  pods: THREE.Object3D[];
  gear: THREE.Group[];
  nozzleGlow: THREE.Mesh[];
  plume: THREE.Mesh[];
}

function hullTexture(text: string): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = '#c9c8c2';
  g.fillRect(0, 0, 1024, 256);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 1024, Math.random() * 256, 20 + Math.random() * 80, 2 + Math.random() * 10);
  }
  // panel lines
  g.strokeStyle = 'rgba(40,40,40,0.35)';
  g.lineWidth = 2;
  for (let x = 0; x < 1024; x += 96) g.strokeRect(x, 0, 96, 256);
  g.fillStyle = '#1f3a5c';
  g.fillRect(0, 150, 1024, 22);
  g.fillStyle = '#8a1d1d';
  g.fillRect(0, 176, 1024, 6);
  g.font = `bold 54px ${FONT}`;
  g.fillStyle = '#1f2a36';
  g.textAlign = 'left';
  g.fillText(text, 60, 110);
  g.font = `bold 22px ${FONT}`;
  g.fillText('PLANETARY CIVIL FLIGHT AUTHORITY  ·  GOVERNMENT PROPERTY', 60, 220);
  return canvasTexture(c, true, true);
}

/** Procedural civil atmospheric-to-orbit passenger shuttle, body frame (eye origin, -Z forward). */
export function buildShipModel(registration = 'CF-17  PCFA'): ShipModelParts {
  const root = new THREE.Group();
  const core = new THREE.Group();
  const module = new THREE.Group();
  root.add(core, module);

  const paint = new THREE.MeshStandardMaterial({ color: 0xd2d1cb, roughness: 0.55, metalness: 0.2 });
  const hullTex = new THREE.MeshStandardMaterial({ map: hullTexture(registration), roughness: 0.6, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.4 });
  const tps = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b1620, roughness: 0.1, metalness: 0.9 });

  // core fuselage (lathe around Z)
  const prof: [number, number][] = [[0, -5.8], [0.5, -4.7], [0.9, -3.4], [1.12, -2.2], [1.3, -1.1], [1.62, 0.2], [1.75, 2], [1.75, 15], [1.45, 18.2], [1.2, 18.6]];
  const lathe = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 28);
  lathe.rotateX(Math.PI / 2);
  // LatheGeometry revolves around Y; after rotateX the axis is Z (points mapped y→z)
  const fus = new THREE.Mesh(lathe, hullTex);
  fus.position.y = -1.35;
  fus.castShadow = true;
  core.add(fus);
  // canopy glass hump (outer) — dark tinted, seen from outside only
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  canopy.scale.set(0.95, 0.62, 1.7);
  canopy.position.set(0, -0.1, -0.6);
  core.add(canopy);
  // canards
  const canardShape = new THREE.Shape();
  canardShape.moveTo(0, 0);
  canardShape.lineTo(3.2, 1.6);
  canardShape.lineTo(3.2, 2.6);
  canardShape.lineTo(0, 3.6);
  const canardGeo = new THREE.ExtrudeGeometry(canardShape, { depth: 0.18, bevelEnabled: false });
  canardGeo.rotateX(Math.PI / 2);
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(canardGeo, paint);
    m.scale.x = s;
    m.position.set(s * 1.4, -1.5, 0.5);
    m.castShadow = true;
    core.add(m);
  }
  // twin fins
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(4.5, 0);
  finShape.lineTo(4.8, 3.4);
  finShape.lineTo(3.2, 3.4);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.2, bevelEnabled: false });
  finGeo.rotateY(-Math.PI / 2);
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(finGeo, paint);
    f.position.set(s * 0.9, -0.2, 13.5);
    f.rotation.z = -s * 0.35;
    f.castShadow = true;
    core.add(f);
  }
  // engines
  const nozzleGlow: THREE.Mesh[] = [];
  const plume: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.0, 1.8, 18, 1, true), dark);
    noz.rotation.x = Math.PI / 2;
    noz.position.set(s * 1.5, -2.0, 19.3);
    core.add(noz);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff9a50, toneMapped: false, transparent: true, opacity: 0 });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.72, 18), glowMat);
    glow.position.set(s * 1.5, -2.0, 19.0);
    core.add(glow);
    nozzleGlow.push(glow);
    const plMat = new THREE.MeshBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const pl = new THREE.Mesh(new THREE.ConeGeometry(0.85, 9, 16, 1, true), plMat);
    pl.rotation.x = -Math.PI / 2;
    pl.position.set(s * 1.5, -2.0, 24.6);
    core.add(pl);
    plume.push(pl);
  }

  // passenger / service module (belly)
  const modShape = new THREE.Shape();
  const W = 2.6, H = 1.8, rr = 0.9;
  modShape.moveTo(-W + rr, -H);
  modShape.lineTo(W - rr, -H);
  modShape.quadraticCurveTo(W, -H, W, -H + rr);
  modShape.lineTo(W, H - rr);
  modShape.quadraticCurveTo(W, H, W - rr, H);
  modShape.lineTo(-W + rr, H);
  modShape.quadraticCurveTo(-W, H, -W, H - rr);
  modShape.lineTo(-W, -H + rr);
  modShape.quadraticCurveTo(-W, -H, -W + rr, -H);
  const modGeo = new THREE.ExtrudeGeometry(modShape, { depth: 20, bevelEnabled: true, bevelSize: 0.4, bevelThickness: 1.2, bevelSegments: 4 });
  const modMesh = new THREE.Mesh(modGeo, hullTex);
  modMesh.position.set(0, -3.7, 1.5);
  modMesh.castShadow = true;
  module.add(modMesh);
  const belly = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.3, 20), tps);
  belly.position.set(0, -5.55, 11.5);
  module.add(belly);
  // big delta wing
  const wing = new THREE.Shape();
  wing.moveTo(0, 0);
  wing.lineTo(12, 13.5);
  wing.lineTo(12, 16);
  wing.lineTo(0, 17);
  const wingGeo = new THREE.ExtrudeGeometry(wing, { depth: 0.45, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 1 });
  wingGeo.rotateX(Math.PI / 2);
  for (const s of [-1, 1]) {
    const wm = new THREE.Mesh(wingGeo, paint);
    wm.scale.x = s;
    wm.position.set(s * 2.0, -4.3, 4.5);
    wm.castShadow = true;
    module.add(wm);
    // elevon strip
    const el = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 1.2), dark);
    el.position.set(s * 7.5, -4.5, 21.3);
    module.add(el);
  }
  // separation stripe at the interface
  const [sc, sg] = canvas(256, 32);
  hazardStripes(sg, 0, 0, 256, 32, 10);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.25, 20.5), new THREE.MeshStandardMaterial({ map: canvasTexture(sc, true, true) }));
  stripe.position.set(0, -1.85, 11.5);
  module.add(stripe);

  // evacuation capsules in their bays
  const pods: THREE.Object3D[] = [];
  const podGeo = new THREE.CapsuleGeometry(0.9, 2.2, 6, 14);
  podGeo.rotateX(Math.PI / 2);
  const podMat = new THREE.MeshStandardMaterial({ color: 0xd8742a, roughness: 0.5 });
  for (const [x, z] of [[-3.3, 6.5], [3.3, 6.5], [-3.3, 12.5], [3.3, 12.5]]) {
    const p = new THREE.Mesh(podGeo, podMat);
    p.position.set(x, -3.3, z);
    p.castShadow = true;
    module.add(p);
    pods.push(p);
  }

  // landing gear
  const gear: THREE.Group[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.45, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const tyre = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  for (const [x, y, z, len] of [[0, -2.6, -0.5, 3.4], [-4.2, -5.4, 11.4, 1.0], [4.2, -5.4, 11.4, 1.0]]) {
    const gg = new THREE.Group();
    gg.position.set(x, y, z);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, len, 8), dark);
    strut.position.y = -len / 2;
    gg.add(strut);
    const w = new THREE.Mesh(wheelGeo, tyre);
    w.position.y = -len - 0.25;
    gg.add(w);
    (x === 0 ? core : module).add(gg);
    gear.push(gg);
  }
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = true;
  });
  return { root, core, module, pods, gear, nozzleGlow, plume };
}

/** Animate gear struts (0 up .. 1 down). */
export function setGear(parts: ShipModelParts, pos: number): void {
  for (const g of parts.gear) {
    g.visible = pos > 0.02;
    g.scale.y = Math.max(0.05, pos);
  }
}
