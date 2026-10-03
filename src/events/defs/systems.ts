import { Vector3 } from 'three';
import { defineEvent } from '../EventDefinition';

export const SYSTEM_EVENTS = [
  defineEvent({
    id: 'jammer_overheat', name: 'Jammer Overheat', weight: 1, minAlt: 20_000,
    begin(r, s) { r.ship.jammer.extraHeat = 1.3; s.data.until = 70; r.ship.log('JAMMER TEMP RISING'); },
    update(_dt, r, s) { if (s.t > s.data.until) r.ship.jammer.extraHeat = 0; },
    isResolved: (r, s) => s.t > s.data.until && r.ship.jammer.temp < 95 && !r.ship.jammer.destroyed,
    hasFailed: (r) => r.ship.jammer.destroyed,
    cleanup: (r) => { r.ship.jammer.extraHeat = 0; },
  }),
  defineEvent({
    id: 'engine_flameout', name: 'Engine Flameout', weight: 1,
    canTrigger: (r) => r.ship.engines.A.running || r.ship.engines.B.running,
    begin(r, s) {
      const ship = r.ship;
      const id = ship.engines.A.running && ship.engines.B.running ? s.rng.pick(['A', 'B'] as const) : ship.engines.A.running ? 'A' : 'B';
      s.data.id = id;
      ship.engines[id].state = 'flameout';
      ship.damage.hit('eng' + id, 0.08);
      ship.log(`ENGINE ${id} FLAMEOUT`);
      ship.bus.emit('sfx', { id: 'flameout' });
    },
    isResolved: (r, s) => r.ship.engines[s.data.id as 'A' | 'B'].running,
    hasFailed: (_r, s) => s.t > 120,
  }),
  defineEvent({
    id: 'coolant_leak', name: 'Coolant Leak', weight: 1,
    begin(r, s) { const id = s.rng.pick(['A', 'B'] as const); s.data.id = id; r.ship.thermal.loop[id].leak = 0.011; r.ship.log(`COOLANT ${id} QTY DROPPING`); },
    update(_dt, r, s) {
      const L = r.ship.thermal.loop[s.data.id as 'A' | 'B'];
      // a stopped loop holds pressure — the leak slows dramatically
      L.leak = r.ship.controls.get('cool' + s.data.id) === 1 ? 0.011 : 0.0008;
    },
    isResolved: (r, s) => s.t > 75,
    hasFailed: (r) => r.ship.engines.A.temp > 1150 || r.ship.engines.B.temp > 1150,
    cleanup: (r, s) => { r.ship.thermal.loop[s.data.id as 'A' | 'B'].leak *= 0.5; },
  }),
  defineEvent({
    id: 'capacitor_arc', name: 'Capacitor Arc', weight: 0.9,
    canTrigger: (r) => r.ship.jump.charge > 0.15,
    begin(r, s) { r.ship.jump.arcRiskMul *= 4; s.data.base = r.ship.machine.capArcRisk; r.ship.log('CAP BANK INSULATION FAULT'); },
    update(dt, r, s) {
      const j = r.ship.jump;
      if (j.charge > 0.45 && s.rng.chance(dt * 0.35 * j.charge)) {
        j.arcing = 1;
        j.charge *= 0.94;
        r.ship.elec.noise = Math.max(r.ship.elec.noise, 0.7);
        r.ship.damage.hit(s.rng.chance(0.5) ? 'coilA' : 'coilB', 0.03);
        r.ship.bus.emit('sfx', { id: 'arc' });
        r.ship.bus.emit('shake', { amount: 0.2 });
      }
    },
    isResolved: (_r, s) => s.t > 45,
    cleanup: (r, s) => { r.ship.jump.arcRiskMul = s.data.base; },
  }),
  defineEvent({
    id: 'micrometeor', name: 'Micrometeor Strike', weight: 0.9, minAlt: 60_000,
    canTrigger: (r) => r.ship.env.altitude > 55_000,
    begin(r, s) {
      const ship = r.ship;
      s.data.hits = [ship.damage.randomHit(ship, s.rng.range(0.3, 0.7)), ship.damage.randomHit(ship, s.rng.range(0.2, 0.6))];
      ship.press.cockpitLeak += s.rng.range(0.0012, 0.003);
      ship.bus.emit('sfx', { id: 'impact' });
      ship.bus.emit('shake', { amount: 0.9 });
      ship.log('HULL BREACH — COCKPIT');
    },
    isResolved: (_r, s) => s.t > 30,
  }),
  defineEvent({
    id: 'solar_flare', name: 'Solar Flare', weight: 0.9, minAlt: 40_000,
    begin(r) { r.ship.log('RADIATION ALERT'); r.flightCommand.say('All stations: solar particle event in progress. Expect degraded avionics.', 'system', { from: 'SPACE WEATHER' }); },
    update(dt, r, s) {
      r.ship.elec.noise = Math.max(r.ship.elec.noise, 0.55);
      if (s.rng.chance(dt * 0.05) && !r.ship.xpdr.replying(r.ship)) r.ship.xpdr.forcedOn = true;
      if (s.rng.chance(dt * 0.04)) r.ship.damage.hit('sensors', 0.05);
    },
    isResolved: (_r, s) => s.t > 50,
  }),
  defineEvent({
    id: 'transponder_reboot', name: 'Transponder Reboot', weight: 1.1,
    canTrigger: (r) => !r.ship.xpdr.replying(r.ship) && r.ship.controls.get('cb_xpdr') === 1,
    begin(r) { r.ship.xpdr.forcedOn = true; r.ship.xpdr.warm = 5; r.ship.log('XPDR FIRMWARE RESTART'); },
    isResolved: (r) => !r.ship.xpdr.forcedOn,
    hasFailed: (_r, s) => s.t > 45,
  }),
  defineEvent({
    id: 'reactor_surge', name: 'Reactor Surge', weight: 0.9,
    canTrigger: (r) => r.ship.engines.A.running || r.ship.engines.B.running,
    begin(r) { r.ship.engines.A.surgeNoise = 0.6; r.ship.engines.B.surgeNoise = 0.6; r.ship.log('REACTOR OUTPUT UNSTABLE'); },
    update(dt, r) { r.ship.elec.noise = Math.max(r.ship.elec.noise, 0.4); r.ship.engines.A.temp += 3 * dt; r.ship.engines.B.temp += 3 * dt; },
    isResolved: (_r, s) => s.t > 40,
    cleanup: (r) => { r.ship.engines.A.surgeNoise = 0; r.ship.engines.B.surgeNoise = 0; },
  }),
  defineEvent({
    id: 'throttle_jam', name: 'Throttle Jam', weight: 1,
    begin(r, s) { r.ship.controls.stuck.add('throttleA'); r.ship.controls.stuck.add('throttleB'); s.data.dur = s.rng.range(35, 60); r.ship.bus.emit('sfx', { id: 'clunk' }); },
    isResolved: (_r, s) => s.t > s.data.dur,
    cleanup: (r) => { r.ship.controls.stuck.delete('throttleA'); r.ship.controls.stuck.delete('throttleB'); },
  }),
  defineEvent({
    id: 'control_calibration', name: 'Control Calibration Failure', weight: 1,
    begin(r, s) { s.data.p = s.rng.range(-1, 1); s.data.r = s.rng.range(-1, 1); s.data.cleared = false; s.data.off = 0; r.ship.log('FCS SENSOR MISCOMPARE'); },
    update(dt, r, s) {
      const f = r.ship.fcs;
      if (r.ship.controls.get('cb_fcs') === 0) s.data.off += dt;
      if (s.data.off > 1 && r.ship.controls.get('cb_fcs') === 1) s.data.cleared = true;
      const k = s.data.cleared ? 0 : Math.min(0.32, s.t * 0.01);
      f.stickOffset.pitch = s.data.p * k;
      f.stickOffset.roll = s.data.r * k;
    },
    isResolved: (_r, s) => s.data.cleared,
    hasFailed: (_r, s) => s.t > 150,
    cleanup: (r) => { r.ship.fcs.stickOffset.pitch = 0; r.ship.fcs.stickOffset.roll = 0; },
  }),
  defineEvent({
    id: 'avionics_bus', name: 'Avionics Bus Failure', weight: 1,
    begin(r, s) { r.ship.elec.tripped.AV = true; s.data.second = s.rng.range(10, 25); s.data.done = false; r.ship.bus.emit('sfx', { id: 'breaker_pop' }); },
    update(_dt, r, s) {
      if (!s.data.done && s.t > s.data.second && !r.ship.elec.tripped.AV) {
        s.data.done = true;
        if (s.rng.chance(0.6)) { r.ship.elec.tripped.AV = true; r.ship.bus.emit('sfx', { id: 'breaker_pop' }); }
      }
    },
    isResolved: (r, s) => s.t > 30 && !r.ship.elec.tripped.AV,
  }),
  defineEvent({
    id: 'radar_ghosts', name: 'Radar Ghosts', weight: 0.8,
    begin(r, s) { s.data.next = 0; r.ship.log('SENSOR MULTIPATH'); },
    update(dt, r, s) {
      s.data.next -= dt;
      if (s.data.next <= 0) {
        s.data.next = s.rng.range(1, 4);
        r.tracking.illum.push({ time: r.ship.time, site: 'GHOST', bearing: s.rng.range(-Math.PI, Math.PI), strength: s.rng.range(0.4, 1), detected: false, ghost: true });
        r.ghostLock = s.rng.chance(0.3) ? 1.5 : r.ghostLock;
      }
    },
    isResolved: (_r, s) => s.t > 55,
  }),
  defineEvent({
    id: 'engine_oscillation', name: 'Engine Oscillation', weight: 0.9,
    canTrigger: (r) => r.ship.engines.A.running || r.ship.engines.B.running,
    begin(r, s) { const lo = s.rng.range(0.5, 0.7); r.ship.engines.A.oscillationBand = [lo, lo + 0.2]; r.ship.engines.B.oscillationBand = [lo, lo + 0.2]; s.data.lo = lo; },
    update(dt, r) {
      const v = Math.max(r.ship.engines.A.vibration, r.ship.engines.B.vibration);
      if (v > 0.3) { r.ship.damage.hit('structure', v * 0.012 * dt); r.ship.bus.emit('shake', { amount: v * 0.1 }); }
    },
    isResolved: (_r, s) => s.t > 70,
    hasFailed: (r) => r.ship.damage.health.structure < 0.4,
  }),
  defineEvent({
    id: 'fuel_imbalance', name: 'Fuel Imbalance', weight: 0.9,
    begin(r, s) { s.data.dir = s.rng.chance(0.5) ? 1 : -1; r.ship.log('FUEL IMBALANCE'); },
    update(dt, r, s) {
      const f = r.ship.fuel;
      const c = r.ship.controls;
      const balancing = c.get('crossfeed') === 1 && c.get('fuelPumpA') === 1 && c.get('fuelPumpB') === 1;
      if (balancing) f.imbalance *= Math.exp(-dt / 8);
      else f.imbalance = Math.max(-0.9, Math.min(0.9, f.imbalance + s.data.dir * 0.02 * dt));
    },
    isResolved: (r, s) => s.t > 20 && Math.abs(r.ship.fuel.imbalance) < 0.05,
    hasFailed: (_r, s) => s.t > 120,
  }),
  defineEvent({
    id: 'jump_coil_quench', name: 'Jump Coil Quench', weight: 0.9,
    canTrigger: (r) => r.ship.jump.coilsArmed,
    begin(r, s) { (r.ship.jump as any).quench(r.ship, s.rng.pick(['A', 'B'])); },
    isResolved: (r, s) => s.t > 20 && r.ship.jump.coilTemp < 50,
  }),
  defineEvent({
    id: 'jump_desync', name: 'Jump Clock Desynchronisation', weight: 0.9,
    canTrigger: (r) => r.ship.avionics.navReady,
    begin(r) { r.ship.avionics.clockDesync = true; r.ship.jump.synced = false; r.ship.log('NAV CLOCK DESYNC'); },
    update(_dt, r) { if (!r.ship.avionics.navOn) r.ship.avionics.clockDesync = false; },
    isResolved: (r) => !r.ship.avionics.clockDesync,
    hasFailed: (r) => r.failed?.cause === 'navigation',
  }),
  defineEvent({
    id: 'hydraulic_leak', name: 'Hydraulic Leak', weight: 0.8, maxAlt: 60_000,
    begin(r, s) { const id = s.rng.pick(['A', 'B'] as const); s.data.id = id; r.ship.hyd[id].leak += 0.012; r.ship.log(`HYD ${id} QTY LOW`); },
    isResolved: (_r, s) => s.t > 60,
    hasFailed: (r) => r.ship.hyd.surfacePressure < 3 && r.ship.env.q > 5000,
  }),
];

export const _v = new Vector3();
