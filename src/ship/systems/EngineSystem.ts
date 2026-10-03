import { BAL } from '../../data/Balance';
import { approach, clamp01 } from '../../core/mathutil';
import type { Ship } from '../Ship';

export type EngineState = 'off' | 'starting' | 'running' | 'flameout' | 'failed';

/**
 * Compact fusion reaction engine. N = core spool (0..1.1).
 * Thrust falls with ambient pressure (exit-area loss). Heat must be removed by the coolant loop.
 */
export class Engine {
  state: EngineState = 'off';
  N = 0;
  temp = 18; // °C
  thrust = 0; // N
  fuelFlow = 0; // kg/s
  startTimer = 0;
  starveTimer = 0;
  fire = 0; // 0 none, >0 intensity
  fireTime = 0;
  bottleUsed = false;
  hungStart = false;
  /** Externally imposed (events): N oscillation amplitude in a throttle band. */
  oscillationBand: [number, number] | null = null;
  vibration = 0;
  surgeNoise = 0;
  gimbal = { pitch: 0, yaw: 0 }; // radians, set by FCS
  heatIn = 0;
  coolOut = 0;

  constructor(public id: 'A' | 'B') {}

  update(dt: number, ship: Ship): void {
    const c = ship.controls;
    const m = ship.machine;
    const id = this.id;
    const master = c.get('engMaster') === 1;
    const fireHandle = c.get('fire' + id) === 1;
    const feed = ship.fuel.feed[id];
    const health = ship.damage.health['eng' + id];
    const emer = ship.elec.powered('EMER', 20);

    // Ignition (momentary START button) — needs master, igniter power, fuel pressure.
    if (c.pressed('ign' + id)) {
      if (master && emer && (this.state === 'off' || this.state === 'flameout') && health > 0.08) {
        ship.elec.demand('EMER', 2);
        if (feed.pressure > 0.3 && !fireHandle) {
          this.state = 'starting';
          this.startTimer = 0;
          this.hungStart = false;
          ship.bus.emit('sfx', { id: 'eng_ignite', pan: id === 'A' ? -0.4 : 0.4 });
        } else {
          this.hungStart = true;
          ship.bus.emit('sfx', { id: 'igniter_tick' });
        }
      } else if (emer) ship.bus.emit('sfx', { id: 'igniter_tick' });
    }

    const lim = BAL.thrustLimits[c.get('thrustLimit')];
    const genMode = c.get('thrustLimit') === 0;
    const throttle = c.get('throttle' + id);

    if (this.state === 'starting') {
      this.startTimer += dt;
      this.N = approach(this.N, BAL.engIdleN + 0.02, 2.2, dt);
      ship.elec.demand('EMER', 1.5);
      if (!master || fireHandle || feed.pressure < 0.2) {
        this.state = 'off';
      } else if (this.startTimer > BAL.engStartTime) this.state = 'running';
    } else if (this.state === 'running') {
      let target = genMode ? 0.92 : BAL.engIdleN + (lim - BAL.engIdleN) * throttle;
      if (this.oscillationBand && throttle > this.oscillationBand[0] && throttle < this.oscillationBand[1]) {
        this.vibration = Math.min(1, this.vibration + dt * 0.8);
        target += Math.sin(ship.time * 23) * 0.05 * this.vibration;
      } else this.vibration = Math.max(0, this.vibration - dt);
      target += this.surgeNoise * (ship.rng.next() - 0.5) * 0.3;
      const tau = target > this.N ? 1.6 : 1.0;
      this.N = approach(this.N, target * (0.6 + 0.4 * health), tau, dt);
      // fuel starvation / shutdown
      if (feed.avail < 0.08 || feed.pressure < 0.12) this.starveTimer += dt;
      else this.starveTimer = Math.max(0, this.starveTimer - dt * 2);
      if (!master || fireHandle) {
        this.state = 'off';
        ship.bus.emit('sfx', { id: 'eng_shutdown', pan: id === 'A' ? -0.4 : 0.4 });
      } else if (this.starveTimer > 1.3) {
        this.state = 'flameout';
        ship.log(`ENGINE ${id} FLAMEOUT`);
        ship.bus.emit('sfx', { id: 'flameout', pan: id === 'A' ? -0.4 : 0.4 });
      }
      if (health <= 0.02) {
        this.state = 'failed';
        ship.log(`ENGINE ${id} FAILED`);
      }
    } else {
      this.N = approach(this.N, 0, 2.5, dt);
      this.vibration = 0;
    }

    // Thrust
    const running = this.state === 'running';
    const pAmb = ship.env.atmo.pressure;
    let frac = running ? Math.pow(clamp01((this.N - 0.18) / 0.82), 1.5) * (this.N > 1 ? this.N : 1) : 0;
    if (running) frac = Math.min(frac, feed.avail * 1.02);
    const thrustFrac = genMode ? frac * 0.08 : frac;
    const tvac = BAL.engTvac * m.engEff[id] * (0.55 + 0.45 * health);
    this.thrust = Math.max(0, (tvac - pAmb * BAL.engExitArea) * thrustFrac);
    if (running && thrustFrac <= 0.001) this.thrust = 0;
    const maxFlow = BAL.engTvac / (BAL.engIsp * 9.80665);
    this.fuelFlow = running ? maxFlow * (genMode ? 0.3 * (this.N / 0.92) : 0.03 + 0.97 * frac) : this.state === 'starting' ? 0.6 : 0;
    ship.fuel.engDemand[id] += this.fuelFlow;

    // Thermal
    const coolCap = ship.thermal.engineCooling(id); // 0..1
    const over = lim > 1.05 && !genMode ? 1.45 : 1;
    this.heatIn = running ? (genMode ? 640 : BAL.engHeatFull * Math.pow(this.N, 2.2) * over) * m.engHeat[id] : this.state === 'starting' ? 120 : 0;
    this.heatIn += this.fire > 0 ? 600 * this.fire : 0;
    const rhoRatio = Math.min(1.2, ship.env.atmo.density / 1.225);
    const dT = this.temp - 15;
    this.coolOut = (BAL.engCoolK * coolCap + BAL.engAirK * rhoRatio + 0.05) * dT + 5.67e-11 * 0.4 * (Math.pow(this.temp + 273, 4) - Math.pow(260, 4));
    this.temp += ((this.heatIn - this.coolOut) / BAL.engHeatCap) * dt;
    this.temp = Math.max(-60, this.temp);

    if (this.temp > BAL.engTempWarn) {
      const over = (this.temp - BAL.engTempWarn) / 100;
      ship.damage.hit('eng' + id, 0.012 * over * dt);
      if (this.temp > BAL.engTempFire && this.fire === 0 && ship.rng.chance(0.25 * dt)) this.startFire(ship);
    }

    // Fire handle: cuts fuel (via FuelSystem valve logic) and discharges this engine's single bottle.
    if (fireHandle && !this.bottleUsed && emer) {
      this.bottleUsed = true;
      ship.bus.emit('sfx', { id: 'extinguisher' });
      if (this.fire > 0 && ship.rng.chance(0.88)) {
        this.fire = 0;
        this.fireTime = 0;
        ship.log(`FIRE ${id} EXTINGUISHED`);
      }
    }
    if (this.fire > 0) {
      this.fireTime += dt;
      const fuelFed = !fireHandle && c.get('iso' + id) === 1;
      this.fire = Math.max(0, Math.min(1, this.fire + dt * (fuelFed ? 0.05 : -0.012)));
      ship.damage.hit('eng' + id, 0.015 * this.fire * dt);
      ship.damage.hit('structure', 0.004 * this.fire * dt);
      if (this.fire <= 0) this.fireTime = 0;
    }
  }

  startFire(ship: Ship): void {
    if (this.fire > 0) return;
    this.fire = 0.3;
    this.fireTime = 0;
    ship.log(`ENGINE ${this.id} FIRE`);
    ship.bus.emit('sfx', { id: 'fire_bell' });
  }

  get running(): boolean {
    return this.state === 'running';
  }
}
