// Ray-traced planet, single-scattering atmosphere and two cloud layers.
// Distances in km for sphere maths (stable quadratic forms), metres for local detail.
export const PLANET_VERT = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamRot;
varying vec3 vRay;
void main() {
  vec4 v = uInvProj * vec4(position.xy, -1.0, 1.0);
  vRay = (uCamRot * vec4(v.xyz / v.w, 0.0)).xyz;
  gl_Position = vec4(position.xy, 0.99999, 1.0);
}`;

export const PLANET_FRAG = /* glsl */ `
precision highp float;
precision highp int;
uniform vec3 uUp;          // camera radial unit vector
uniform float uCamR;       // km
uniform float uCamH;       // km above surface (precise)
uniform vec3 uCamLocal;    // metres relative to launch site (world axes)
uniform vec3 uLaunchDir;   // unit
uniform vec3 uEast0;       // launch-site east
uniform vec3 uNorth0;      // launch-site north
uniform vec3 uSunDir;
uniform vec3 uCamFwd;
uniform float uLogDepthFC;
uniform float uCloudBase;  // km
uniform float uCloudTop;   // km
uniform float uCloudCover;
uniform int uCloudSeed;
uniform float uHighCover;
uniform float uInCloud;
uniform float uTime;
uniform int uSteps;
uniform float uPlasma;
varying vec3 vRay;

const float R = 6371.0;
const float RA = 6471.0;
const vec3 BR = vec3(5.8e-3, 13.5e-3, 33.1e-3);
const float BM = 21e-3;
const float HR = 8.0;
const float HM = 1.2;
const float SUN = 20.0;

uint hash3(ivec3 p, int seed) {
  uint h = (uint(p.x) * 0x8da6b343u) ^ (uint(p.y) * 0xd8163841u) ^ (uint(p.z) * 0xcb1ab31fu) ^ uint(seed);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  h = h ^ (h >> 15u);
  return h;
}
float h01(ivec3 p, int seed) { return float(hash3(p, seed)) / 4294967296.0; }
float vnoise(vec3 p, int seed) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * (3.0 - 2.0 * f);
  ivec3 ii = ivec3(i);
  float a = h01(ii, seed), b = h01(ii + ivec3(1,0,0), seed), c = h01(ii + ivec3(0,1,0), seed), d = h01(ii + ivec3(1,1,0), seed);
  float e = h01(ii + ivec3(0,0,1), seed), f2 = h01(ii + ivec3(1,0,1), seed), g = h01(ii + ivec3(0,1,1), seed), h = h01(ii + ivec3(1,1,1), seed);
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f2, u.x), mix(g, h, u.x), u.y), u.z);
}
float fbm(vec3 p, int seed, int oct) {
  float f = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    f += a * vnoise(p, seed + i * 31);
    p *= 2.07; a *= 0.5;
  }
  return f;
}
// matches Weather.cloudCoverage()
float cloudCov(vec3 dir, int seed, float cover) {
  float f = 0.0, amp = 0.5, s = 900.0;
  for (int i = 0; i < 4; i++) {
    f += amp * vnoise(dir * s, seed + i * 101);
    s *= 2.3; amp *= 0.5;
  }
  float big = vnoise(dir * 120.0, seed + 7);
  return smoothstep(1.0 - cover, 1.0 - cover + 0.22, f * 0.8 + big * 0.35);
}

// ray/sphere (radius R + dh) with numerically stable roots; c uses the precise camera altitude
bool sphere(float b, float dh, out float t0, out float t1) {
  float c = (uCamH - dh) * (uCamR + R + dh);
  float disc = b * b - c;
  if (disc < 0.0) return false;
  float sq = sqrt(disc);
  if (b < 0.0) { t1 = -b + sq; t0 = c / t1; }
  else { t0 = -b - sq; t1 = (abs(t0) > 1e-9) ? c / t0 : -b + sq; if (t0 > t1) { float tt = t0; t0 = t1; t1 = tt; } }
  return true;
}

vec2 densities(float h) { return vec2(exp(-h / HR), exp(-h / HM)); }

vec2 lightDepth(vec3 p) {
  float r = length(p);
  vec3 up = p / r;
  float mu = dot(up, uSunDir);
  float b = r * mu;
  float c = r * r - RA * RA;
  float t = -b + sqrt(max(0.0, b * b - c));
  float cg = r * r - R * R;
  float dg = b * b - cg;
  if (dg > 0.0 && b < 0.0) return vec2(1e9);
  vec2 od = vec2(0.0);
  float ds = t / 4.0;
  for (int i = 0; i < 4; i++) {
    vec3 q = p + uSunDir * (ds * (float(i) + 0.5));
    od += densities(max(0.0, length(q) - R)) * ds;
  }
  return od;
}

void scatter(vec3 camP, vec3 d, float tStart, float tEnd, out vec3 inscat, out vec3 trans) {
  inscat = vec3(0.0);
  vec2 od = vec2(0.0);
  float mu = dot(d, uSunDir);
  float pr = 3.0 / (16.0 * 3.14159) * (1.0 + mu * mu);
  float g = 0.76;
  float pm = 3.0 / (8.0 * 3.14159) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(max(1e-4, 1.0 + g * g - 2.0 * g * mu), 1.5));
  int n = uSteps;
  // non-uniform steps: denser near the camera where the air is thick
  float span = tEnd - tStart;
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float prevT = tStart;
  for (int i = 0; i < 16; i++) {
    if (i >= n) break;
    float u1 = float(i + 1) / float(n);
    float t1 = tStart + span * u1 * u1;
    float seg = t1 - prevT;
    float t = (prevT + t1) * 0.5;
    prevT = t1;
    vec3 p = camP + d * t;
    float h = max(0.0, length(p) - R);
    vec2 dd = densities(h) * seg;
    od += dd;
    vec2 ld = lightDepth(p);
    if (ld.x > 1e8) continue;
    vec3 att = exp(-(BR * (od.x + ld.x) + BM * 1.1 * (od.y + ld.y)));
    sumR += dd.x * att;
    sumM += dd.y * att;
  }
  inscat = SUN * (sumR * BR * pr + sumM * BM * pm);
  trans = exp(-(BR * od.x + BM * 1.1 * od.y));
}

vec3 groundColor(vec3 sdir, vec3 local, float dist, out float spec, out float isWater) {
  float cont = fbm(sdir * 3.0, 11, 6);
  float site = smoothstep(0.03, 0.006, distance(sdir, uLaunchDir));
  float land = smoothstep(0.47, 0.5, cont + site * 0.4);
  isWater = 1.0 - land;
  float hum = fbm(sdir * 9.0 + 3.1, 23, 4);
  float rock = fbm(sdir * 40.0, 37, 4);
  vec3 grass = vec3(0.13, 0.15, 0.08);
  vec3 dry = vec3(0.36, 0.30, 0.21);
  vec3 forest = vec3(0.06, 0.09, 0.05);
  vec3 c = mix(dry, grass, smoothstep(0.35, 0.65, hum));
  c = mix(c, forest, smoothstep(0.55, 0.75, hum) * 0.7);
  c = mix(c, vec3(0.28, 0.27, 0.25), smoothstep(0.6, 0.8, rock) * 0.6);
  c = mix(c, vec3(0.85), smoothstep(0.74, 0.8, rock) * smoothstep(0.55, 0.7, cont));
  vec2 lx = vec2(dot(local, uEast0), dot(local, uNorth0));
  float lod = clamp(1.0 - dist / 80.0, 0.0, 1.0);
  if (lod > 0.0) {
    vec2 cell = floor(lx / 380.0);
    float fh = h01(ivec3(int(cell.x), int(cell.y), 3), 5);
    vec3 field = mix(vec3(0.25, 0.24, 0.13), vec3(0.15, 0.19, 0.09), fh);
    field = mix(field, vec3(0.38, 0.32, 0.22), step(0.8, fh));
    vec2 fr = fract(lx / 380.0);
    float road = (1.0 - smoothstep(0.0, 0.012, min(fr.x, fr.y))) * step(0.6, h01(ivec3(int(cell.x), 0, 9), 2));
    field = mix(field, vec3(0.3), road * 0.7);
    float det = fbm(vec3(lx / 23.0, 0.5), 41, 3);
    field *= 0.8 + 0.4 * det;
    float apron = 1.0 - smoothstep(3200.0, 3800.0, max(abs(lx.x) - 200.0, abs(lx.y - 300.0) * 3.5));
    field = mix(field, vec3(0.40, 0.39, 0.36) * (0.85 + 0.3 * det), apron);
    c = mix(c, field, lod * land);
  }
  vec3 water = vec3(0.01, 0.035, 0.07);
  spec = isWater;
  return mix(water, c, land);
}

vec3 cityLights(vec3 sdir) {
  float n = fbm(sdir * 60.0, 77, 5);
  float m = fbm(sdir * 7.0, 91, 3);
  float urban = smoothstep(0.62, 0.7, n) * smoothstep(0.45, 0.6, m);
  return vec3(1.0, 0.62, 0.28) * urban * 0.35;
}

void main() {
  vec3 d = normalize(vRay);
  float b = uCamR * dot(d, uUp);
  vec3 camP = uUp * uCamR;
  vec3 col = vec3(0.0);
  float alpha = 1.0;
  float tg0 = 0.0, tg1 = 0.0, ta0 = 0.0, ta1 = 0.0;
  bool hitG = sphere(b, 0.0, tg0, tg1) && tg0 > 0.0;
  bool hitA = sphere(b, RA - R, ta0, ta1) && ta1 > 0.0;
  float tStart = hitA ? max(0.0, ta0) : 0.0;
  float tEnd = hitG ? tg0 : (hitA ? ta1 : 0.0);
  float depthT = hitG ? tg0 : 1e9;

  vec3 surf = vec3(0.0);
  float surfA = 0.0;
  if (hitG) {
    vec3 p = camP + d * tg0;
    vec3 sdir = normalize(p);
    vec3 local = uCamLocal + d * (tg0 * 1000.0);
    float spec, water;
    vec3 gc = groundColor(sdir, local, tg0, spec, water);
    float ndl = dot(sdir, uSunDir);
    float lit = clamp(ndl * 1.2 + 0.05, 0.0, 1.0);
    float shadow = 1.0;
    if (uCloudCover > 0.01 && ndl > 0.0) {
      vec3 sp = sdir + uSunDir * ((uCloudBase + 0.6) / R) / max(0.2, ndl);
      shadow = 1.0 - 0.6 * cloudCov(normalize(sp), uCloudSeed, uCloudCover);
    }
    vec2 ld = lightDepth(p + sdir * 0.01);
    vec3 sunT = ld.x > 1e8 ? vec3(0.0) : exp(-(BR * ld.x + BM * 1.1 * ld.y));
    vec3 amb = vec3(0.10, 0.13, 0.18) * clamp(ndl + 0.25, 0.0, 1.0);
    surf = gc * (SUN * 0.11 * lit * sunT * shadow + amb);
    vec3 hv = normalize(uSunDir - d);
    surf += spec * pow(max(0.0, dot(sdir, hv)), 180.0) * sunT * 6.0;
    surf += cityLights(sdir) * smoothstep(0.05, -0.12, ndl) * (1.0 - water);
    surfA = 1.0;
  }

  vec3 cloudCol = vec3(0.0);
  float cloudA = 0.0;
  float cloudT = 1e9;
  if (uCloudCover > 0.01) {
    float hc = uCamH < uCloudBase ? uCloudBase : (uCamH > uCloudTop ? uCloudTop : -1.0);
    float c0 = 0.0, c1 = 0.0;
    if (hc > 0.0 && sphere(b, hc, c0, c1)) {
      float tc = -1.0;
      if (uCamH < hc) tc = c1;            // inside the shell looking out
      else tc = c0;                       // above, looking down
      if (tc > 0.0 && tc < depthT) {
        vec3 p = camP + d * tc;
        vec3 sdir = normalize(p);
        float cov = cloudCov(sdir, uCloudSeed, uCloudCover);
        if (cov > 0.002) {
          float ndl = dot(sdir, uSunDir);
          vec2 ld = lightDepth(p);
          vec3 sunT = ld.x > 1e8 ? vec3(0.0) : exp(-(BR * ld.x + BM * 1.1 * ld.y));
          float selfS = cloudCov(normalize(sdir + uSunDir * 0.0003), uCloudSeed, uCloudCover);
          float bright = (uCamH > hc ? 1.0 : 0.55) * (1.0 - selfS * 0.35);
          cloudCol = vec3(1.0, 0.98, 0.95) * (SUN * 0.075 * clamp(ndl + 0.2, 0.0, 1.0) * sunT * bright + 0.04);
          cloudA = clamp(cov * 1.3, 0.0, 1.0) * clamp(tc / 0.4, 0.0, 1.0);
          cloudT = tc;
        }
      }
    }
  }
  float cirA = 0.0;
  vec3 cirCol = vec3(0.0);
  if (uHighCover > 0.01 && uCamH < 9.0) {
    float c0 = 0.0, c1 = 0.0;
    if (sphere(b, 9.0, c0, c1) && c1 > 0.0 && c1 < depthT) {
      vec3 sdir = normalize(camP + d * c1);
      float n = fbm(vec3(sdir.x * 3000.0, sdir.y * 600.0, sdir.z * 3000.0), 211, 4);
      cirA = smoothstep(1.0 - uHighCover * 0.7, 1.0, n) * 0.55;
      cirCol = vec3(1.0) * SUN * 0.07 * clamp(dot(sdir, uSunDir) + 0.2, 0.0, 1.0);
    }
  }

  vec3 inscat = vec3(0.0), trans = vec3(1.0);
  if (tEnd > tStart) {
    float tE = (cloudA > 0.5 && cloudT < tEnd) ? cloudT : tEnd;
    scatter(camP, d, tStart, tE, inscat, trans);
  }

  vec3 behind = surf;
  float behindA = surfA;
  if (cloudA > 0.0) { behind = mix(behind, cloudCol, cloudA); behindA = max(behindA, cloudA); }
  if (cirA > 0.0) { behind = mix(behind, cirCol, cirA); behindA = max(behindA, cirA); }
  col = behind * trans + inscat;
  alpha = (1.0 - behindA) * dot(trans, vec3(0.3333));

  float sd = dot(d, uSunDir);
  if (!hitG) {
    float disc = smoothstep(0.99997, 0.999993, sd);
    col += trans * (disc * 300.0 + pow(max(sd, 0.0), 1200.0) * 4.0) * (1.0 - behindA);
  }
  if (uInCloud > 0.0) {
    col = mix(col, vec3(0.62, 0.64, 0.68) * SUN * 0.06 * clamp(dot(uUp, uSunDir) + 0.3, 0.2, 1.0), uInCloud * 0.92);
    alpha *= 1.0 - uInCloud;
  }
  col += vec3(0.35, 0.55, 1.0) * uPlasma * 0.25;

  gl_FragColor = vec4(col, alpha);
  float hitT = surfA > 0.5 ? depthT : (cloudA > 0.5 ? cloudT : 1e9);
  float viewZ = hitT * 1000.0 * max(0.05, dot(d, uCamFwd));
  gl_FragDepth = hitT < 1e8 ? clamp(log2(1.0 + viewZ) * uLogDepthFC * 0.5, 0.0, 0.99999) : 0.999999;
}`;
