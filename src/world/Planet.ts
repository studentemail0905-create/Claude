import * as THREE from 'three';
import { PLANET_FRAG, PLANET_VERT } from './shaders/planet.glsl';
import { PLANET } from '../physics/PlanetPhysics';
import type { WorldRoll } from '../physics/Weather';

export const LAUNCH_SITE = new THREE.Vector3(0, PLANET.radius, 0);
export const EAST0 = new THREE.Vector3(1, 0, 0);
export const NORTH0 = new THREE.Vector3(0, 0, -1);

/** Late-afternoon sun in the west-south-west: you launch east, toward the terminator. */
export function sunDirection(): THREE.Vector3 {
  const az = (255 * Math.PI) / 180;
  const el = (21 * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

/** Full-screen ray-traced planet + atmosphere + clouds. Writes log depth so meshes occlude correctly. */
export class PlanetRenderer {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
      uniforms: {
        uInvProj: { value: new THREE.Matrix4() },
        uCamRot: { value: new THREE.Matrix4() },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uCamR: { value: 6371 },
        uCamH: { value: 0.01 },
        uCamLocal: { value: new THREE.Vector3() },
        uLaunchDir: { value: new THREE.Vector3(0, 1, 0) },
        uEast0: { value: EAST0.clone() },
        uNorth0: { value: NORTH0.clone() },
        uSunDir: { value: sunDirection() },
        uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
        uLogDepthFC: { value: 1 },
        uCloudBase: { value: 2.5 },
        uCloudTop: { value: 4 },
        uCloudCover: { value: 0.4 },
        uCloudSeed: { value: 1 },
        uHighCover: { value: 0.3 },
        uInCloud: { value: 0 },
        uTime: { value: 0 },
        uSteps: { value: 10 },
        uPlasma: { value: 0 },
      },
      transparent: true,
      depthTest: true,
      depthWrite: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
  }

  setWeather(w: WorldRoll): void {
    const u = this.material.uniforms;
    u.uCloudBase.value = w.cloudBase / 1000;
    u.uCloudTop.value = w.cloudTop / 1000;
    u.uCloudCover.value = w.cloudCover;
    u.uCloudSeed.value = w.cloudSeed;
    u.uHighCover.value = w.highCloudCover;
  }

  update(camera: THREE.PerspectiveCamera, eyeWorld: THREE.Vector3, inCloud: number, time: number, steps: number, plasma: number): void {
    const u = this.material.uniforms;
    const r = eyeWorld.length();
    u.uUp.value.copy(eyeWorld).multiplyScalar(1 / r);
    u.uCamR.value = r / 1000;
    u.uCamH.value = Math.max(0.0005, (r - PLANET.radius) / 1000);
    u.uCamLocal.value.copy(eyeWorld).sub(LAUNCH_SITE);
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamRot.value.extractRotation(camera.matrixWorld);
    camera.getWorldDirection(u.uCamFwd.value);
    u.uLogDepthFC.value = 2.0 / (Math.log(camera.far + 1.0) / Math.LN2);
    u.uInCloud.value = inCloud;
    u.uTime.value = time;
    u.uSteps.value = steps;
    u.uPlasma.value = plasma;
  }
}

/** Starfield + faint galactic band. Drawn first, behind the atmosphere pass. */
export function createStars(): THREE.Points {
  const n = 5200;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  let s = 1234567;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const band = new THREE.Vector3(0.3, 0.5, 0.81).normalize();
  for (let i = 0; i < n; i++) {
    let v: THREE.Vector3;
    if (i < n * 0.35) {
      // concentrate in a band
      const a = rnd() * Math.PI * 2;
      const t = new THREE.Vector3(1, 0, 0).cross(band).normalize();
      const b2 = band.clone().cross(t);
      v = t.multiplyScalar(Math.cos(a)).add(b2.multiplyScalar(Math.sin(a))).addScaledVector(band, (rnd() - 0.5) * 0.25).normalize();
    } else {
      const z = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(1 - z * z);
      v = new THREE.Vector3(rr * Math.cos(a), z, rr * Math.sin(a));
    }
    pos.set([v.x * 9e6, v.y * 9e6, v.z * 9e6], i * 3);
    const temp = rnd();
    const c = temp < 0.2 ? [0.7, 0.8, 1] : temp > 0.85 ? [1, 0.8, 0.6] : [1, 0.97, 0.92];
    const m = Math.pow(rnd(), 6) * 2.4 + 0.15;
    col.set([c[0] * m, c[1] * m, c[2] * m], i * 3);
    size[i] = 1.0 + Math.pow(rnd(), 10) * 2.5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uBright: { value: 1 }, uPx: { value: 1 } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uPx;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w * 0.9999; gl_PointSize = size * uPx; }`,
    fragmentShader: `varying vec3 vC; uniform float uBright;
      void main(){ vec2 p = gl_PointCoord - 0.5; float d = dot(p,p); float a = exp(-d*14.0); gl_FragColor = vec4(vC * a * uBright, 1.0); }`,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    transparent: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -10;
  return pts;
}
