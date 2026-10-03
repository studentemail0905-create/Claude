import type { MachineRoll } from '../ship/MachineRoll';

export interface Sidegrade {
  id: string;
  name: string;
  slot: 'jammer' | 'cooling' | 'frame' | 'jump' | 'engine' | 'rcs' | 'pods';
  cost: number;
  pros: string;
  cons: string;
  apply: (m: MachineRoll) => void;
}

/** Black-market sidegrades: every benefit has a cost. No straight upgrades. */
export const SIDEGRADES: Sidegrade[] = [
  { id: 'bm_jammer', name: 'Black-Market Jammer', slot: 'jammer', cost: 120, pros: '+12% field duration', cons: '+18% heat generation',
    apply: (m) => { m.jamCap *= 1.12; m.jamHeat *= 1.18; } },
  { id: 'race_cool', name: 'Racing Coolant Pump', slot: 'cooling', cost: 90, pros: '+15% coolant flow', cons: 'Electrical noise, earlier runaway risk',
    apply: (m) => { m.coolEff.A *= 1.15; m.coolEff.B *= 1.15; m.elecNoise *= 1.3; m.elecFireRisk *= 1.2; } },
  { id: 'light_frame', name: 'Lightweight Separation Frame', slot: 'frame', cost: 150, pros: '-8% post-separation mass (faster charge)', cons: '-15% structural tolerance',
    apply: (m) => { m.postSepMassMul = 0.92; m.structure *= 0.85; } },
  { id: 'hot_cap', name: 'Hot Jump Capacitor', slot: 'jump', cost: 160, pros: '+20% charging speed', cons: '+25% arc probability, lower overcharge margin',
    apply: (m) => { m.jumpChargeRate *= 1.2; m.capTolerance *= 0.97; m.capArcRisk *= 1.25; } },
  { id: 'rebored', name: 'Rebored Injectors', slot: 'engine', cost: 110, pros: '+6% thrust', cons: '+14% engine heat',
    apply: (m) => { m.engEff.A *= 1.06; m.engEff.B *= 1.06; m.engHeat.A *= 1.14; m.engHeat.B *= 1.14; } },
  { id: 'cold_coils', name: 'Surplus Cryo Coils', slot: 'jump', cost: 140, pros: 'Coils run cooler', cons: 'Lower peak coil quality',
    apply: (m) => { m.coilHeat *= 0.8; m.coilQuality *= 0.985; } },
  { id: 'hot_rcs', name: 'Uncertified RCS Valves', slot: 'rcs', cost: 70, pros: '+15% RCS authority', cons: 'Sloppier pod charging (shared harness)',
    apply: (m) => { m.rcsEff *= 1.15; m.podCharge = m.podCharge.map((c) => c * 0.85); } },
  { id: 'pod_fw', name: 'Pirated Capsule Firmware', slot: 'pods', cost: 80, pros: 'Capsules start fully charged', cons: 'Passengers board 20% slower (they read the license)',
    apply: (m) => { m.podCharge = m.podCharge.map(() => 0.95); m.boardRate *= 0.8; } },
];

export interface Cosmetic {
  id: string;
  name: string;
  kind: 'paint' | 'reticle' | 'snark' | 'warning';
  cost: number;
}

export const COSMETICS: Cosmetic[] = [
  { id: 'paint_standard', name: 'Authority Grey (standard issue)', kind: 'paint', cost: 0 },
  { id: 'paint_olive', name: 'Ministry Olive', kind: 'paint', cost: 40 },
  { id: 'paint_oxblood', name: 'Oxblood Enamel', kind: 'paint', cost: 60 },
  { id: 'paint_sand', name: 'Desert Requisition Tan', kind: 'paint', cost: 60 },
  { id: 'reticle_dot', name: 'Reticle: Dot', kind: 'reticle', cost: 0 },
  { id: 'reticle_cross', name: 'Reticle: Crosshair', kind: 'reticle', cost: 25 },
  { id: 'reticle_ring', name: 'Reticle: Ring', kind: 'reticle', cost: 25 },
  { id: 'warn_amber', name: 'Displays: Amber CRT', kind: 'warning', cost: 50 },
  { id: 'warn_white', name: 'Displays: Mono White CRT', kind: 'warning', cost: 50 },
  { id: 'snark_ministry', name: 'Snark Pack: Ministry of Paperwork', kind: 'snark', cost: 80 },
];
