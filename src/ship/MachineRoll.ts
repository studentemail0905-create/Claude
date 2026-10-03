import type { RNG } from '../core/RNG';
import { SIDEGRADES } from '../data/Sidegrades';

/** Layer 1 RNG: hidden component tolerances for this airframe, this run. */
export interface MachineRoll {
  engEff: { A: number; B: number };
  engHeat: { A: number; B: number };
  coolEff: { A: number; B: number };
  hydHealth: { A: number; B: number };
  genCap: { A: number; B: number };
  fuelPump: { A: number; B: number };
  elecNoise: number;
  elecFireRisk: number;
  jamCap: number;
  jamHeat: number;
  jamRunaway: number;
  coilQuality: number;
  coilHeat: number;
  coilQuench: number;
  capTolerance: number;
  capArcRisk: number;
  jumpChargeRate: number;
  rcsEff: number;
  sensorBias: number;
  podCharge: number[];
  podQuality: number;
  boardRate: number;
  gearStrength: number;
  structure: number;
  postSepMassMul: number;
  hydLeakA: number;
  hydLeakB: number;
}

export function rollMachine(rng: RNG, equipped: string[]): MachineRoll {
  const r = rng.fork('machine');
  const m: MachineRoll = {
    engEff: { A: r.tolerance(0.05), B: r.tolerance(0.05) },
    engHeat: { A: r.tolerance(0.1), B: r.tolerance(0.1) },
    coolEff: { A: r.tolerance(0.1), B: r.tolerance(0.1) },
    hydHealth: { A: r.tolerance(0.07), B: r.tolerance(0.07) },
    genCap: { A: r.tolerance(0.06), B: r.tolerance(0.06) },
    fuelPump: { A: r.tolerance(0.09), B: r.tolerance(0.09) },
    elecNoise: r.range(0.6, 1.6),
    elecFireRisk: r.range(0.6, 1.4),
    jamCap: r.tolerance(0.08),
    jamHeat: r.tolerance(0.1),
    jamRunaway: r.tolerance(0.05),
    coilQuality: r.range(0.965, 1.015),
    coilHeat: r.tolerance(0.12),
    coilQuench: r.tolerance(0.06),
    capTolerance: r.tolerance(0.03),
    capArcRisk: r.range(0.8, 1.25),
    jumpChargeRate: r.tolerance(0.08),
    rcsEff: r.tolerance(0.08),
    sensorBias: r.gauss(0, 0.012),
    podCharge: [0, 1, 2, 3].map(() => r.range(0.32, 0.62)),
    podQuality: r.range(0.985, 1.0),
    boardRate: r.tolerance(0.15),
    gearStrength: r.tolerance(0.08),
    structure: r.tolerance(0.05),
    postSepMassMul: 1,
    hydLeakA: r.chance(0.12) ? r.range(0.0004, 0.002) : 0,
    hydLeakB: r.chance(0.12) ? r.range(0.0004, 0.002) : 0,
  };
  for (const id of equipped) {
    const sg = SIDEGRADES.find((s) => s.id === id);
    if (sg) sg.apply(m);
  }
  return m;
}
