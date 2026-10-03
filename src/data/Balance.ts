/** Central tuning constants. SI units unless noted. */
export const BAL = {
  physicsHz: 120,

  // ── Mass budget (kg) ─────────────────────────────
  coreDry: 27_500,
  moduleDry: 23_000,
  podMass: 1_250, // empty capsule
  passengerMass: 92,
  passengersPerPod: 10,
  podCount: 4,
  coreTankCap: 14_000,
  svcTankCap: 26_000,
  rcsPropCap: 650,

  // ── Engines (per engine) ─────────────────────────
  engTvac: 680_000, // N
  engExitArea: 1.6, // m² (ambient pressure loss)
  engIsp: 2_600, // s (fictional compact fusion)
  engIdleN: 0.22,
  engStartTime: 7,
  thrustLimits: [0.92, 0.6, 0.85, 1.0, 1.1], // GEN, 60, 85, 100, 110
  engHeatFull: 900, // kW at N=1
  engHeatCap: 60, // kJ/K
  engCoolK: 1.18, // kW/K with full coolant
  engAirK: 0.35, // kW/K at sea-level density
  engTempCaution: 950,
  engTempWarn: 1050,
  engTempFire: 1220,

  // ── Electrical (kW) ──────────────────────────────
  genCap: 140,
  extPwrCap: 90,
  apuCap: 45,
  battMaxKw: 35,
  battCapacityKJ: 12_000,

  // ── Aero ─────────────────────────────────────────
  pre: { S: 260, c: 14, b: 24, cd0: 0.024, cla: 4.2, alphaStall: 17, cmq: -18, clp: -0.5, cnr: -0.25, clb: -0.12, cnb: 0.11, cmd: 0.42, cld: 0.09, cnd: 0.07, cyb: -0.6, xcp: 11.2, e: 0.78, AR: 2.3 },
  post: { S: 58, c: 10, b: 8, cd0: 0.055, cla: 2.6, alphaStall: 22, cmq: -12, clp: -0.35, cnr: -0.2, clb: -0.05, cnb: 0.05, cmd: 0.3, cld: 0.07, cnd: 0.05, cyb: -0.4, xcp: 5.6, e: 0.7, AR: 1.1 },

  // ── Structure ────────────────────────────────────
  nzLimitPre: 4.2,
  nzLimitPost: 7.5,
  nzNegLimit: -2.0,
  qLimit: 48_000,
  qLimitPost: 42_000,

  // ── Thermal ──────────────────────────────────────
  hullCaution: 1150,
  hullDamage: 1420,
  hullDestroy: 1720,
  hullHeatCapPerArea: 16_000, // J/(m²K)
  hullEmissivity: 0.85,
  noseRadius: 0.9,

  // ── Jammer ───────────────────────────────────────
  jamNominalSeconds: 40,
  jamChargeKw: 55,
  jamChargeRate: 1 / 26, // fraction/s at full power
  jamHeatEngaged: 1.7, // °C/s
  jamTempLimit: 125,
  jamTempRunaway: 165,

  // ── Jump ─────────────────────────────────────────
  jumpChargeKw: 170,
  jumpChargeRate: 1 / 30, // per second at full power, mass-normalised
  jumpRefMass: 46_000,
  jumpOvercharge: 1.15,
  jumpExplode: 1.27,

  // ── Government ───────────────────────────────────
  corridorCeiling: 85_000,
  alertDecay: 0.35,
};

export type AeroConfig = typeof BAL.pre;
