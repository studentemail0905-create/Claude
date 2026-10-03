import type { RNG } from '../core/RNG';

/** Failure cause → dry bureaucratic commentary. Selected from telemetry tags. */
export const SNARK: Record<string, string[]> = {
  crash_runway: [
    'The runway has filed a formal complaint.',
    'Departure cancelled. The runway remains.',
    'Ground speed: zero. Eventually.',
    'Civil Flight Authority reminds you that the sky is up.',
    'Your takeoff has been reclassified as a demolition.',
  ],
  gear_up: [
    'Landing gear performs best near the ground.',
    'You retracted the wheels. The shuttle retracted onto you.',
    'Gear up, morale down.',
  ],
  crash_ground: [
    'Terrain: undefeated.',
    'The planet has declined your emigration request.',
    'Gravity has reviewed your application and approved it in full.',
  ],
  stall: [
    'Air requires speed to be useful. You discovered this personally.',
    'The wing stopped working. The ground did not.',
    'Angle of attack: ambitious. Altitude: subsequently zero.',
  ],
  breakup_q: [
    'Atmospheric drag has filed a structural objection.',
    'Dynamic pressure remains undefeated.',
    'You tried to push the atmosphere aside. It pushed back harder.',
    'Maximum Q achieved. Maximum shuttle not.',
  ],
  breakup_lateral: ['Sideways is not a direction the airframe was certified for.', 'The fins resigned with immediate effect.'],
  overload_g: [
    'The airframe was rated for that load. Briefly.',
    'Structural limits are not suggestions. They are now debris.',
    'You pulled. The wings pulled off.',
  ],
  structure: ['Airframe integrity has been downgraded to "memory".', 'Several important pieces left without filing a flight plan.'],
  thermal: [
    'Atmospheric heating remains undefeated.',
    'The heat shield would like to remind you it is a shield, not a suggestion.',
    'You arrived at the edge of space as a gas.',
    'Brute-forcing the atmosphere: still not recommended.',
  ],
  hypoxia: [
    'Cabin altitude exceeded pilot altitude.',
    'There was oxygen. It was behind a switch.',
    'You lost consciousness before you lost the government. Technically a draw.',
  ],
  fuel_starvation: ['The engines ran on optimism for a while. Then they did not.', 'Fuel: present. In the wrong tank.', 'Crossfeed exists for exactly this reason.'],
  engine_out: ['You switched that off yourself.', 'Both engines are now decorative.', 'Thrust is traditionally a requirement for flight.'],
  hydraulic: ['The control surfaces are now freely floating opinions.', 'Without hydraulics, the stick is an ornament.'],
  blackout: ['Electrical power is the reason the buttons do things.', 'Everything went dark. So did your prospects.', 'Battery master: the most important switch you ignored.'],
  engine_fire: ['Engine fire suppression works better when used.', 'The engine is now mostly fire.', 'Your shuttle has become a very expensive flare.'],
  elec_fire: ['Isolate the bus. Any bus. Please.', 'The wiring loom has emigrated before you.'],
  missile: [
    'The interceptor pilot has submitted positive performance feedback.',
    'Missile lock: effective.',
    'Planetary Flight Command thanks you for reconsidering emigration.',
    'The decoys were right there.',
  ],
  drone_capture: ['Inspection drone docked. Your paperwork is not in order.', 'Please remain seated while customs inspects your felonies.', 'Captured by a drone with a clipboard.'],
  remote_override: [
    'Your shuttle has been returned to the departure gate. Remotely.',
    'The datalink was mandatory. You made it so.',
    'Remote navigation authority thanks you for leaving the cable plugged in.',
  ],
  tracking: ['Your transponder would like to apologise for telling everyone where you were.', 'The government always knew. You were the last to find out.'],
  pax_disaster: [
    'Statistically, the passengers preferred the original route.',
    'Capsule telemetry: not encouraging.',
    'Evacuation is a procedure, not a vibe.',
  ],
  pax_in_module: [
    'Successful separation. Less successful survival.',
    'Passengers were still aboard. They are now aboard something falling.',
    'EMERGENCY SEPARATION: DO NOT OPERATE WHILE OCCUPIED. It was on the label.',
  ],
  debris: ['Space is mostly empty. You found the part that was not.', 'Orbital debris: now with added shuttle.'],
  module_collision: ['You separated from the module. The module did not separate from you.', 'Newton\'s third law has been enforced.'],
  separation_failed: ['The locks were still locked. That was the point of locks.', 'Half-separated is a whole problem.'],
  decompression: ['The cockpit seal is a switch for a reason.', 'You opened the cockpit to space. Space accepted.'],
  tumble: ['Rotation rate exceeded pilot tolerance.', 'In space nobody can stop you spinning except you.', 'RCS was available. RCS was not enabled.'],
  capacitor: ['The capacitor reached full charge, then several more full charges.', 'Overcharging the jump drive: works exactly once.', 'There is a CAP DUMP button. It was right there.'],
  navigation: ['You jumped. Where to was more of an open question.', 'Jump navigation solution: absent. Destination: everywhere, slightly.', 'You were technically somewhere else.'],
  jump_atmosphere: [
    'The jump drive does not work in air. Neither do you now.',
    'You attempted an interstellar jump inside a weather system.',
    'You were technically in space. The atmosphere disagreed.',
  ],
  jump_rate: ['Field symmetry requires the ship to stop spinning first.', 'The jump field liked your attitude less than you did.'],
  jump_alignment: ['Escape vector: approximately ignored.', 'You pointed the ship somewhere. The drive went somewhere else.'],
  jump_charge: ['Field charge was a matter of opinion.', 'The capacitor was not full of what it needed to be full of.'],
  jump_coilTemp: ['Superconducting coils prefer to stay superconducting.', 'Coil temperature: decisive.'],
  jump_power: ['The drive drew power. The bus did not have any.', 'Voltage sag at the critical moment. Classic.'],
  jump_coils: ['The coils were second-hand. Now they are no-hand.', 'Coil integrity insufficient for physics.'],
  jump_sync: ['Drive synchronisation is a button. It has a label.', 'Unsynchronised jump: the universe hit its own snooze button on you.'],
  generic: [
    'The permit office opens Monday.',
    'Unscheduled orbital departure remains a criminal offence.',
    'Your application to leave has been denied. Again.',
    'Form PFA-883 would have prevented this.',
    'The Ministry of Paperwork acknowledges your effort.',
  ],
};

export const NEAR_MISS = [
  'So close the government almost felt bad.',
  'One more switch. Probably.',
  'You could have survived that if you had done one thing differently.',
];

export const ESCAPE_LINES = [
  'Escape confirmed. Your planet has issued a parking ticket in absentia.',
  'Jump complete. Flight Command has opened an investigation into how.',
  'You left. The paperwork did not.',
  'Interstellar departure logged. Fine: everything you own.',
];

export function pickSnark(cause: string, rng: RNG, extraTags: string[] = []): string {
  const pool: string[] = [];
  for (const k of [cause, ...extraTags]) if (SNARK[k]) pool.push(...SNARK[k]);
  if (!pool.length) pool.push(...SNARK.generic);
  if (rng.chance(0.12)) pool.push(...SNARK.generic);
  return rng.pick(pool);
}

export const FAILURE_TITLES: Record<string, string> = {
  crash_runway: 'RUNWAY CRASH', gear_up: 'GEAR COLLAPSE', crash_ground: 'GROUND IMPACT', stall: 'AERODYNAMIC STALL',
  breakup_q: 'ATMOSPHERIC BREAKUP', breakup_lateral: 'STRUCTURAL FAILURE — SIDESLIP', overload_g: 'STRUCTURAL OVERLOAD',
  structure: 'AIRFRAME FAILURE', thermal: 'THERMAL DESTRUCTION', hypoxia: 'PILOT INCAPACITATED — HYPOXIA',
  fuel_starvation: 'FUEL STARVATION', engine_out: 'LOSS OF THRUST', hydraulic: 'HYDRAULIC FAILURE', blackout: 'ELECTRICAL BLACKOUT',
  engine_fire: 'ENGINE EXPLOSION', elec_fire: 'ELECTRICAL FIRE', missile: 'MISSILE IMPACT', drone_capture: 'INSPECTION DRONE CAPTURE',
  remote_override: 'REMOTE NAVIGATION OVERRIDE', pax_disaster: 'PASSENGER EVACUATION DISASTER', pax_in_module: 'SEPARATION WHILE OCCUPIED',
  module_collision: 'COLLISION WITH SEPARATED MODULE', debris: 'DEBRIS COLLISION', separation_failed: 'FAILED SEPARATION', decompression: 'DECOMPRESSION',
  tumble: 'UNCONTROLLED TUMBLE', capacitor: 'CAPACITOR OVERLOAD', navigation: 'NAVIGATION FAILURE', jump_atmosphere: 'JUMP FIELD COLLAPSE — ATMOSPHERE',
  jump_rate: 'UNSTABLE JUMP — ROTATION', jump_alignment: 'UNSTABLE JUMP — MISALIGNED', jump_charge: 'UNSTABLE JUMP — CHARGE',
  jump_coilTemp: 'JUMP COIL EXPLOSION', jump_power: 'UNSTABLE JUMP — POWER', jump_coils: 'JUMP COIL FAILURE', jump_sync: 'UNSTABLE JUMP — DESYNC',
  abandoned: 'RUN ABANDONED',
};
