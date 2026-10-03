import { describe, it, expect } from 'vitest';
import { Run } from '../src/core/Run';

const stepN = (run: Run, seconds: number) => {
  const n = Math.round(seconds * 120);
  for (let i = 0; i < n && !run.ended; i++) run.step(1 / 120);
};
const open = (run: Run, id: string, v = 1) => {
  const c = run.ship.controls;
  if (c.values[id + '_g'] !== undefined) c.set(id + '_g', 1);
  c.set(id, v);
};

describe('no artificial control locks', () => {
  it('the jump drive really attempts a jump on the runway (field collapses: the module is still attached)', () => {
    const run = new Run(77);
    const s = run.ship;
    open(run, 'jumpBus');
    open(run, 'coilArm');
    s.jump.charge = 1.0; // full capacitor — still far below the mass-driven requirement
    stepN(run, 0.5);
    s.controls.set('safetyPin', 1);
    open(run, 'jumpEngage', 0);
    s.controls.press('jumpEngage');
    stepN(run, 3);
    expect(s.jump.attempted).toBe(true);
    expect(s.messages.some((m) => m.text.includes('FIELD COLLAPSE'))).toBe(true);
    expect(s.jump.charge).toBe(0);
  });

  it('overcharging the capacitor explodes it, wherever you are', () => {
    const run = new Run(82);
    open(run, 'jumpBus');
    run.ship.jump.charge = 1.4;
    stepN(run, 0.2);
    expect(run.failed?.cause).toBe('capacitor');
  });

  it('the safety interlock physically blocks the jump button', () => {
    const run = new Run(78);
    const s = run.ship;
    open(run, 'jumpBus');
    open(run, 'coilArm');
    stepN(run, 0.5);
    open(run, 'jumpEngage', 0);
    s.controls.press('jumpEngage');
    stepN(run, 3);
    expect(s.jump.attempted).toBe(false);
    expect(run.ended).toBe(false);
  });

  it('evacuation capsules can be fired while parked, and the government notices', () => {
    const run = new Run(79);
    const s = run.ship;
    s.controls.set('podPower', 1);
    open(run, 'evacArm');
    stepN(run, 3);
    open(run, 'podRelease', 0);
    s.controls.press('podRelease');
    stepN(run, 9);
    expect(s.pax.released).toBe(4);
    expect(run.flightCommand.alert).toBeGreaterThan(25);
  });

  it('pulling the separation handle while passengers are aboard separates — and fails the run', () => {
    const run = new Run(80);
    const s = run.ship;
    s.controls.set('hydA', 1);
    stepN(run, 3);
    open(run, 'mechLock');
    open(run, 'sepArm');
    stepN(run, 2.5);
    open(run, 'sepHandle');
    stepN(run, 4);
    expect(s.sep.moduleAttached).toBe(false);
    // the gearless core drops onto the runway, with 40 passengers left in the module
    expect(['pax_in_module', 'crash_ground']).toContain(run.failed?.cause);
  });

  it('killing the avionics bus blacks out the displays immediately', () => {
    const run = new Run(81);
    stepN(run, 1);
    expect(run.ship.avionics.displaysOn).toBe(true);
    run.ship.controls.set('avionics', 0);
    stepN(run, 0.2);
    expect(run.ship.avionics.displaysOn).toBe(false);
  });
});
