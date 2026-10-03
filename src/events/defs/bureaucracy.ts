import { defineEvent } from '../EventDefinition';

export const BUREAUCRACY_EVENTS = [
  defineEvent({
    id: 'nav_spoof', name: 'Navigation Spoof', weight: 1,
    begin(r, s) {
      const ship = r.ship;
      const off = ship.env.east.clone().multiplyScalar(s.rng.range(-1, 1)).add(ship.env.north.clone().multiplyScalar(s.rng.range(-1, 1))).normalize().multiplyScalar(s.rng.range(25_000, 70_000));
      ship.avionics.spoofOffset.copy(off);
      s.data.dur = s.rng.range(60, 95);
      ship.log('GNSS/INS MISCOMPARE');
    },
    isResolved: (_r, s) => s.t > s.data.dur,
    hasFailed: (r) => r.failed?.cause === 'navigation',
    cleanup: (r) => { r.ship.avionics.spoofOffset.set(0, 0, 0); },
  }),
  defineEvent({
    id: 'false_clearance', name: 'False Government Clearance', weight: 1,
    begin(r, s) {
      s.data.alertAt = r.flightCommand.alert;
      s.data.wasReplying = r.ship.xpdr.replying(r.ship);
      r.flightCommand.say('$CS, good news. You are cleared direct, unrestricted climb, any vector. Simply squawk ALT and ident so we can wave.', 'normal');
    },
    update(_dt, r, s) {
      const ship = r.ship;
      if (s.data.sprung) return;
      if ((!s.data.wasReplying && ship.xpdr.replying(ship)) || ship.xpdr.identTimer > 0) {
        s.data.sprung = true;
        r.flightCommand.raise(40, 'took the bait');
        r.flightCommand.say('Thank you, $CS. Position confirmed. Interception vector computed.', 'hostile');
      }
    },
    isResolved: (_r, s) => s.t > 60 && !s.data.sprung,
    hasFailed: (_r, s) => !!s.data.sprung,
  }),
  defineEvent({
    id: 'gov_challenge', name: 'Government Challenge', weight: 1,
    begin(r, s) { s.data.ch = r.flightCommand.issueChallenge('auth'); s.data.result = null; },
    onChallenge(_r, s, ok) { s.data.result = ok; },
    isResolved: (_r, s) => s.data.result === true,
    hasFailed: (_r, s) => s.data.result === false,
  }),
  defineEvent({
    id: 'forced_update', name: 'Forced Software Update', weight: 0.9,
    canTrigger: (r) => r.datalinkUp(),
    begin(r, s) { r.flightCommand.say('$CS, mandatory avionics update pushed via datalink. Restoring regulatory flight control in twenty seconds.', 'system', { from: 'AUTHORITY IT' }); s.data.applied = false; },
    update(_dt, r, s) {
      if (!s.data.applied && s.t > 20 && r.datalinkUp()) {
        s.data.applied = true;
        const c = r.ship.controls;
        c.set('fcsMode', 1, true);
        c.set('navSource', 0, true);
        c.set('apMaster', 1, true);
        r.ship.xpdr.forcedOn = true;
        r.ship.log('UPDATE APPLIED: REGULATORY MODE');
      }
      if (s.data.applied && s.t < 50 && r.datalinkUp()) {
        r.ship.controls.set('navSource', 0, true);
        if (r.ship.controls.get('apMaster') === 0 && s.rng.chance(0.02)) r.ship.controls.set('apMaster', 1, true);
      }
    },
    isResolved: (r, s) => s.t > 20 && !s.data.applied,
    hasFailed: (_r, s) => s.data.applied,
  }),
  defineEvent({
    id: 'autopilot_intervention', name: 'Autopilot Intervention', weight: 0.9,
    begin(r, s) { s.data.next = 0; r.ship.log('AP: AUTHORITY RECOVERY MODE'); },
    update(dt, r, s) {
      s.data.next -= dt;
      const c = r.ship.controls;
      if (s.data.next <= 0 && s.t < 40) {
        s.data.next = 6;
        if (c.get('cb_fcs') === 1 && c.get('fcsMode') === 1) {
          c.set('navSource', 0, true);
          c.set('apMaster', 1, true);
          r.ship.bus.emit('sfx', { id: 'ap_engage' });
        }
      }
    },
    isResolved: (_r, s) => s.t > 40,
  }),
  defineEvent({
    id: 'pa_broadcast', name: 'Passenger PA Broadcast', weight: 0.9,
    canTrigger: (r) => r.ship.sep.moduleAttached,
    begin(r, s) {
      r.ship.comms.hotMic = true;
      s.data.leakAt = 6;
      const lines = [
        'Good afternoon passengers, this is your captain. We will shortly be committing several interplanetary felonies. Please remain seated.',
        'Cabin crew, prepare capsules for unscheduled emigration. Duty-free trolley will not be passing through the cabin.',
        'Passengers on the left side may notice we are no longer following the government. Passengers on the right side, also that.',
      ];
      s.data.text = s.rng.pick(lines);
      r.ship.bus.emit('radio', { from: 'CABIN PA (HOT MIC)', text: s.data.text, tone: 'pa' });
    },
    update(_dt, r, s) {
      if (!s.data.done && s.t > s.data.leakAt) {
        s.data.done = true;
        if (r.ship.comms.canTransmit(r.ship) && r.ship.comms.hotMic) {
          s.data.leaked = true;
          r.flightCommand.raise(32, 'cabin PA on frequency');
          r.flightCommand.say('$CS... we heard that. All of it.', 'hostile');
        }
      }
    },
    isResolved: (_r, s) => s.data.done && !s.data.leaked,
    hasFailed: (_r, s) => !!s.data.leaked,
    cleanup: (r) => { r.ship.comms.hotMic = false; },
  }),
  defineEvent({
    id: 'mechanical_obstruction', name: 'Mechanical Obstruction', weight: 0.9,
    begin(r, s) {
      const pool = ['sepHandle', 'safetyPin', 'mechLock', 'podRelease', 'gear', 'coilArm', 'jumpCharge', 'throttleB', 'xpdrMode'];
      s.data.id = s.rng.pick(pool);
      s.data.dur = s.rng.range(25, 50);
      r.ship.controls.stuck.add(s.data.id);
      r.ship.flags.obstruction = s.data.id;
      r.ship.log('PANEL FASTENER LOOSE');
      r.ship.bus.emit('sfx', { id: 'clunk' });
    },
    isResolved: (_r, s) => s.t > s.data.dur,
    cleanup: (r, s) => { r.ship.controls.stuck.delete(s.data.id); r.ship.flags.obstruction = null; },
  }),
  defineEvent({
    id: 'coffee_failure', name: 'Coffee Failure', weight: 1,
    begin(r, s) {
      const bus = s.rng.pick(['A', 'B'] as const);
      s.data.bus = bus;
      r.ship.elec.shortCircuit[bus] += 16;
      r.ship.elec.noise = 0.6;
      r.ship.bus.emit('sfx', { id: 'spark' });
      r.ship.log(`BUS ${bus} GROUND FAULT (BEVERAGE)`);
      s.data.dead = 0;
    },
    update(dt, r, s) {
      const v = r.ship.elec.volts[s.data.bus as 'A' | 'B'];
      if (v < 2) s.data.dead += dt;
      if (s.data.dead > 3 && r.ship.elec.shortCircuit[s.data.bus as 'A' | 'B'] > 0) {
        r.ship.elec.shortCircuit[s.data.bus as 'A' | 'B'] = Math.max(0, r.ship.elec.shortCircuit[s.data.bus as 'A' | 'B'] - 16);
        s.data.cleared = true;
        r.ship.log('FAULT CLEARED (COFFEE EVAPORATED)');
      }
    },
    isResolved: (_r, s) => !!s.data.cleared,
    hasFailed: (r) => r.failed?.cause === 'elec_fire',
  }),
  defineEvent({
    id: 'orbital_toll', name: 'Orbital Toll Authority', weight: 0.9, minAlt: 40_000,
    begin(r, s) { s.data.ch = r.flightCommand.issueChallenge('toll'); s.data.result = null; },
    onChallenge(_r, s, ok) { s.data.result = ok || true; },
    isResolved: (_r, s) => s.data.result !== null && s.data.ch.resolved,
  }),
];
