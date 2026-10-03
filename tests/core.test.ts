import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { RNG } from '../src/core/RNG';
import { sampleAtmosphere } from '../src/physics/Atmosphere';
import { gravityMagnitude, PLANET } from '../src/physics/PlanetPhysics';
import { Run } from '../src/core/Run';
import { JumpDriveSystem } from '../src/ship/systems/JumpDriveSystem';
import { migrate, defaultSave, SaveManager, SAVE_KEY } from '../src/core/SaveManager';
import { calculateReward, newZoneTracker, updateZones } from '../src/progression/RewardCalculator';
import { EventDirector, ALL_EVENTS } from '../src/events/EventDirector';
import { simulateRun } from '../src/debug/BotPilot';

const stepN = (run: Run, seconds: number) => {
  const n = Math.round(seconds * 120);
  for (let i = 0; i < n && !run.ended; i++) run.step(1 / 120);
};

describe('seeded RNG', () => {
  it('is deterministic per seed and fork', () => {
    const a = new RNG(42), b = new RNG(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    expect(new RNG(42).fork('x').next()).toBe(new RNG(42).fork('x').next());
    expect(new RNG(42).fork('x').next()).not.toBe(new RNG(42).fork('y').next());
  });
  it('stays in range', () => {
    const r = new RNG(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('atmosphere & gravity', () => {
  it('matches standard atmosphere anchor values', () => {
    expect(sampleAtmosphere(0).density).toBeCloseTo(1.225, 2);
    expect(sampleAtmosphere(11_000).density).toBeCloseTo(0.3639, 2);
    expect(sampleAtmosphere(30_000).density).toBeGreaterThan(0.015);
    expect(sampleAtmosphere(30_000).density).toBeLessThan(0.02);
    expect(sampleAtmosphere(100_000).density).toBeCloseTo(5.6e-7, 7);
  });
  it('decays monotonically with altitude', () => {
    let prev = Infinity;
    for (let h = 0; h <= 400_000; h += 2000) {
      const d = sampleAtmosphere(h).density;
      expect(d).toBeLessThan(prev);
      prev = d;
    }
  });
  it('gravity follows μ/r²', () => {
    expect(gravityMagnitude(PLANET.radius)).toBeCloseTo(9.82, 1);
    const g100 = gravityMagnitude(PLANET.radius + 100_000);
    expect(g100 / gravityMagnitude(PLANET.radius)).toBeCloseTo((PLANET.radius / (PLANET.radius + 100_000)) ** 2, 6);
  });
});

describe('ship systems', () => {
  it('turning a hydraulic pump on builds pressure; off bleeds it', () => {
    const run = new Run(1);
    run.ship.controls.set('hydA', 1);
    stepN(run, 3);
    expect(run.ship.hyd.A.pressure).toBeGreaterThan(18);
    expect(run.ship.hyd.B.pressure).toBeLessThan(1);
    run.ship.controls.set('hydA', 0);
    stepN(run, 20);
    expect(run.ship.hyd.A.pressure).toBeLessThan(5);
  });

  it('electrical overload sags voltage and trips a feeder', () => {
    const run = new Run(2);
    const s = run.ship;
    // ground power + battery only: generators offline
    s.controls.set('jumpBus_g', 1);
    s.controls.set('jumpBus', 1);
    s.controls.set('jumpCharge', 1);
    stepN(run, 1);
    expect(s.elec.volts.A).toBeLessThan(23);
    stepN(run, 3);
    expect(s.elec.tripped.JUMP).toBe(true);
    expect(s.elec.volts.A).toBeGreaterThan(27); // load shed, voltage recovers
  });

  it('avionics master off kills displays and wipes nav computer state', () => {
    const run = new Run(3);
    const s = run.ship;
    stepN(run, 5);
    s.controls.press('escLoad');
    stepN(run, 7);
    expect(s.avionics.escLoaded).toBe(true);
    s.controls.set('avionics', 0);
    stepN(run, 1);
    expect(s.avionics.displaysOn).toBe(false);
    expect(s.avionics.escLoaded).toBe(false);
  });

  it('crossfeed lets engine B draw core fuel when the service line is disconnected', () => {
    const run = new Run(4);
    const s = run.ship;
    s.controls.set('svcFuel_g', 1);
    s.controls.set('svcFuel', 1);
    stepN(run, 1);
    expect(s.fuel.feed.B.pressure).toBeLessThan(0.1);
    s.controls.set('crossfeed', 1);
    s.controls.set('fuelPumpA', 1);
    stepN(run, 1);
    expect(s.fuel.feed.B.pressure).toBeGreaterThan(1);
  });

  it('jammer duration is ~35–45 s and varies by seed', () => {
    const durations: number[] = [];
    for (const seed of [10, 11, 12, 13]) {
      const run = new Run(seed);
      const s = run.ship;
      s.jammer.cap = 1;
      for (const [k, v] of [['jammerBus', 1], ['jamCool', 1], ['jamArm_g', 1], ['jamArm', 1], ['jamEngage', 1]] as const) s.controls.set(k, v);
      let t = 0;
      while (t < 120) {
        run.step(1 / 60);
        t += 1 / 60;
        if (t > 1 && !s.jammer.active) break;
      }
      durations.push(t);
    }
    for (const d of durations) {
      expect(d).toBeGreaterThan(30);
      expect(d).toBeLessThan(50);
    }
    expect(new Set(durations.map((d) => d.toFixed(1))).size).toBeGreaterThan(1);
  });

  it('retracting the gear on the runway drops the ship onto its belly', () => {
    const run = new Run(5);
    const s = run.ship;
    s.controls.set('hydA', 1);
    stepN(run, 2);
    s.controls.set('gear', 0);
    stepN(run, 10);
    expect(s.gear.pos).toBeLessThan(0.1);
    expect(s.env.altitude).toBeLessThan(5);
  });
});

describe('jump & government probability curves', () => {
  it('success probability is monotonic and steep', () => {
    const p = JumpDriveSystem.successProbability;
    expect(p(0.95)).toBeGreaterThan(0.9);
    expect(p(0.93)).toBeGreaterThan(0.8);
    expect(p(0.93)).toBeLessThan(p(0.95));
    expect(p(0.75)).toBeLessThan(0.1);
    for (let s = 0.5; s < 1; s += 0.01) expect(p(s + 0.01)).toBeGreaterThanOrEqual(p(s));
  });
  it('jammer field suppresses radar more in NARROW than SPOOF', () => {
    const run = new Run(6);
    run.ship.jammer.field = 1;
    expect(run.ship.jammer.radarSuppression(0)).toBeGreaterThan(run.ship.jammer.radarSuppression(2));
  });
  it('switching the transponder off is noticed', () => {
    const run = new Run(7);
    stepN(run, 8);
    const before = run.flightCommand.alert;
    run.ship.controls.set('xpdrMode', 0);
    stepN(run, 12);
    expect(run.flightCommand.alert).toBeGreaterThan(before);
  });
});

describe('events', () => {
  it('has at least 30 events', () => {
    expect(ALL_EVENTS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(ALL_EVENTS.map((e) => e.id)).size).toBe(ALL_EVENTS.length);
  });
  it('repeat protection avoids the last three events', () => {
    for (let seed = 0; seed < 40; seed++) {
      const run = new Run(seed);
      const recent = ['interceptor', 'missile_lock', 'coffee_failure'];
      const d = new EventDirector(run, recent);
      expect(recent).not.toContain(d.selected.id);
    }
  });
});

describe('save & rewards', () => {
  it('migrates v1 saves and recovers from corruption', () => {
    const m = migrate({ version: 1, credits: 50, pb: 312.5, paint: 'paint_olive', runs: 'x' });
    expect(m.version).toBe(2);
    expect(m.personalBest).toBe(312.5);
    expect(m.cosmetics.paint).toBe('paint_olive');
    expect(m.runs).toBe(0);
    const store: Record<string, string> = { [SAVE_KEY]: '{not json' };
    const fake = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } } as any;
    const sm = new SaveManager(fake);
    expect(sm.recovered).toBe(true);
    expect(sm.data).toEqual(defaultSave());
    expect(store[SAVE_KEY + '.corrupt']).toBe('{not json');
  });
  it('rewards sustained progress, not boundary crossing; pity is 1–2', () => {
    const z = newZoneTracker();
    const inp = { airborne: true, altitude: 25_000, separated: false, aligned: false, solution: false, chargeFrac: 0, coilsArmed: false };
    updateZones(z, inp, 2); // touched upper atmosphere briefly
    let r = calculateReward({ zones: z, escaped: false, runTime: 100, tracePeak: 1, alertPeak: 90, eventStatus: 'pending', passengersSafe: 0, maskingTime: 0, damage: 0 });
    expect(r.total).toBeLessThanOrEqual(2);
    updateZones(z, { ...inp, altitude: 57_000 }, 10);
    r = calculateReward({ zones: z, escaped: false, runTime: 100, tracePeak: 1, alertPeak: 90, eventStatus: 'pending', passengersSafe: 0, maskingTime: 0, damage: 0 });
    expect(r.pity).toBeGreaterThanOrEqual(1);
    expect(r.pity).toBeLessThanOrEqual(2);
    expect(r.total).toBe(2 + 5 + 9 + r.pity);
  });
});

describe('runs', () => {
  it('a new Run with the same seed is a full reset and reproduces exactly', () => {
    const a = simulateRun(0x51, 120).run;
    const b = simulateRun(0x51, 120).run;
    expect(a.ship.pos.distanceTo(b.ship.pos)).toBeLessThan(1e-6);
    expect(a.flightCommand.alert).toBe(b.flightCommand.alert);
    const fresh = new Run(0x51);
    expect(fresh.ship.time).toBe(0);
    expect(fresh.ship.vel.length()).toBe(0);
  });
  it('different seeds roll different machines and worlds', () => {
    const a = new Run(100), b = new Run(101);
    expect(a.machine.engEff.A).not.toBe(b.machine.engEff.A);
    expect(a.worldRoll.windSpeed).not.toBe(b.worldRoll.windSpeed);
  });
  it('the scripted expert can complete a full escape (systems are physically completable)', () => {
    const { run } = simulateRun(0x1234abcd, 900);
    expect(run.escaped).toBe(true);
    expect(run.reward!.total).toBeGreaterThan(100);
  }, 60_000);
});

void Vector3;
