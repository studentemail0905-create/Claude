/**
 * Atmosphere model.
 * 0–86 km: U.S. Standard Atmosphere 1976 (layered lapse rates).
 * >86 km: log-linear interpolation of tabulated USSA76 / NRLMSISE-like densities.
 */
const R_AIR = 287.053;
const G0 = 9.80665;
const GAMMA = 1.4;

// Base geopotential altitude (m), base temperature (K), lapse (K/m), base pressure (Pa)
const LAYERS: [number, number, number, number][] = [
  [0, 288.15, -0.0065, 101325],
  [11000, 216.65, 0, 22632.06],
  [20000, 216.65, 0.001, 5474.889],
  [32000, 228.65, 0.0028, 868.0187],
  [47000, 270.65, 0, 110.9063],
  [51000, 270.65, -0.0028, 66.93887],
  [71000, 214.65, -0.002, 3.956420],
];

// Upper atmosphere density table (km, kg/m³)
const UPPER: [number, number][] = [
  [84.852, 6.958e-6], [90, 3.416e-6], [100, 5.604e-7], [110, 9.708e-8], [120, 2.222e-8],
  [130, 8.152e-9], [140, 3.831e-9], [150, 2.076e-9], [160, 1.233e-9], [180, 5.194e-10],
  [200, 2.541e-10], [250, 6.073e-11], [300, 1.916e-11], [400, 2.803e-12], [500, 5.215e-13],
  [700, 3.07e-14], [1000, 3.56e-15],
];

export interface AtmoSample {
  altitude: number;
  temperature: number; // K
  pressure: number; // Pa
  density: number; // kg/m³
  speedOfSound: number; // m/s
}

const R_E = 6356766;

export function sampleAtmosphere(altitude: number, out?: AtmoSample): AtmoSample {
  const o = out ?? { altitude: 0, temperature: 0, pressure: 0, density: 0, speedOfSound: 0 };
  o.altitude = altitude;
  const h = Math.max(-500, altitude);
  // geopotential altitude
  const hg = (R_E * h) / (R_E + h);
  if (hg < 84852) {
    let i = LAYERS.length - 1;
    while (i > 0 && hg < LAYERS[i][0]) i--;
    const [hb, Tb, L, Pb] = LAYERS[i];
    const T = Tb + L * (hg - hb);
    let P: number;
    if (L === 0) P = Pb * Math.exp((-G0 * (hg - hb)) / (R_AIR * Tb));
    else P = Pb * Math.pow(Tb / T, G0 / (R_AIR * L));
    o.temperature = T;
    o.pressure = P;
    o.density = P / (R_AIR * T);
  } else {
    const km = h / 1000;
    let rho: number;
    if (km >= UPPER[UPPER.length - 1][0]) rho = UPPER[UPPER.length - 1][1] * Math.exp(-(km - 1000) / 80);
    else {
      let i = 0;
      while (i < UPPER.length - 2 && km > UPPER[i + 1][0]) i++;
      const [k0, r0] = UPPER[i];
      const [k1, r1] = UPPER[i + 1];
      const t = (km - k0) / (k1 - k0);
      rho = Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * t);
    }
    // Thermosphere is hot but irrelevant for Mach; keep a nominal temperature for sound speed.
    const T = 186.87 + Math.min(800, Math.max(0, km - 90) * 6);
    o.temperature = T;
    o.density = rho;
    o.pressure = rho * R_AIR * T;
  }
  o.speedOfSound = Math.sqrt(GAMMA * R_AIR * Math.max(150, o.temperature));
  return o;
}

export function densityAt(altitude: number): number {
  return sampleAtmosphere(altitude).density;
}

export const SEA_LEVEL_DENSITY = 1.225;
