import * as THREE from 'three';
import { PLANET } from '../physics/PlanetPhysics';
import { canvas, canvasTexture, label, prand, hazardStripes, FONT } from '../render/textures';

const R = PLANET.radius;
/** Curvature drop for a point at local horizontal distance. */
const drop = (x: number, z: number) => -(x * x + z * z) / (2 * R);

function curvedPlane(w: number, d: number, sx: number, sz: number, cx: number, cz: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d, sx, sz);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + cx, z = p.getZ(i) + cz;
    p.setY(i, p.getY(i) + drop(x, z));
  }
  g.translate(cx, 0, cz);
  // translate moved x/z but drop was computed with offsets already
  g.computeVertexNormals();
  return g;
}

function runwayTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(2048, 64);
  g.fillStyle = '#2b2b2c';
  g.fillRect(0, 0, 2048, 64);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(${prand() < 0.5 ? 0 : 255},${prand() < 0.5 ? 0 : 255},${prand() < 0.5 ? 0 : 255},0.03)`;
    g.fillRect(prand() * 2048, prand() * 64, 2 + prand() * 6, 1 + prand() * 2);
  }
  // tyre marks near both ends
  for (const x0 of [120, 1800]) {
    for (let i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(x0 + prand() * 160, 22 + prand() * 20, 30 + prand() * 60, 2);
    }
  }
  g.fillStyle = '#d9d9d2';
  // edge lines
  g.fillRect(0, 2, 2048, 2);
  g.fillRect(0, 60, 2048, 2);
  // centreline dashes
  for (let x = 90; x < 1960; x += 40) g.fillRect(x, 31, 22, 2);
  // threshold bars
  for (const x0 of [6, 2016]) for (let y = 7; y < 58; y += 6) g.fillRect(x0, y, 26, 3);
  // touchdown zones
  for (const x0 of [70, 1950]) for (const y of [14, 46]) g.fillRect(x0, y, 24, 4);
  // numbers
  g.save();
  g.translate(50, 32);
  g.rotate(Math.PI / 2);
  label(g, '09', 0, 0, 22, '#d9d9d2');
  g.restore();
  g.save();
  g.translate(1998, 32);
  g.rotate(-Math.PI / 2);
  label(g, '27', 0, 0, 22, '#d9d9d2');
  g.restore();
  const t = canvasTexture(c);
  return t;
}

function windowsTexture(lit: boolean): THREE.CanvasTexture {
  const [c, g] = canvas(64, 256);
  g.fillStyle = lit ? '#000' : '#3a3d42';
  g.fillRect(0, 0, 64, 256);
  for (let y = 4; y < 256; y += 8) {
    for (let x = 3; x < 64; x += 6) {
      const on = prand() < 0.45;
      g.fillStyle = lit ? (on ? `rgba(255,${190 + prand() * 50},${120 + prand() * 60},1)` : '#000') : on ? '#8fa3b5' : '#1d2329';
      g.fillRect(x, y, 4, 5);
    }
  }
  return canvasTexture(c);
}

function signTexture(lines: string[], bg = '#1c2a3a', fg = '#e9e6dc', stripes = false): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 256);
  if (stripes) {
    hazardStripes(g, 0, 0, 1024, 18);
    hazardStripes(g, 0, 238, 1024, 18);
  }
  g.strokeStyle = fg;
  g.lineWidth = 4;
  g.strokeRect(24, 28, 976, 200);
  const n = lines.length;
  lines.forEach((l, i) => {
    g.font = `bold ${i === 0 ? 52 : 34}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = fg;
    g.fillText(l, 512, 128 + (i - (n - 1) / 2) * 62);
  });
  return canvasTexture(c);
}

/**
 * Everything bolted to the ground near the launch site, in the site's local
 * tangent frame (x east, y up, z south). Positioned relative to the eye each frame.
 */
export class LaunchFacility {
  group = new THREE.Group();
  radarDish: THREE.Object3D;
  cityMat: THREE.MeshStandardMaterial;
  lights: THREE.InstancedMesh;
  lightMat: THREE.MeshBasicMaterial;

  constructor() {
    const G = this.group;
    const concrete = new THREE.MeshStandardMaterial({ color: 0x77736b, roughness: 0.95 });
    const asphalt = new THREE.MeshStandardMaterial({ map: runwayTexture(), roughness: 0.92 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x6b6f72, roughness: 0.6, metalness: 0.5 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x2f3336, roughness: 0.7, metalness: 0.4 });
    const white = new THREE.MeshStandardMaterial({ color: 0xb8b6ae, roughness: 0.8 });
    const govBlue = new THREE.MeshStandardMaterial({ color: 0x22364d, roughness: 0.7 });

    // runway 09/27 (5 km × 80 m) + taxiway + apron
    const rw = new THREE.Mesh(curvedPlane(5000, 80, 120, 2, 0, 0), asphalt);
    rw.position.y = 0.06;
    rw.receiveShadow = true;
    G.add(rw);
    const tw = new THREE.Mesh(curvedPlane(4600, 30, 80, 1, 0, -180), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.95 }));
    tw.position.y = 0.05;
    G.add(tw);
    const apron = new THREE.Mesh(curvedPlane(1600, 320, 20, 4, 600, -420), concrete);
    apron.position.y = 0.04;
    G.add(apron);

    // edge + approach lights
    const lightGeo = new THREE.BoxGeometry(0.6, 0.4, 0.6);
    this.lightMat = new THREE.MeshBasicMaterial({ color: 0xfff1c8 });
    const lightPos: THREE.Vector3[] = [];
    for (let x = -2500; x <= 2500; x += 60) {
      lightPos.push(new THREE.Vector3(x, 0.3, 42), new THREE.Vector3(x, 0.3, -42));
    }
    for (let i = 1; i <= 15; i++) for (let k = -2; k <= 2; k++) lightPos.push(new THREE.Vector3(-2500 - i * 60, 0.8, k * 4));
    this.lights = new THREE.InstancedMesh(lightGeo, this.lightMat, lightPos.length);
    const m = new THREE.Matrix4();
    lightPos.forEach((p, i) => {
      p.y += drop(p.x, p.z);
      this.lights.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
    });
    G.add(this.lights);

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0, shadow = true) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y + drop(x, z), z);
      mesh.rotation.y = ry;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      G.add(mesh);
      return mesh;
    };

    // terminal + tower
    const termWin = new THREE.MeshStandardMaterial({ color: 0x9aa1a6, map: windowsTexture(false), roughness: 0.6 });
    add(new THREE.BoxGeometry(520, 28, 70), termWin, 700, 14, -640);
    add(new THREE.BoxGeometry(540, 3, 90), darkSteel, 700, 29.5, -640);
    add(new THREE.CylinderGeometry(7, 9, 62, 12), white, 260, 31, -560);
    const cab = add(new THREE.CylinderGeometry(13, 10, 9, 12), new THREE.MeshStandardMaterial({ color: 0x20323f, roughness: 0.2, metalness: 0.8 }), 260, 66, -560);
    void cab;
    add(new THREE.CylinderGeometry(14, 14, 1.5, 12), darkSteel, 260, 71.5, -560);

    // hangars
    for (let i = 0; i < 4; i++) {
      const h = add(new THREE.CylinderGeometry(38, 38, 90, 16, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x5d6266, roughness: 0.8, side: THREE.DoubleSide }), 1150 + i * 110, 0, -470, 0);
      h.rotation.z = Math.PI / 2;
      h.rotation.y = Math.PI / 2;
    }

    // launch gantry + fuel farm
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(3, 85, 3), steel, -1600 + (i % 2) * 18, 42, -320 + Math.floor(i / 2) * 18);
    for (let y = 10; y < 85; y += 12) add(new THREE.BoxGeometry(22, 1.2, 22), steel, -1591, y, -311, 0, false);
    add(new THREE.BoxGeometry(14, 4, 30), darkSteel, -1591, 70, -290);
    for (let i = 0; i < 6; i++) add(new THREE.CylinderGeometry(14, 14, 22, 20), white, -900 + (i % 3) * 36, 11, -900 - Math.floor(i / 3) * 36);

    // authority radar (dish rotates)
    add(new THREE.BoxGeometry(18, 20, 18), govBlue, 3000, 10, 1500);
    add(new THREE.SphereGeometry(13, 16, 12), white, 3000, 30, 1500);
    const dishPivot = new THREE.Group();
    dishPivot.position.set(3000, 48 + drop(3000, 1500), 1500);
    const dish = new THREE.Mesh(new THREE.BoxGeometry(22, 7, 1.2), steel);
    dish.position.z = 3;
    dish.rotation.x = -0.35;
    dishPivot.add(dish);
    G.add(dishPivot);
    this.radarDish = dishPivot;

    // signage
    const signMat = new THREE.MeshBasicMaterial({ map: signTexture(['PLANETARY CIVIL FLIGHT AUTHORITY', 'UNSCHEDULED ORBITAL DEPARTURE IS A CRIMINAL OFFENCE']), toneMapped: false });
    const sign = add(new THREE.PlaneGeometry(64, 16), signMat, -1900, 14, -110, 0, false);
    sign.rotation.y = 0;
    add(new THREE.BoxGeometry(1, 14, 1), darkSteel, -1928, 7, -111);
    add(new THREE.BoxGeometry(1, 14, 1), darkSteel, -1872, 7, -111);
    const sign2Mat = new THREE.MeshBasicMaterial({ map: signTexture(['ORBITAL TRANSIT LANE THREE', 'COMPLIANCE IS FREEDOM'], '#3a1c1c', '#f0e6d0', true), toneMapped: false });
    const s2 = add(new THREE.PlaneGeometry(48, 12), sign2Mat, 1500, 12, 110, Math.PI, false);
    void s2;
    // blast fences
    for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(40, 6, 1), new THREE.MeshStandardMaterial({ color: 0x55524b }), -2600 - 10, 3, -60 + i * 24, Math.PI / 2);

    // distant city (instanced towers with lit windows)
    const n = 420;
    this.cityMat = new THREE.MeshStandardMaterial({ color: 0x4b5058, map: windowsTexture(false), emissiveMap: windowsTexture(true), emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 0.6 });
    const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.cityMat, n);
    const q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const cx = -16_000 + (prand() - 0.5) * 9000 * (0.4 + prand());
      const cz = -12_000 + (prand() - 0.5) * 7000 * (0.4 + prand());
      const dCenter = Math.hypot(cx + 16_000, cz + 12_000);
      const h = 20 + Math.pow(prand(), 3) * 260 * Math.max(0.2, 1 - dCenter / 6000);
      const w = 25 + prand() * 50;
      m.compose(new THREE.Vector3(cx, h / 2 + drop(cx, cz), cz), q, new THREE.Vector3(w, h, w * (0.6 + prand() * 0.8)));
      city.setMatrixAt(i, m);
    }
    G.add(city);
    // industrial cooling towers
    for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(35, 55, 140, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x8a8780, side: THREE.DoubleSide }), -9000 - i * 160, 70, -4000);

    this.addMountains();
  }

  private addMountains(): void {
    const geo = new THREE.ConeGeometry(1, 1, 18, 8);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) + 0.5; // 0..1
      const x = pos.getX(i), z = pos.getZ(i);
      const n = 1 + (Math.sin(x * 7.1 + z * 3.3) * 0.15 + Math.sin(z * 11.7 - x * 5.1) * 0.1) * (1 - y);
      pos.setX(i, x * n);
      pos.setZ(i, z * n);
      const snow = y > 0.72 + Math.sin(x * 9 + z * 4) * 0.05;
      const c = snow ? [0.85, 0.86, 0.9] : y < 0.15 ? [0.24, 0.25, 0.18] : [0.33, 0.3, 0.27];
      colors.push(...c);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const count = 46;
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      // ranges north and south of the field, keep the eastern departure clear
      const north = i % 2 === 0;
      const along = -60_000 + prand() * 150_000;
      const off = (north ? -1 : 1) * (26_000 + prand() * 45_000);
      const x = along, z = off;
      const h = 1500 + Math.pow(prand(), 1.5) * 3800;
      const r = h * (1.6 + prand() * 1.2);
      // true position on the sphere relative to the site
      const world = new THREE.Vector3(x, R, z).normalize().multiplyScalar(R);
      const local = world.clone().sub(new THREE.Vector3(0, R, 0));
      const q = new THREE.Quaternion().setFromUnitVectors(up, world.clone().normalize());
      m.compose(local.add(world.clone().normalize().multiplyScalar(h / 2 - 200)), q, new THREE.Vector3(r, h, r * (0.7 + prand() * 0.6)));
      inst.setMatrixAt(i, m);
    }
    this.group.add(inst);
  }

  update(dt: number, sunElevation: number): void {
    this.radarDish.rotation.y += dt * 0.9;
    const night = Math.max(0, Math.min(1, (0.25 - sunElevation) * 3));
    this.cityMat.emissiveIntensity = 0.15 + night * 1.2;
  }
}
