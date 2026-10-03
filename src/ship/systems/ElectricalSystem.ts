import { BAL } from '../../data/Balance';
import { clamp01 } from '../../core/mathutil';
import type { Ship } from '../Ship';

export type BusId = 'A' | 'B' | 'AV' | 'CAB' | 'JUMP' | 'JAM' | 'EMER';
const SUB: BusId[] = ['AV', 'CAB', 'JUMP', 'JAM'];

/**
 * DC electrical network.
 * Sources: battery, external ground power, APU, GEN A (engine A), GEN B (engine B).
 * Main buses A/B (optionally tied). Sub-buses: AVIONICS(A), CABIN(B, via umbilical),
 * JAMMER(B), JUMP(A+B). EMER bus is fed directly from the battery.
 * Loads registered by consumers during a tick are applied on the next tick.
 */
export class ElectricalSystem {
  battCharge = 0.92;
  apuState: 'off' | 'starting' | 'running' = 'off';
  apuTimer = 0;
  extConnected = true;
  volts: Record<BusId, number> = { A: 0, B: 0, AV: 0, CAB: 0, JUMP: 0, JAM: 0, EMER: 0 };
  private pending: Record<BusId, number> = { A: 0, B: 0, AV: 0, CAB: 0, JUMP: 0, JAM: 0, EMER: 0 };
  loads: Record<BusId, number> = { A: 0, B: 0, AV: 0, CAB: 0, JUMP: 0, JAM: 0, EMER: 0 };
  tripped: Record<string, boolean> = { AV: false, CAB: false, JUMP: false, JAM: false };
  genOnline = { A: false, B: false };
  genTripped = { A: false, B: false };
  genOutput = { A: 0, B: 0 };
  sourceCap = { A: 0, B: 0 };
  overloadTimer = { A: 0, B: 0 };
  overloadRatio = { A: 0, B: 0 };
  fire: { bus: 'A' | 'B' | null; t: number; deadTime: number } = { bus: null, t: 0, deadTime: 0 };
  /** extra noise from solar flare etc. */
  noise = 0;
  shortCircuit = { A: 0, B: 0 }; // kW of fault current (coffee, torn umbilical)
  battDraw = 0;
  private lastSwitch: Record<string, number> = {};

  reset(): void {
    Object.assign(this, new ElectricalSystem());
  }

  demand(bus: BusId, kw: number): void {
    this.pending[bus] += kw;
  }

  factor(bus: BusId): number {
    return clamp01((this.volts[bus] - 18) / (26 - 18));
  }

  powered(bus: BusId, minV = 18): boolean {
    return this.volts[bus] >= minV;
  }

  update(dt: number, ship: Ship): void {
    const c = ship.controls;
    // swap load buffers
    for (const k of Object.keys(this.pending) as BusId[]) {
      this.loads[k] = this.pending[k];
      this.pending[k] = 0;
    }

    // Resetting a tripped sub-bus: cycle its switch.
    const subSwitch: Record<string, string> = { AV: 'avionics', CAB: 'cabinBus', JUMP: 'jumpBus', JAM: 'jammerBus' };
    for (const s of SUB) {
      const sw = c.get(subSwitch[s]);
      if (sw === 0 && this.tripped[s]) this.tripped[s] = false;
    }
    for (const g of ['A', 'B'] as const) {
      if (c.get('gen' + g) === 0) this.genTripped[g] = false;
    }

    // APU
    const apuSel = c.get('apu');
    if (apuSel === 0) this.apuState = 'off';
    else if (apuSel === 2 && this.apuState === 'off' && this.volts.EMER > 20 && ship.fuel.core > 50) {
      this.apuState = 'starting';
      this.apuTimer = 0;
      ship.bus.emit('sfx', { id: 'apu_start' });
    }
    if (this.apuState === 'starting') {
      this.apuTimer += dt;
      this.demand('EMER', 6);
      if (this.apuTimer > 8) this.apuState = 'running';
    }
    if (this.apuState !== 'off') ship.fuel.consumeApu(0.12 * dt);
    if (this.apuState === 'running' && ship.fuel.core <= 0) this.apuState = 'off';

    // External power: torn if the ship rolls away with the cable attached.
    if (this.extConnected && ship.distanceFromStart > 4) {
      this.extConnected = false;
      if (c.get('extpwr') === 1) {
        ship.bus.emit('sfx', { id: 'spark' });
        ship.bus.emit('shake', { amount: 0.15 });
        ship.damage.hit('busA', 0.05);
        ship.flags.extCableTorn = true;
        this.overloadTimer.A = 3; // transient trip
      }
    }

    // Generators
    const m = ship.machine;
    for (const g of ['A', 'B'] as const) {
      const eng = ship.engines[g];
      const N = eng.state === 'running' ? eng.N : eng.state === 'starting' ? eng.N * 0.5 : 0;
      const sw = c.get('gen' + g) === 1;
      const out = sw && !this.genTripped[g] && N > 0.4 ? BAL.genCap * clamp01((N - 0.4) / 0.35) * m.genCap[g] * ship.damage.health['gen' + g] : 0;
      this.genOutput[g] = out;
      this.genOnline[g] = out > 5;
    }

    const battOn = c.get('batt') === 1 && this.battCharge > 0.01;
    const battV = battOn ? 23.2 + 2.6 * this.battCharge : 0;
    const extAvail = this.extConnected && c.get('extpwr') === 1;
    let srcA = this.genOutput.A + (extAvail ? BAL.extPwrCap : 0) + (this.apuState === 'running' ? BAL.apuCap : 0);
    let srcB = this.genOutput.B;
    srcA *= ship.damage.health.busA;
    srcB *= ship.damage.health.busB;

    // sub-bus loads routed to mains
    const subOn = (s: BusId, sw: string) => c.get(sw) === 1 && !this.tripped[s];
    const umbilical = ship.sep.moduleAttached && c.get('sepElec') === 0 && !ship.sep.umbilicalTorn;
    const avOn = subOn('AV', 'avionics');
    const cabOn = subOn('CAB', 'cabinBus') && umbilical;
    const jamOn = subOn('JAM', 'jammerBus');
    const jumpOn = subOn('JUMP', 'jumpBus');
    let loadA = this.loads.A + (avOn ? this.loads.AV : 0) + (jumpOn ? this.loads.JUMP / 2 : 0) + this.shortCircuit.A;
    let loadB = this.loads.B + (cabOn ? this.loads.CAB : 0) + (jamOn ? this.loads.JAM : 0) + (jumpOn ? this.loads.JUMP / 2 : 0) + this.shortCircuit.B;

    const tie = c.get('busTie') === 1;
    const battAvail = battOn ? BAL.battMaxKw * Math.min(1, this.battCharge * 4) : 0;
    const noise = (ship.rng.next() - 0.5) * (0.25 + this.noise * 3) * m.elecNoise;

    const solve = (src: number, load: number, battShare: number): [number, number, number] => {
      // returns [volts, ratio, battery draw]
      const genV = 28 + noise;
      if (src <= 0.1 && battShare <= 0) return [0, load > 0 ? 9 : 0, 0];
      let draw = 0;
      let cap = src;
      if (load > src && battShare > 0) {
        draw = Math.min(battShare, load - src);
        cap = src + draw;
      }
      const baseV = src > 0.1 ? genV : battV;
      if (load <= cap || load <= 0) return [baseV, cap > 0 ? load / cap : 0, draw];
      const ratio = load / Math.max(0.1, cap);
      return [baseV * Math.pow(1 / ratio, 0.6), ratio, draw];
    };

    let vA: number, vB: number, rA: number, rB: number;
    this.battDraw = 0;
    if (tie) {
      const [v, r, d] = solve(srcA + srcB, loadA + loadB, battAvail);
      vA = vB = v;
      rA = rB = r;
      this.battDraw = d;
    } else {
      const [va, ra, da] = solve(srcA, loadA, battAvail * 0.5);
      const [vb, rb, db] = solve(srcB, loadB, battAvail * 0.5);
      vA = va; vB = vb; rA = ra; rB = rb;
      this.battDraw = da + db;
    }
    this.sourceCap.A = srcA;
    this.sourceCap.B = srcB;
    this.overloadRatio.A = rA;
    this.overloadRatio.B = rB;

    // Battery
    const emerLoad = this.loads.EMER;
    if (battOn) {
      const charging = (vA > 26.5 ? 6 : 0) + (vB > 26.5 && !tie ? 4 : 0);
      this.battCharge += ((charging - this.battDraw - emerLoad) * dt) / BAL.battCapacityKJ;
      this.battCharge = clamp01(this.battCharge);
    }
    this.volts.EMER = battOn ? battV : Math.max(vA, vB) > 20 ? Math.max(vA, vB) - 1 : 0;

    // Overload protection: shed lowest-priority sub-bus.
    for (const [g, r] of [['A', rA], ['B', rB]] as const) {
      if (r > 1.15 && (g === 'A' ? vA : vB) > 1) this.overloadTimer[g] += dt;
      else this.overloadTimer[g] = Math.max(0, this.overloadTimer[g] - dt * 2);
      if (this.overloadTimer[g] > 2.2) {
        this.overloadTimer[g] = 0;
        // the most heavily loaded branch trips first (overcurrent), avionics last
        const cands: BusId[] = (tie ? ['JAM', 'CAB', 'JUMP'] : g === 'A' ? ['JUMP'] : ['JAM', 'CAB', 'JUMP']) as BusId[];
        const isOn = (s: BusId) => (s === 'AV' ? avOn : s === 'CAB' ? cabOn : s === 'JAM' ? jamOn : jumpOn);
        let victim: BusId | undefined = cands.filter((s) => isOn(s) && !this.tripped[s]).sort((a, b) => this.loads[b] - this.loads[a])[0];
        if (!victim && avOn && !this.tripped.AV && (tie || g === 'A')) victim = 'AV';
        if (victim) {
          this.tripped[victim] = true;
          ship.bus.emit('sfx', { id: 'breaker_pop' });
          ship.log(`BUS ${victim} FEEDER TRIP`);
        } else if (this.genOnline[g]) {
          this.genTripped[g] = true;
          ship.bus.emit('sfx', { id: 'breaker_pop' });
        }
        if (r > 1.6 && !this.fire.bus && ship.rng.chance(0.35 * m.elecFireRisk)) {
          this.fire.bus = g;
          this.fire.t = 0;
          ship.bus.emit('sfx', { id: 'spark' });
        }
      }
    }
    // short circuits may start fires
    for (const g of ['A', 'B'] as const) {
      if (this.shortCircuit[g] > 0 && (g === 'A' ? vA : vB) > 10 && !this.fire.bus && ship.rng.chance(0.02 * dt * this.shortCircuit[g] / 10)) {
        this.fire.bus = g;
        this.fire.t = 0;
      }
    }
    // Electrical fire: burns while bus is energised.
    if (this.fire.bus) {
      const busV = this.fire.bus === 'A' ? vA : vB;
      this.fire.t += dt;
      if (busV < 2) this.fire.deadTime += dt;
      else this.fire.deadTime = Math.max(0, this.fire.deadTime - dt);
      ship.damage.hit(this.fire.bus === 'A' ? 'busA' : 'busB', 0.006 * dt);
      ship.damage.hit('structure', 0.002 * dt);
      if (this.fire.deadTime > 4) {
        this.fire = { bus: null, t: 0, deadTime: 0 };
        this.shortCircuit.A = this.shortCircuit.B = 0;
        ship.log('ELEC FIRE OUT');
      }
    }

    this.volts.A = vA;
    this.volts.B = vB;
    this.volts.AV = avOn ? vA : 0;
    this.volts.CAB = cabOn ? vB : 0;
    this.volts.JAM = jamOn ? vB : 0;
    this.volts.JUMP = jumpOn ? Math.min(vA, vB) : 0;

    // Steady housekeeping loads
    this.demand('EMER', 0.4);
    void this.lastSwitch;
  }

  /** Total generating capacity (for displays). */
  get totalLoad(): number {
    return this.loads.A + this.loads.B + this.loads.AV + this.loads.CAB + this.loads.JAM + this.loads.JUMP;
  }
}
