import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Full-screen effects: hypoxia tunnel, G greyout/redout, jump distortion + whiteout, damage flash, grain. */
export function createFxPass(): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uHypoxia: { value: 0 },
      uGrey: { value: 0 },
      uRed: { value: 0 },
      uJump: { value: 0 },
      uWhite: { value: 0 },
      uFlash: { value: 0 },
      uNoise: { value: 0 },
      uAspect: { value: 1.7 },
      uBlack: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uTime, uHypoxia, uGrey, uRed, uJump, uWhite, uFlash, uNoise, uAspect, uBlack;
      varying vec2 vUv;
      float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime*37.0) * 43758.5453); }
      void main(){
        vec2 uv = vUv;
        vec2 c = uv - 0.5;
        c.x *= uAspect;
        float r = length(c);
        // jump: radial stretch + swirl + chromatic split
        if (uJump > 0.0) {
          float k = uJump * uJump;
          float ang = k * 0.6 * exp(-r * 2.0) * sin(uTime * 3.0);
          float cs = cos(ang), sn = sin(ang);
          vec2 d = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
          d *= 1.0 - k * 0.35 * (1.0 - r);
          d.x /= uAspect;
          uv = d + 0.5;
        }
        float ca = 0.0004 + uJump * 0.02 + uFlash * 0.004;
        vec2 dir = normalize(c + 1e-5) * ca;
        vec3 col;
        col.r = texture2D(tDiffuse, uv + dir).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - dir).b;
        // hypoxia: desaturate + tunnel
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(lum), clamp(uHypoxia * 1.2 + uGrey * 0.8, 0.0, 1.0));
        float tunnel = smoothstep(0.85 - uHypoxia * 0.6 - uGrey * 0.5, 0.25, r * (1.0 + uHypoxia + uGrey));
        col *= mix(1.0, tunnel, clamp(uHypoxia * 1.5 + uGrey, 0.0, 1.0));
        col = mix(col, col * vec3(1.0, 0.25, 0.2) + vec3(0.25, 0.0, 0.0), uRed);
        // vignette
        col *= 1.0 - 0.28 * smoothstep(0.45, 1.05, r);
        // grain / interference
        col += (rnd(uv * 400.0) - 0.5) * (0.025 + uNoise * 0.12);
        col = mix(col, vec3(1.0, 0.98, 0.95), clamp(uWhite, 0.0, 1.0));
        col += vec3(0.6, 0.15, 0.1) * uFlash * 0.25;
        col *= 1.0 - uBlack;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export const _t = THREE;
