import { Run } from '../core/Run';
import { DEG, RAD, clamp } from '../core/mathutil';

/**
 * Scripted "expert" used for automated QA and balancing. It only touches the same
 * ControlState inputs a human can reach — no back doors into the simulation.
 */
export class BotPilot {
  phase = 'preflight';
  log: string[] = [];
  private t0 = 0;
  private flags: Record<string, boolean> = {};

  private throttleForQ(qk: number) {
    const c = this.run.ship.controls;
    const q = this.run.ship.env.q / 1000;
    const cur = c.get('throttleA');
    const v = clamp(cur + (qk - q) * 0.002, 0.25, 1);
    c.set('throttleA', v); c.set('throttleB', v);
  }
  constructor(public run: Run, public verbose = false) {}

  private set(id: string, v: number) {
    const c = this.run.ship.controls;
    if (id.endsWith('_g')) return c.set(id, v);
    const def = (c as any).values;
    void def;
    // open guard if needed
    const g = id + '_g';
    if (g in c.values && c.get(g) === 0) c.set(g, 1);
    c.set(id, v);
  }

  private press(id: string) {
    const c = this.run.ship.controls;
    const g = id + '_g';
    if (g in c.values && c.get(g) === 0) c.set(g, 1);
    c.press(id);
  }

  private note(s: string) {
    const line = `[${this.run.time.toFixed(1)}] ${s}`;
    this.log.push(line);
    if (this.verbose) console.log(line);
  }

  private go(p: string) {
    this.phase = p;
    this.t0 = this.run.time;
    this.note('→ ' + p);
  }

  /** Called before each sim step. */
  tick(): void {
    const run = this.run;
    const s = run.ship;
    const c = s.controls;
    const e = s.env;
    const t = run.time;
    const dt = t - this.t0;

    // always: acknowledge ATC readbacks and fight fires
    if (run.flightCommand.pending.length && Math.floor(t * 2) % 6 === 0) c.press('ptt');
    if (run.flightCommand.challenge && !run.flightCommand.challenge.resolved && run.flightCommand.challenge.kind === 'auth') {
      const entry = run.flightCommand.authTable.find((a) => a.word === run.flightCommand.challenge!.word);
      if (entry) { c.set('authCode', entry.digit); c.press('authTx'); }
    }
    for (const id of ['A', 'B'] as const) if (s.engines[id].fire > 0) c.set('fire' + id, 1);
    if (s.xpdr.forcedOn) c.set('cb_xpdr', 0);
    if (run.events.active?.id === 'pa_broadcast') c.set('tx', 0);
    if (run.events.active?.id === 'forced_update') c.set('cb_dlink', 0);
    if (s.elec.tripped.AV && dt > 0.5) { c.set('avionics', 0); }
    else if (c.get('avionics') === 0 && !s.elec.tripped.AV) c.set('avionics', 1);
    if (s.engines.A.state === 'flameout') c.press('ignA');
    if (s.engines.B.state === 'flameout' && (s.fuel.feed.B.pressure > 0.3)) c.press('ignB');

    switch (this.phase) {
      case 'preflight':
        c.set('hydA', 1); c.set('hydB', 1); c.set('fuelPumpA', 1); c.set('fuelPumpB', 1);
        c.set('engMaster', 1); c.set('podPower', 1); c.set('podGuidance', 1); c.set('returnProg', 2);
        if (dt > 1.5) { c.press('ignA'); c.press('ignB'); this.go('spool'); }
        break;
      case 'spool':
        if (s.engines.A.running && s.engines.B.running) { this.set('extpwr', 0); c.set('apu', 0); this.go('roll'); }
        break;
      case 'roll': {
        c.set('parkBrake', 0);
        c.set('throttleA', 1); c.set('throttleB', 1);
        c.stickPitch = 0;
        c.pedals = clamp(-((e.attitude.heading * RAD - 90)) * 0.08 - s.omega.y * -0.5, -1, 1);
        if (e.eas > 78) this.go('rotate');
        break;
      }
      case 'rotate':
        c.pedals = 0;
        c.stickPitch = clamp((12 - e.attitude.pitch * RAD) * 0.12, -0.4, 0.8);
        if (!e.onGround && e.agl > 40) { c.set('gear', 0); this.go('climb'); }
        break;
      case 'climb':
        c.stickPitch = 0; c.stickRoll = 0;
        this.throttleForQ(e.altitude < 4000 ? 24 : 32);
        c.set('navSource', 0);
        if (c.get('apMaster') === 0) c.set('apMaster', 1);
        c.set('fuelXfer', 1);
        if (e.altitude > 12_000) c.set('restraint', 1);
        if (e.altitude > 15_000) { c.set('rcsMaster', 1); c.set('rcsMode', 2); }
        if (s.avionics.navReady && !s.avionics.escLoaded && s.avionics.escLoading <= 0) c.press('escLoad');
        if (e.altitude > 20_000 && s.xpdr.replying(s)) c.set('xpdrMode', 4);
        if (e.altitude > 22_000) {
          c.set('o2', 1);
          this.set('datalink', 0);
          c.set('jammerBus', 1); c.set('jamCool', 1); c.set('jamCharge', 1);
          c.set('cockpitSeal', 1); c.set('cabinIsol', 1); c.set('crossfeed', 1);
        }
        if (e.altitude > 30_000 && s.jammer.cap > 0.97 && s.pax.inCabin === 0 && s.pax.pods.every((p) => p.charge > 0.5)) this.go('dark');
        break;
      case 'dark':
        this.throttleForQ(26);
        c.set('xpdrMode', 0);
        this.set('jamArm', 1);
        c.set('jamEngage', 1);
        c.set('jamCharge', 0);
        if (dt > 0.3) this.go('evac');
        break;
      case 'evac':
        this.throttleForQ(20);
        this.set('evacArm', 1);
        if (dt > 0.3 && s.pax.released === 0) this.press('podRelease');
        if (s.pax.released >= 4 && dt > 2.2) this.go('presep');
        break;
      case 'presep':
        this.throttleForQ(26);
        c.set('sepElec', 1); this.set('svcFuel', 1); c.set('fuelXfer', 0);
        this.set('mechLock', 1);
        this.set('sepArm', 1);
        if (dt > 0.4 && s.sep.lockPos >= 1) { this.set('sepHandle', 1); this.go('postsep'); }
        break;
      case 'postsep':
        c.set('crossfeed', 1);
        if (dt > 1.5) this.go('divert');
        break;
      case 'divert':
        // go dark and climb out of the lane
        c.set('throttleA', 1); c.set('throttleB', 1);
        if (s.jammer.cap < 0.01) c.set('jamEngage', 0);
        c.set('navSource', 2);
        c.set('jumpBus_g', 1); c.set('jumpBus', 1);
        c.set('coolPrio', 1);
        if (dt > 2) c.set('jumpCharge', s.jump.charge < s.jump.requiredCharge * 1.02 ? 1 : 0);
        if (e.altitude > 95_000) { this.set('coilArm', 1); }
        if (e.altitude > 118_000 && dt > 5) this.go('jumpprep');
        break;
      case 'jumpprep': {
        const j = s.jump;
        c.set('coolPrio', 2);
        c.set('thrustLimit', 0);
        for (const [sub, sw] of [['JUMP', 'jumpBus'], ['JAM', 'jammerBus']] as const) {
          if (s.elec.tripped[sub]) c.set(sw, 0);
          else if (sub === 'JUMP') c.set(sw, 1);
        }
        if (j.charge >= j.requiredCharge * 1.02) c.set('jumpCharge', 0);
        else c.set('jumpCharge', 1);
        if (!s.avionics.solutionValid && s.avionics.solveTimer <= 0 && dt > 1) c.press('jumpSolve');
        if (s.avionics.solutionValid && !j.synced && !j.syncing && s.omegaDegMag < 1) c.press('jumpSync');
        c.set('safetyPin', 1);
        if (s.jammer.cap < 0.02) c.set('jamEngage', 0);
        const st = j.stability.total;
        if (j.synced && st > 0.94 && s.avionics.solutionValid && t - s.avionics.solutionTime < 20) { this.press('jumpEngage'); this.go('engage'); }
        if (s.avionics.solutionValid && t - s.avionics.solutionTime > 40) c.press('jumpSolve');
        break;
      }
      case 'engage':
        break;
    }
  }

  status(): string {
    const run = this.run;
    const s = run.ship;
    const e = s.env;
    return `t=${run.time.toFixed(0)} ph=${this.phase} alt=${(e.altitude / 1000).toFixed(1)}km v=${s.vel.length().toFixed(0)} M=${e.mach.toFixed(2)} q=${(e.q / 1000).toFixed(1)}k pit=${(e.attitude.pitch * RAD).toFixed(0)} hdg=${(e.attitude.heading * RAD).toFixed(0)} nz=${e.nz.toFixed(2)} hull=${s.thermal.hullTemp.toFixed(0)}K eng=${s.engines.A.temp.toFixed(0)}/${s.engines.B.temp.toFixed(0)} fuel=${s.fuel.core.toFixed(0)}/${s.fuel.svc.toFixed(0)} m=${s.massModel.mass.toFixed(0)} hyd=${s.hyd.A.pressure.toFixed(1)} V=${s.elec.volts.A.toFixed(1)}/${s.elec.volts.B.toFixed(1)} alert=${run.flightCommand.alert.toFixed(0)} trace=${run.tracking.trace.toFixed(2)} jam=${s.jammer.cap.toFixed(2)}/${s.jammer.temp.toFixed(0)}C jc=${s.jump.charge.toFixed(2)}/${s.jump.requiredCharge.toFixed(2)} S=${s.jump.stability.total.toFixed(3)} ev=${run.events.selected.id}:${run.events.status} lat=${run.fd.routeQ?.latRatio.toFixed(2)} vr=${run.fd.routeQ?.vertRatio.toFixed(2)} struct=${s.damage.health.structure.toFixed(2)}`;
  }
}

export function simulateRun(seed: number, maxTime = 900, verbose = false, statusEvery = 10) {
  const run = new Run(seed);
  const bot = new BotPilot(run, verbose);
  const dt = 1 / 120;
  let next = 0;
  while (!run.ended && run.time < maxTime) {
    bot.tick();
    run.step(dt);
    if (verbose && run.time >= next) {
      console.log(bot.status());
      next += statusEvery;
    }
  }
  return { run, bot };
}

export const _d = DEG;
