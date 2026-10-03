import * as THREE from 'three';
import type { Run, WorldObject } from '../core/Run';
import { buildShipModel } from './ShipModel';
import { PLANET } from '../physics/PlanetPhysics';
import { canvas, canvasTexture } from '../render/textures';

function glowTexture(color: string): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.2, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return canvasTexture(c);
}

const GLOW_W = glowTexture('rgba(255,220,180,0.8)');
const GLOW_R = glowTexture('rgba(255,90,40,0.8)');
const GLOW_B = glowTexture('rgba(140,190,255,0.8)');

function glint(tex: THREE.Texture, size: number, color = 0xffffff): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, toneMapped: false }));
  s.scale.set(size, size, 1);
  return s;
}

function interceptorMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.5, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.9, 16, 10), mat);
  body.rotation.x = -Math.PI / 2;
  g.add(body);
  const w = new THREE.Shape();
  w.moveTo(0, -3);
  w.lineTo(6, 4);
  w.lineTo(-6, 4);
  const wing = new THREE.Mesh(new THREE.ExtrudeGeometry(w, { depth: 0.2, bevelEnabled: false }), mat);
  wing.rotation.x = Math.PI / 2;
  g.add(wing);
  const ab = glint(GLOW_R, 0.035);
  ab.position.z = 8.5;
  g.add(ab);
  const strobe = glint(GLOW_W, 0.02);
  strobe.position.y = 1;
  strobe.name = 'strobe';
  g.add(strobe);
  return g;
}

function missileMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 4, 8), new THREE.MeshStandardMaterial({ color: 0xcfcfc8 }));
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const fl = glint(GLOW_W, 0.05, 0xffd29a);
  fl.position.z = 2.4;
  g.add(fl);
  return g;
}

function droneMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b3a50, roughness: 0.5, metalness: 0.6 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(4, 2, 6), mat));
  const arm = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 0.3), mat);
  g.add(arm);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 5, 3), new THREE.MeshStandardMaterial({ color: 0x1b2a6a, metalness: 0.8, roughness: 0.3 }));
  panel.position.x = 7;
  g.add(panel);
  const p2 = panel.clone();
  p2.position.x = -7;
  g.add(p2);
  const light = glint(GLOW_B, 0.03);
  light.name = 'strobe';
  g.add(light);
  return g;
}

function podMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const geo = new THREE.CapsuleGeometry(0.9, 2.2, 6, 14);
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd8742a })));
  const chute = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), new THREE.MeshStandardMaterial({ color: 0xe8e2d0, side: THREE.DoubleSide }));
  chute.position.y = 14;
  chute.name = 'chute';
  chute.visible = false;
  g.add(chute);
  const b = glint(GLOW_R, 0.012);
  b.name = 'strobe';
  g.add(b);
  return g;
}

function debrisMesh(size: number): THREE.Object3D {
  const geo = new THREE.DodecahedronGeometry(size * 0.5, 0);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.6 + Math.random() * 0.8), p.getY(i) * (0.6 + Math.random() * 0.8), p.getZ(i) * (0.6 + Math.random() * 0.8));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 0.8, metalness: 0.4, flatShading: true }));
  const g = new THREE.Group();
  g.add(m);
  g.add(glint(GLOW_W, 0.008));
  return g;
}

/** Renders simulation objects relative to the eye. One mesh per live object. */
export class WorldObjects {
  group = new THREE.Group();
  private meshes = new Map<number, THREE.Object3D>();
  gates: THREE.Mesh[] = [];
  gateMat: THREE.MeshBasicMaterial;
  escMarker: THREE.Sprite;
  station: THREE.Group;
  stationPos = new THREE.Vector3();
  moon: THREE.Mesh;
  satellites: { obj: THREE.Object3D; r: number; phase: number; axis: THREE.Vector3; rate: number }[] = [];
  private tmp = new THREE.Vector3();

  constructor() {
    // route gates: AR markers projected by the windscreen
    const [c, g] = canvas(256, 160);
    g.strokeStyle = 'rgba(120,255,150,1)';
    g.lineWidth = 6;
    const L = 46;
    for (const [x, y, dx, dy] of [[4, 4, 1, 1], [252, 4, -1, 1], [4, 156, 1, -1], [252, 156, -1, -1]]) {
      g.beginPath();
      g.moveTo(x + dx * L, y);
      g.lineTo(x, y);
      g.lineTo(x, y + dy * L);
      g.stroke();
    }
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(120,255,150,0.35)';
    g.strokeRect(4, 4, 248, 152);
    this.gateMat = new THREE.MeshBasicMaterial({ map: canvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, opacity: 0.8 });
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.gateMat);
      m.visible = false;
      m.renderOrder = 5;
      this.group.add(m);
      this.gates.push(m);
    }
    this.escMarker = glint(glowTexture('rgba(255,120,255,0.9)'), 0.06);
    this.escMarker.visible = false;
    this.group.add(this.escMarker);

    // orbital transit station (ring) far above the lane
    this.station = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(400, 40, 10, 40), new THREE.MeshStandardMaterial({ color: 0xb8b8b0, metalness: 0.5, roughness: 0.4 }));
    this.station.add(ring);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 500, 16), new THREE.MeshStandardMaterial({ color: 0x8c8c86, metalness: 0.5 }));
    hub.rotation.x = Math.PI / 2;
    this.station.add(hub);
    this.station.add(glint(GLOW_W, 0.02));
    this.group.add(this.station);
    this.stationPos.set(0.42, 0.85, -0.32).normalize().multiplyScalar(PLANET.radius + 420_000);

    this.moon = new THREE.Mesh(new THREE.SphereGeometry(1_737_000, 32, 24), new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 1 }));
    this.moon.userData.dir = new THREE.Vector3(0.62, 0.55, 0.56).normalize();
    this.group.add(this.moon);

    for (let i = 0; i < 14; i++) {
      const o = new THREE.Group();
      o.add(new THREE.Mesh(new THREE.BoxGeometry(3, 3, 6), new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.7 })));
      o.add(glint(GLOW_W, 0.006));
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.satellites.push({ obj: o, r: PLANET.radius + 300_000 + Math.random() * 900_000, phase: Math.random() * Math.PI * 2, axis, rate: 0.0004 + Math.random() * 0.0008 });
      this.group.add(o);
    }
  }

  private make(o: WorldObject): THREE.Object3D {
    switch (o.kind) {
      case 'interceptor': return interceptorMesh();
      case 'missile': return missileMesh();
      case 'drone': return droneMesh();
      case 'pod': return podMesh();
      case 'module': {
        const parts = buildShipModel();
        parts.core.visible = false;
        for (const p of parts.pods) p.visible = false;
        for (const g of parts.gear) g.visible = false;
        const grp = new THREE.Group();
        // module geometry is authored in ship body coordinates around (0,-3.6,11.5)
        parts.root.position.set(0, 3.6, -11.5);
        grp.add(parts.root);
        return grp;
      }
      case 'debris': return debrisMesh(o.data.size ?? 6);
      case 'contact': return droneMesh();
      case 'decoy': return glint(GLOW_W, 0.06, 0xffeecc);
    }
  }

  update(run: Run, eye: THREE.Vector3, time: number, routeVisible: boolean, escVisible: boolean): void {
    const seen = new Set<number>();
    for (const o of run.objects) {
      if (!o.alive) continue;
      seen.add(o.id);
      let m = this.meshes.get(o.id);
      if (!m) {
        m = this.make(o);
        this.meshes.set(o.id, m);
        this.group.add(m);
      }
      m.position.copy(o.pos).sub(eye);
      m.quaternion.copy(o.quat);
      const strobe = m.getObjectByName('strobe');
      if (strobe) strobe.visible = Math.sin(time * 6 + o.id) > 0.6;
      if (o.kind === 'pod') {
        const chute = m.getObjectByName('chute');
        if (chute) chute.visible = !!o.data.chute;
      }
    }
    for (const [id, m] of this.meshes) {
      if (!seen.has(id)) {
        this.group.remove(m);
        this.meshes.delete(id);
      }
    }

    // route gates
    const ship = run.ship;
    const q = run.fd.routeQ;
    const alt = ship.env.altitude;
    const spacing = alt < 8000 ? 3500 : alt < 35_000 ? 8000 : 20_000;
    if (routeVisible && q) {
      const s0 = Math.ceil((q.s + 300) / spacing) * spacing;
      for (let i = 0; i < this.gates.length; i++) {
        const s = s0 + i * spacing;
        const p = run.plan.pointAtS(s, this.tmp).add(ship.avionics.spoofOffset);
        const pn = run.plan.pointAtS(s + 200, new THREE.Vector3()).add(ship.avionics.spoofOffset);
        const g = this.gates[i];
        g.visible = true;
        g.position.copy(p).sub(eye);
        const fwd = pn.sub(p).normalize();
        const up = p.clone().normalize();
        const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
        const up2 = new THREE.Vector3().crossVectors(right, fwd);
        g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up2, fwd.negate()));
        const pt = run.plan.points[Math.min(run.plan.points.length - 1, Math.floor(s / 1000))];
        const w = Math.min(pt.halfWidth * 0.5, 1200 + alt * 0.04);
        const h = Math.min(pt.halfHeight * 0.5, w * 0.6);
        g.scale.set(w, h, 1);
      }
      this.gateMat.opacity = 0.45 * run.ship.controls.get('hudBright');
    } else for (const g of this.gates) g.visible = false;

    this.escMarker.visible = escVisible;
    if (escVisible) this.escMarker.position.copy(ship.escapeVector).multiplyScalar(5_000_000);

    this.station.position.copy(this.stationPos).sub(eye);
    this.station.rotation.z = time * 0.02;
    this.moon.position.copy(this.moon.userData.dir).multiplyScalar(384_400_000).sub(eye);
    for (const s of this.satellites) {
      const p = new THREE.Vector3(1, 0, 0).applyAxisAngle(s.axis, s.phase + time * s.rate).multiplyScalar(s.r);
      if (Math.abs(p.clone().normalize().dot(s.axis)) > 0.99) p.set(0, s.r, 0);
      s.obj.position.copy(p).sub(eye);
    }
  }
}
