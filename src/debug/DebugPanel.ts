import type { Game } from '../core/Game';
import { ALL_EVENTS } from '../events/EventDirector';
import { HEALTH_KEYS } from '../ship/DamageModel';
import { RAD } from '../core/mathutil';
import { BotPilot } from './BotPilot';
import { PLANET } from '../physics/PlanetPhysics';

/** Developer-only telemetry + commands. Enabled with ?debug=1, toggled with F1. Never in normal play. */
export class DebugPanel {
  el: HTMLElement;
  private out: HTMLElement;
  private visible = false;

  constructor(private game: Game) {
    this.el = document.createElement('div');
    this.el.className = 'debug hidden';
    this.el.innerHTML = `
      <div class="dbg-out"></div>
      <div class="dbg-cmd">
        <select class="ev">${ALL_EVENTS.map((e) => `<option value="${e.id}">${e.name}</option>`).join('')}</select><button data-c="event">trigger event</button><br>
        <select class="dmg">${HEALTH_KEYS.map((k) => `<option>${k}</option>`).join('')}</select><button data-c="damage">damage 50%</button><button data-c="restore">restore ship</button><br>
        alt km <input class="alt" value="60" size="4"> <button data-c="tele">teleport</button> speed <input class="spd" value="1500" size="5"><button data-c="vel">set velocity</button><br>
        <button data-c="sep">simulate separation</button><button data-c="int">spawn interceptor</button><button data-c="sweep">force sweep</button><button data-c="jump">charge jump drive</button><br>
        <button data-c="bot">toggle bot pilot</button><button data-c="space">space-ready config</button>
      </div>`;
    document.body.appendChild(this.el);
    this.out = this.el.querySelector('.dbg-out')!;
    this.el.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => b.addEventListener('click', () => this.cmd(b.dataset.c!)));
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.classList.toggle('hidden', !this.visible);
    if (this.visible) this.game.input.exitLock();
  }

  private cmd(c: string): void {
    const g = this.game;
    const run = g.run;
    const s = run.ship;
    switch (c) {
      case 'event': {
        const id = (this.el.querySelector('.ev') as HTMLSelectElement).value;
        const ev = ALL_EVENTS.find((e) => e.id === id)!;
        if (run.events.status === 'active') run.events.finish('expired');
        run.events.trigger(ev);
        break;
      }
      case 'damage': s.damage.hit((this.el.querySelector('.dmg') as HTMLSelectElement).value, 0.5); break;
      case 'restore':
        for (const k of HEALTH_KEYS) s.damage.health[k] = 1;
        s.thermal.hullTemp = 300;
        s.engines.A.temp = s.engines.B.temp = 300;
        break;
      case 'tele': {
        const km = parseFloat((this.el.querySelector('.alt') as HTMLInputElement).value);
        s.pos.setLength(PLANET.radius + km * 1000);
        break;
      }
      case 'vel': {
        const v = parseFloat((this.el.querySelector('.spd') as HTMLInputElement).value);
        s.vel.copy(s.forward()).multiplyScalar(v);
        break;
      }
      case 'sep':
        s.pax.inCabin = 0;
        for (const p of s.pax.pods) p.occupants = 0;
        s.sep.separate(s, false);
        break;
      case 'int': run.interceptors.spawnInterceptor(s.pos.clone().add(s.env.east.clone().multiplyScalar(30_000))); break;
      case 'sweep': run.tracking.forceSweep(); break;
      case 'jump': s.jump.charge = s.jump.requiredCharge; break;
      case 'bot': g.bot = g.bot ? null : new BotPilot(run); break;
      case 'space':
        for (const [k, v] of [['hydA', 1], ['hydB', 1], ['fuelPumpA', 1], ['fuelPumpB', 1], ['engMaster', 1], ['rcsMaster', 1], ['rcsMode', 2], ['gear', 0], ['parkBrake', 0]] as const) s.controls.set(k, v);
        for (const e of [s.engines.A, s.engines.B]) { e.state = 'running'; e.N = 0.5; }
        s.pos.setLength(PLANET.radius + 120_000);
        s.vel.copy(s.env.east).multiplyScalar(2500);
        break;
    }
  }

  update(): void {
    if (!this.visible) return;
    const g = this.game;
    const run = g.run;
    const s = run.ship;
    const e = s.env;
    const tr = run.tracking;
    const nextSweep = Math.min(...tr.sites.map((x) => x.nextSweep)) - s.time;
    const rows: [string, string][] = [
      ['FPS', g.fps.toFixed(0)], ['seed', run.seedStr], ['state', g.state], ['t', s.time.toFixed(1)],
      ['alt', `${(e.altitude / 1000).toFixed(2)} km`], ['TAS', `${e.tas.toFixed(0)} m/s`], ['Mach', e.mach.toFixed(2)], ['VS', e.vs.toFixed(0)],
      ['AoA', `${(e.alpha * RAD).toFixed(1)}°`], ['q', `${(e.q / 1000).toFixed(1)} kPa`], ['G', e.nz.toFixed(2)], ['mass', `${(s.massModel.mass / 1000).toFixed(1)} t`],
      ['thrust', `${((s.engines.A.thrust + s.engines.B.thrust) / 1000).toFixed(0)} kN`], ['eng T', `${s.engines.A.temp.toFixed(0)}/${s.engines.B.temp.toFixed(0)}`],
      ['hull', `${s.thermal.hullTemp.toFixed(0)} K`], ['fuel', `${s.fuel.core.toFixed(0)}/${s.fuel.svc.toFixed(0)}`], ['hyd', `${s.hyd.A.pressure.toFixed(1)}/${s.hyd.B.pressure.toFixed(1)} MPa`],
      ['bus', `A${s.elec.volts.A.toFixed(1)} B${s.elec.volts.B.toFixed(1)} AV${s.elec.volts.AV.toFixed(1)} E${s.elec.volts.EMER.toFixed(1)} J${s.elec.volts.JUMP.toFixed(1)}`],
      ['alert', `${run.flightCommand.alert.toFixed(1)} ${run.flightCommand.level}`], ['trace', tr.trace.toFixed(2)], ['next sweep', `${nextSweep.toFixed(1)} s`],
      ['jammer', `cap ${s.jammer.cap.toFixed(2)} T ${s.jammer.temp.toFixed(0)} field ${s.jammer.field.toFixed(2)}`],
      ['jump', `${s.jump.charge.toFixed(2)}/${s.jump.requiredCharge.toFixed(2)} S ${(s.jump.stability.total * 100).toFixed(1)}%`],
      ['event', `${run.events.selected.id} [${run.events.status}] trig@${(run.events.triggerAlt / 1000).toFixed(0)}km`],
      ['objects', String(run.objects.filter((o) => o.alive).length)], ['bot', g.bot ? g.bot.phase : 'off'],
    ];
    this.out.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }
}
