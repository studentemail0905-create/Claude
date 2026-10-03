/**
 * Every physical cockpit input. The simulation reads ONLY these values —
 * no stage gating. Displays/annunciators are outputs and live elsewhere.
 */
export type ControlKind =
  | 'toggle' // 2–3 detented positions
  | 'rotary' // detented selector
  | 'knob' // continuous 0..1
  | 'lever' // continuous 0..1 dragged
  | 'button' // momentary push
  | 'latch' // push-on / push-off
  | 'pull' // pull handle (0 in, 1 pulled)
  | 'breaker' // 1 = in (closed), 0 = pulled/popped
  | 'guard' // 0 closed, 1 open
  | 'stick'; // 2-axis, handled specially

export interface ControlDef {
  id: string;
  kind: ControlKind;
  label: string;
  positions?: string[];
  default: number;
  /** Rotary/toggle position that springs back (e.g. APU START → ON). */
  springFrom?: number;
  springTo?: number;
  /** id of the guard covering this control. */
  guard?: string;
  /** Closing the guard forces the control back to this value. */
  guardSafe?: number;
  /** Continuous controls: wheel step. */
  step?: number;
  min?: number;
  max?: number;
}

const T = (id: string, label: string, positions: string[], def = 0, extra: Partial<ControlDef> = {}): ControlDef => ({
  id, kind: 'toggle', label, positions, default: def, ...extra,
});
const R = (id: string, label: string, positions: string[], def = 0, extra: Partial<ControlDef> = {}): ControlDef => ({
  id, kind: 'rotary', label, positions, default: def, ...extra,
});
const B = (id: string, label: string, extra: Partial<ControlDef> = {}): ControlDef => ({ id, kind: 'button', label, default: 0, ...extra });
const L = (id: string, label: string, def = 0, extra: Partial<ControlDef> = {}): ControlDef => ({ id, kind: 'latch', label, default: def, ...extra });
const G = (id: string, label: string): ControlDef => ({ id, kind: 'guard', label, default: 0 });
const CB = (id: string, label: string): ControlDef => ({ id, kind: 'breaker', label, default: 1 });
const K = (id: string, label: string, def: number, extra: Partial<ControlDef> = {}): ControlDef => ({
  id, kind: 'knob', label, default: def, min: 0, max: 1, step: 0.05, ...extra,
});
const LV = (id: string, label: string, def: number, extra: Partial<ControlDef> = {}): ControlDef => ({
  id, kind: 'lever', label, default: def, min: 0, max: 1, step: 0.04, ...extra,
});
const P = (id: string, label: string, extra: Partial<ControlDef> = {}): ControlDef => ({ id, kind: 'pull', label, default: 0, ...extra });

export const OFF_ON = ['OFF', 'ON'];

export const CONTROL_DEFS: ControlDef[] = [
  // ── OVERHEAD: ELECTRICAL ───────────────────────────────
  T('batt', 'BATTERY MASTER', OFF_ON, 1),
  T('extpwr', 'EXT POWER', OFF_ON, 1),
  R('apu', 'APU', ['OFF', 'ON', 'START'], 0, { springFrom: 2, springTo: 1 }),
  T('genA', 'GEN A', OFF_ON, 1),
  T('genB', 'GEN B', OFF_ON, 1),
  T('busTie', 'BUS TIE', ['OPEN', 'CLOSED'], 1),
  T('avionics', 'AVIONICS MASTER', OFF_ON, 1),
  T('cabinBus', 'CABIN BUS', OFF_ON, 1),
  G('jumpBus_g', 'JUMP BUS GUARD'),
  T('jumpBus', 'JUMP DRIVE BUS', OFF_ON, 0, { guard: 'jumpBus_g', guardSafe: 0 }),
  // ── OVERHEAD: HYDRAULIC ────────────────────────────────
  T('hydA', 'HYD PUMP A', OFF_ON, 0),
  T('hydB', 'HYD PUMP B', OFF_ON, 0),
  // ── OVERHEAD: PRESSURISATION / ENV ─────────────────────
  R('pressMode', 'PRESS MODE', ['AUTO', 'MAN', 'DUMP'], 0),
  T('o2', 'PILOT O2', OFF_ON, 0),
  T('cockpitSeal', 'COCKPIT SEAL', ['OPEN', 'SEALED'], 0),
  T('cabinIsol', 'CABIN ISOLATION', ['OPEN', 'ISOL'], 0),

  // ── LEFT CONSOLE: ENGINES ──────────────────────────────
  T('engMaster', 'ENGINE MASTER', ['OFF', 'ARM'], 0),
  B('ignA', 'START A'),
  B('ignB', 'START B'),
  LV('throttleA', 'THROTTLE A', 0),
  LV('throttleB', 'THROTTLE B', 0),
  R('thrustLimit', 'THRUST LIMIT', ['GEN', '60', '85', '100', '110'], 3),
  // ── LEFT CONSOLE: FUEL ─────────────────────────────────
  T('fuelPumpA', 'FUEL PUMP A', OFF_ON, 0),
  T('fuelPumpB', 'FUEL PUMP B', OFF_ON, 0),
  T('crossfeed', 'CROSSFEED', ['CLOSED', 'OPEN'], 0),
  T('isoA', 'FUEL ISOL A', ['CLOSED', 'OPEN'], 1),
  T('isoB', 'FUEL ISOL B', ['CLOSED', 'OPEN'], 1),
  T('fuelXfer', 'XFER SVC→CORE', OFF_ON, 0),
  G('svcFuel_g', 'SVC FUEL GUARD'),
  T('svcFuel', 'SVC FUEL LINE', ['CONN', 'DISC'], 0, { guard: 'svcFuel_g' }),
  // ── LEFT CONSOLE: COOLING / FIRE ───────────────────────
  T('coolA', 'COOLANT LOOP A', OFF_ON, 1),
  T('coolB', 'COOLANT LOOP B', OFF_ON, 1),
  R('coolPrio', 'COOLANT PRIORITY', ['ENG', 'BAL', 'DRIVE'], 1),
  P('fireA', 'FIRE A'),
  P('fireB', 'FIRE B'),

  // ── FLIGHT CONTROLS ────────────────────────────────────
  { id: 'stick', kind: 'stick', label: 'CONTROL STICK', default: 0 },
  K('pitchTrim', 'PITCH TRIM', 0.5, { step: 0.01 }),
  K('yawTrim', 'YAW TRIM', 0.5, { step: 0.01 }),
  LV('speedBrake', 'SPEED BRAKE', 0, { step: 0.1 }),
  T('gear', 'LANDING GEAR', ['UP', 'DOWN'], 1),
  T('parkBrake', 'PARK BRAKE', ['OFF', 'SET'], 1),
  R('fcsMode', 'FCS MODE', ['DIRECT', 'NORM'], 1),
  T('sas', 'STAB AUG', OFF_ON, 1),
  T('tvc', 'THRUST VECTOR', OFF_ON, 1),
  T('rcsMaster', 'RCS ENABLE', OFF_ON, 0),
  R('rcsMode', 'RCS MODE', ['OFF', 'ROT', 'ROT+TRN'], 0),
  L('apMaster', 'AUTOPILOT'),
  T('fd', 'FLIGHT DIRECTOR', OFF_ON, 1),
  R('navSource', 'NAV SOURCE', ['LEGAL', 'INS', 'ESCAPE'], 0),
  T('routeMkr', 'ROUTE MARKERS', OFF_ON, 1),
  T('navComp', 'NAV COMPUTER', OFF_ON, 1),
  B('escLoad', 'ESC VECTOR LOAD'),
  B('jumpSolve', 'JUMP SOLVE'),
  B('masterCaution', 'MASTER CAUTION'),
  B('masterWarn', 'MASTER WARNING'),
  K('hudBright', 'HUD BRT', 0.8),

  // ── RIGHT CONSOLE: COMMS / TRANSPONDER ─────────────────
  T('comms', 'COMMS POWER', OFF_ON, 1),
  K('rxVol', 'RX VOLUME', 0.75),
  T('tx', 'TRANSMITTER', OFF_ON, 1),
  R('freq', 'FREQUENCY', ['GOV 121.7', 'ALT 133.2', 'EMER 243.0'], 0),
  B('ptt', 'ACK / PTT'),
  R('xpdrMode', 'XPDR MODE', ['OFF', 'STBY', 'ON', 'ALT', 'SECURE'], 3),
  B('ident', 'IDENT'),
  G('datalink_g', 'DATALINK GUARD'),
  T('datalink', 'AUTHORITY DATALINK', ['OFF', 'ON'], 1, { guard: 'datalink_g' }),
  R('authCode', 'AUTH RESPONSE', ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], 0),
  B('authTx', 'AUTH TX'),

  // ── JAMMER (aftermarket, illegal) ──────────────────────
  T('jammerBus', 'JAMMER BUS', OFF_ON, 0),
  T('jamCool', 'JAM COOLING', OFF_ON, 0),
  R('jamProfile', 'FIELD PROFILE', ['NARROW', 'WIDE', 'SPOOF'], 0),
  T('jamCharge', 'CAP CHARGE', OFF_ON, 0),
  G('jamArm_g', 'JAM ARM GUARD'),
  T('jamArm', 'JAM ARM', ['SAFE', 'ARM'], 0, { guard: 'jamArm_g', guardSafe: 0 }),
  L('jamEngage', 'ENGAGE'),
  G('jamOver_g', 'OVERDRIVE GUARD'),
  L('jamOverdrive', 'OVERDRIVE', 0, { guard: 'jamOver_g', guardSafe: 0 }),
  B('decoy', 'DECOY'),

  // ── EVACUATION ─────────────────────────────────────────
  L('restraint', 'RESTRAINT CMD'),
  T('podPower', 'POD POWER', OFF_ON, 0),
  T('podGuidance', 'POD GUIDANCE', OFF_ON, 0),
  R('returnProg', 'RETURN PROGRAM', ['OFF', 'NEAREST', 'OCEAN'], 0),
  G('evacArm_g', 'EVAC ARM GUARD'),
  T('evacArm', 'EVAC ARM', ['SAFE', 'ARMED'], 0, { guard: 'evacArm_g', guardSafe: 0 }),
  G('podRelease_g', 'POD RELEASE GUARD'),
  B('podRelease', 'POD RELEASE', { guard: 'podRelease_g' }),

  // ── SEPARATION ─────────────────────────────────────────
  T('sepElec', 'UMBILICAL', ['CONN', 'DEADFACE'], 0),
  G('mechLock_g', 'MECH LOCK GUARD'),
  T('mechLock', 'MECH LOCKS', ['LOCKED', 'RELEASE'], 0, { guard: 'mechLock_g' }),
  G('sepArm_g', 'SEP ARM GUARD'),
  T('sepArm', 'SEP CHARGES', ['SAFE', 'ARMED'], 0, { guard: 'sepArm_g', guardSafe: 0 }),
  G('sepHandle_g', 'SEP HANDLE GUARD'),
  P('sepHandle', 'EMERGENCY SEPARATION', { guard: 'sepHandle_g' }),

  // ── JUMP DRIVE ─────────────────────────────────────────
  T('jumpCharge', 'CAPACITOR CHARGE', OFF_ON, 0),
  G('coilArm_g', 'COIL ARM GUARD'),
  T('coilArm', 'FIELD COILS', ['SAFE', 'ARMED'], 0, { guard: 'coilArm_g', guardSafe: 0 }),
  B('jumpSync', 'DRIVE SYNC'),
  P('safetyPin', 'SAFETY INTERLOCK'),
  B('capDump', 'CAP DUMP'),
  G('jumpEngage_g', 'ENGAGE GUARD'),
  B('jumpEngage', 'JUMP', { guard: 'jumpEngage_g' }),

  // ── CIRCUIT BREAKERS ───────────────────────────────────
  CB('cb_fcs', 'FCS'),
  CB('cb_nav', 'NAV'),
  CB('cb_disp', 'DISPLAYS'),
  CB('cb_xpdr', 'XPDR'),
  CB('cb_comms', 'COMMS'),
  CB('cb_dlink', 'DATALINK'),
  CB('cb_rcs', 'RCS'),
  CB('cb_pods', 'POD SYS'),
  CB('cb_jam', 'JAM CTL'),
  CB('cb_jump', 'JUMP CTL'),
  CB('cb_fuelx', 'FUEL XFER'),
  CB('cb_press', 'PRESS CTL'),
];

export const CONTROL_MAP: Record<string, ControlDef> = Object.fromEntries(CONTROL_DEFS.map((d) => [d.id, d]));

export class ControlState {
  values: Record<string, number> = {};
  /** Physically jammed controls — operator input is ignored. */
  stuck = new Set<string>();
  /** Momentary edges (button pressed) since last sim step. */
  private edges = new Set<string>();
  /** Stick deflection: pitch (+ = pull/nose up), roll (+ = right). */
  stickPitch = 0;
  stickRoll = 0;
  /** Rudder pedals (+ = right). */
  pedals = 0;
  /** Wheel brake pedal pressure 0..1 */
  toeBrake = 0;
  /** RCS translation command (body axes: x right, y up, z aft) */
  trans = { x: 0, y: 0, z: 0 };
  /** Last time each control changed (for analytics / ATC checks). */
  changedAt: Record<string, number> = {};
  simTime = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    for (const d of CONTROL_DEFS) this.values[d.id] = d.default;
    this.stuck.clear();
    this.edges.clear();
    this.stickPitch = this.stickRoll = this.pedals = this.toeBrake = 0;
    this.trans.x = this.trans.y = this.trans.z = 0;
    this.changedAt = {};
  }

  get(id: string): number {
    return this.values[id] ?? 0;
  }

  on(id: string): boolean {
    return (this.values[id] ?? 0) >= 1;
  }

  /** Operator input. Returns false if physically blocked. */
  set(id: string, v: number, force = false): boolean {
    if (!force && this.stuck.has(id)) return false;
    const def = CONTROL_MAP[id];
    if (def) {
      if (def.positions) v = Math.max(0, Math.min(def.positions.length - 1, Math.round(v)));
      else if (def.kind === 'knob' || def.kind === 'lever') v = Math.max(def.min ?? 0, Math.min(def.max ?? 1, v));
    }
    if (this.values[id] !== v) {
      this.values[id] = v;
      this.changedAt[id] = this.simTime;
    }
    return true;
  }

  press(id: string): boolean {
    if (this.stuck.has(id)) return false;
    this.edges.add(id);
    this.changedAt[id] = this.simTime;
    return true;
  }

  /** Read & consume a momentary press. */
  pressed(id: string): boolean {
    return this.edges.has(id);
  }

  clearEdges(): void {
    this.edges.clear();
  }

  /** Is a guarded control physically reachable (guard open)? */
  guardOpen(guardId: string): boolean {
    return this.get(guardId) >= 1;
  }
}
