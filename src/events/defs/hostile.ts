import { Vector3 } from 'three';
import { defineEvent } from '../EventDefinition';
import { PLANET } from '../../physics/PlanetPhysics';

export const HOSTILE_EVENTS = [
  defineEvent({
    id: 'interceptor', name: 'Government Interceptor', weight: 1.1, maxAlt: 32_000,
    canTrigger: (r) => r.ship.env.altitude > 6000 && r.ship.env.altitude < 30_000,
    begin(r, s) {
      const ship = r.ship;
      const dir = new Vector3(s.rng.gauss(0, 1), 0, s.rng.gauss(0, 1)).normalize().multiplyScalar(38_000);
      const p = ship.pos.clone().add(dir);
      p.setLength(PLANET.radius + Math.max(3000, ship.env.altitude - 4000));
      s.data.obj = r.interceptors.spawnInterceptor(p);
      r.flightCommand.raise(30, 'patrol acquisition');
      r.flightCommand.say('$CS, an Authority patrol has you on radar. Stand by for visual inspection.', 'suspicious');
    },
    isResolved: (r, s) => !s.data.obj.alive || (s.t > 40 && !s.data.obj.data.hasLock && r.tracking.trace < 0.3),
    hasFailed: (r) => r.failed?.cause === 'missile',
  }),
  defineEvent({
    id: 'missile_lock', name: 'Missile Lock', weight: 1.0, minAlt: 20_000,
    canTrigger: (r) => r.ship.env.altitude > 18_000,
    begin(r, s) {
      const ship = r.ship;
      const side = new Vector3(s.rng.gauss(0, 1), s.rng.gauss(0, 1) * 0.3, s.rng.gauss(0, 1)).normalize();
      const from = ship.pos.clone().addScaledVector(side, 55_000);
      const v = ship.pos.clone().sub(from).normalize().multiplyScalar(900);
      s.data.m = r.interceptors.spawnMissile(from, v, ship.env.altitude > 50_000);
      r.flightCommand.say('Unidentified launch. All stations, this is not an exercise.', 'hostile', { from: 'DEFENCE NET' });
    },
    isResolved: (_r, s) => !s.data.m.alive,
    hasFailed: (r) => r.failed?.cause === 'missile',
  }),
  defineEvent({
    id: 'inspection_drone', name: 'Inspection Drone', weight: 0.9, minAlt: 55_000,
    canTrigger: (r) => r.ship.env.altitude > 50_000,
    begin(r, s) { s.data.d = r.interceptors.spawnDrone(); },
    isResolved: (_r, s) => !s.data.d.alive || s.data.d.data.dv <= 0,
    hasFailed: (r) => r.failed?.cause === 'drone_capture',
  }),
  defineEvent({
    id: 'unknown_contact', name: 'Unknown Contact', weight: 0.8, minAlt: 40_000,
    begin(r, s) {
      const ship = r.ship;
      const kind = s.rng.pick(['drone', 'smuggler', 'debris'] as const);
      s.data.kind = kind;
      const side = new Vector3(s.rng.gauss(0, 1), s.rng.gauss(0, 1), s.rng.gauss(0, 1)).normalize();
      const pos = ship.pos.clone().addScaledVector(ship.vel.clone().normalize(), 30_000).addScaledVector(side, 3000);
      if (kind === 'drone') s.data.o = r.interceptors.spawnDrone();
      else {
        const o = r.spawn(kind === 'debris' ? 'debris' : 'contact', pos, ship.vel.clone().addScaledVector(ship.vel.clone().normalize(), -400 - s.rng.range(0, 600)));
        o.data = { size: kind === 'debris' ? 9 : 14 };
        s.data.o = o;
      }
      ship.log('UNKNOWN CONTACT CLOSING');
    },
    update(dt, r, s) {
      if (s.data.kind === 'smuggler' && s.t > 12 && s.data.o.alive) {
        s.data.o.vel.add(r.ship.env.up.clone().multiplyScalar(60 * dt));
        if (!s.data.waved) {
          s.data.waved = true;
          r.flightCommand.say('...free traders salute you, cousin. Mind the lattice at the ceiling.', 'normal', { from: 'UNKNOWN', freq: 1 });
        }
      }
    },
    isResolved: (r, s) => !s.data.o.alive || s.data.o.pos.distanceTo(r.ship.pos) > 80_000 || s.t > 90,
  }),
  defineEvent({
    id: 'debris_field', name: 'Orbital Debris Field', weight: 0.9, minAlt: 60_000,
    canTrigger: (r) => r.ship.env.altitude > 55_000,
    begin(r, s) {
      const ship = r.ship;
      const fwd = ship.vel.clone().normalize();
      const n = s.rng.int(9, 15);
      s.data.objs = [];
      for (let i = 0; i < n; i++) {
        const along = s.rng.range(5_000, 22_000);
        const off = new Vector3(s.rng.gauss(0, 1), s.rng.gauss(0, 1), s.rng.gauss(0, 1)).projectOnPlane(fwd).normalize().multiplyScalar(s.rng.range(0, 260));
        const p = ship.pos.clone().addScaledVector(fwd, along).add(off);
        const o = r.spawn('debris', p, ship.vel.clone().multiplyScalar(0.25).add(new Vector3(s.rng.gauss(0, 30), s.rng.gauss(0, 30), s.rng.gauss(0, 30))));
        o.data = { size: s.rng.range(3, 14) };
        s.data.objs.push(o);
      }
      ship.log('DEBRIS FIELD AHEAD');
      ship.bus.emit('sfx', { id: 'prox_warn' });
    },
    isResolved: (r, s) => s.data.objs.every((o: any) => !o.alive || o.pos.clone().sub(r.ship.pos).dot(r.ship.vel) < -2000),
  }),
];
