import type { SaveManager, Settings } from '../core/SaveManager';
import { fmtTime } from '../core/mathutil';
import { SIDEGRADES, COSMETICS } from '../data/Sidegrades';
import { ALL_EVENTS } from '../events/EventDirector';
import { FAILURE_TITLES } from '../data/Snark';
import type { Run } from '../core/Run';

type Summary = ReturnType<Run['summary']>;

export interface UIHandlers {
  onFly: (seed?: string) => void;
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
  onSettings: () => void;
  onCosmetics: () => void;
}

const h = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class UI {
  private screens: Record<string, HTMLElement> = {};
  private hud: HTMLElement;
  private timer: HTMLElement;
  private reticle: HTMLElement;
  private tip: HTMLElement;
  private subs: HTMLElement;
  private lockPrompt: HTMLElement;
  private stickTag: HTMLElement;
  private settingsReturn: 'menu' | 'pause' = 'menu';

  constructor(private root: HTMLElement, private save: SaveManager, private on: UIHandlers) {
    this.hud = h(`<div class="flight-hud hidden">
      <div class="timer"></div>
      <div class="reticle"></div>
      <div class="tip"></div>
      <div class="stick-tag">HAND ON STICK · LMB release · hold RMB to look</div>
      <div class="lock-prompt">CLICK TO TAKE CONTROL</div>
      <div class="subs"></div>
    </div>`);
    root.appendChild(this.hud);
    this.timer = this.hud.querySelector('.timer')!;
    this.reticle = this.hud.querySelector('.reticle')!;
    this.tip = this.hud.querySelector('.tip')!;
    this.subs = this.hud.querySelector('.subs')!;
    this.lockPrompt = this.hud.querySelector('.lock-prompt')!;
    this.stickTag = this.hud.querySelector('.stick-tag')!;
    for (const k of ['menu', 'pause', 'failure', 'results', 'settings', 'records', 'market']) {
      const el = h(`<div class="screen hidden screen-${k}"></div>`);
      root.appendChild(el);
      this.screens[k] = el;
    }
    if (save.recovered) setTimeout(() => this.subtitle('SYSTEM', 'Save data was corrupt and has been reset. A copy was kept.', 'system'), 500);
  }

  private show(name: string | null): void {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name);
  }

  // ── menu ──────────────────────────────────────────────
  showMenu(): void {
    const d = this.save.data;
    this.hud.classList.add('hidden');
    const el = this.screens.menu;
    el.innerHTML = `
      <div class="menu-wrap">
        <div class="authority">PLANETARY CIVIL FLIGHT AUTHORITY · DEPARTURE CONTROL · FORM PFA-001</div>
        <h1 class="title">NO CLEARANCE</h1>
        <div class="tagline">There is only the cockpit, the planet, the timer, and the jump.</div>
        <div class="menu-buttons">
          <button data-a="fly" class="primary">FLY</button>
          <button data-a="records">RECORDS</button>
          <button data-a="market">BLACK MARKET</button>
          <button data-a="settings">SETTINGS</button>
        </div>
        <div class="menu-meta">
          <span>CONTRABAND CREDITS <b>${d.credits}</b></span>
          <span>RUNS <b>${d.runs}</b></span>
          <span>ESCAPES <b>${d.escapes}</b></span>
          <span>PB <b>${d.personalBest !== null ? fmtTime(d.personalBest) : '--:--.--'}</b></span>
        </div>
        <details class="seed"><summary>replay a seed</summary><input maxlength="8" placeholder="e.g. 1234ABCD" spellcheck="false"><button data-a="seedfly">FLY SEED</button></details>
        <div class="footer">UNSCHEDULED ORBITAL DEPARTURE IS A CRIMINAL OFFENCE · THIS TERMINAL IS MONITORED</div>
      </div>`;
    el.querySelector('[data-a=fly]')!.addEventListener('click', () => this.on.onFly());
    el.querySelector('[data-a=records]')!.addEventListener('click', () => this.showRecords());
    el.querySelector('[data-a=market]')!.addEventListener('click', () => this.showMarket());
    el.querySelector('[data-a=settings]')!.addEventListener('click', () => this.showSettings('menu'));
    el.querySelector('[data-a=seedfly]')!.addEventListener('click', () => {
      const v = (el.querySelector('.seed input') as HTMLInputElement).value;
      this.on.onFly(v || undefined);
    });
    this.show('menu');
  }

  // ── flight overlay ────────────────────────────────────
  showFlight(): void {
    this.show(null);
    this.hud.classList.remove('hidden');
    this.reticle.className = 'reticle ' + this.save.data.cosmetics.reticle;
  }

  updateFlight(s: { time: number; pb: number | null; runNo: number; tooltip: string; hovering: boolean; stick: boolean; locked: boolean }): void {
    this.timer.textContent = `RUN ${fmtTime(s.time)}   PB ${s.pb !== null ? fmtTime(s.pb) : '--:--.--'}   #${s.runNo}`;
    this.tip.textContent = s.tooltip;
    this.reticle.classList.toggle('hover', s.hovering);
    this.stickTag.style.display = s.stick ? 'block' : 'none';
    this.lockPrompt.style.display = s.locked ? 'none' : 'block';
  }

  subtitle(from: string, text: string, tone: string): void {
    const line = h(`<div class="sub tone-${tone}"><b>${esc(from)}:</b> ${esc(text)}</div>`);
    this.subs.appendChild(line);
    while (this.subs.children.length > 3) this.subs.firstElementChild!.remove();
    setTimeout(() => line.classList.add('fade'), Math.max(5000, text.length * 75));
    setTimeout(() => line.remove(), Math.max(6000, text.length * 75 + 1200));
  }

  // ── pause ─────────────────────────────────────────────
  showPause(): void {
    this.hud.classList.add('hidden');
    const el = this.screens.pause;
    el.innerHTML = `
      <div class="panel-box">
        <h2>HOLDING PATTERN</h2>
        <div class="sub-title">Physics and timers are frozen. The government is patient.</div>
        <div class="menu-buttons">
          <button data-a="resume" class="primary">RESUME</button>
          <button data-a="restart">RESTART RUN</button>
          <button data-a="settings">SETTINGS</button>
          <button data-a="menu">EXIT TO MENU</button>
        </div>
        <div class="inputs">
          <div><b>MOUSE</b> look · <b>LMB</b> operate / drag levers, knobs, handles · <b>RMB</b> reverse a switch · <b>WHEEL</b> rotate knob / zoom · <b>MMB/Z</b> zoom</div>
          <div><b>STICK</b> click it to take hold, mouse deflects, LMB releases, hold RMB to look · or <b>W A S D</b></div>
          <div><b>Q/E</b> rudder · <b>R/F</b> throttle · <b>B</b> wheel brake · <b>I K J L U O</b> RCS translate · <b>SPACE</b> recentre view</div>
        </div>
      </div>`;
    el.querySelector('[data-a=resume]')!.addEventListener('click', () => this.on.onResume());
    el.querySelector('[data-a=restart]')!.addEventListener('click', () => this.on.onRestart());
    el.querySelector('[data-a=settings]')!.addEventListener('click', () => this.showSettings('pause'));
    el.querySelector('[data-a=menu]')!.addEventListener('click', () => this.on.onMenu());
    this.show('pause');
  }

  // ── failure / results ─────────────────────────────────
  private rewardHtml(sum: Summary): string {
    const r = sum.reward;
    if (!r) return '';
    const lines = r.lines.map((l) => `<div class="kv"><span>${esc(l.label)}</span><b>+${l.amount}</b></div>`).join('');
    return `<div class="reward">${lines}<div class="kv total"><span>CONTRABAND CREDITS</span><b>${r.total}</b></div></div>`;
  }

  showFailure(sum: Summary, pb: number | null): void {
    this.hud.classList.add('hidden');
    const f = sum.failure!;
    const el = this.screens.failure;
    el.innerHTML = `
      <div class="panel-box fail">
        <div class="stamp">RUN TERMINATED</div>
        <h2>${esc(f.title)}</h2>
        <div class="detail">${esc(f.detail)}</div>
        <blockquote>${esc(f.snark)}</blockquote>
        <div class="grid">
          <div class="kv"><span>RUN TIME</span><b>${fmtTime(sum.time)}</b></div>
          <div class="kv"><span>MAX ALTITUDE</span><b>${(sum.maxAlt / 1000).toFixed(1)} km</b></div>
          <div class="kv"><span>EVENT</span><b>${esc(sum.event)}</b></div>
          <div class="kv"><span>GOVERNMENT ALERT PEAK</span><b>${sum.alertPeak.toFixed(0)}%</b></div>
          <div class="kv"><span>PERSONAL BEST</span><b>${pb !== null ? fmtTime(pb) : '--:--.--'}</b></div>
          <div class="kv"><span>SEED</span><b class="mono">${sum.seed}</b></div>
        </div>
        ${this.rewardHtml(sum)}
        <div class="menu-buttons row">
          <button data-a="restart" class="primary">RESTART  [R]</button>
          <button data-a="menu">MENU</button>
        </div>
      </div>`;
    el.querySelector('[data-a=restart]')!.addEventListener('click', () => this.on.onRestart());
    el.querySelector('[data-a=menu]')!.addEventListener('click', () => this.on.onMenu());
    this.show('failure');
  }

  showResults(sum: Summary, pb: number | null, line: string): void {
    this.hud.classList.add('hidden');
    const el = this.screens.results;
    const kv = (k: string, v: string) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
    el.innerHTML = `
      <div class="panel-box win">
        <div class="stamp ok">ESCAPE CONFIRMED</div>
        <blockquote>${esc(line)}</blockquote>
        <div class="grid">
          ${kv('RUN TIME', fmtTime(sum.time))}
          ${kv('PERSONAL BEST', pb !== null ? fmtTime(pb) : '--')}
          ${kv('MAX ALTITUDE', (sum.maxAlt / 1000).toFixed(1) + ' km')}
          ${kv('MAX SPEED', Math.round(sum.maxSpeed) + ' m/s')}
          ${kv('MAX MACH', sum.maxMach.toFixed(2))}
          ${kv('MAX G', sum.maxG.toFixed(1))}
          ${kv('PEAK HEAT', Math.round(sum.peakHeat) + ' K')}
          ${kv('GOVERNMENT TRACE PEAK', (sum.tracePeak * 100).toFixed(0) + '%')}
          ${kv('MASKING TIME', sum.maskingTime.toFixed(1) + ' s')}
          ${kv('EVENT', esc(sum.event))}
          ${kv('EVENT OUTCOME', sum.eventOutcome.toUpperCase())}
          ${kv('PASSENGERS EVACUATED', String(sum.passengersEvacuated))}
          ${kv('SHIP DAMAGE', (sum.damage * 100).toFixed(0) + '%')}
          ${kv('FIELD STABILITY', sum.jumpStability !== null ? (sum.jumpStability * 100).toFixed(1) + '%' : '--')}
          ${kv('RUN SEED', `<span class="mono">${sum.seed}</span>`)}
        </div>
        ${this.rewardHtml(sum)}
        <div class="menu-buttons row">
          <button data-a="restart" class="primary">FLY AGAIN  [R]</button>
          <button data-a="menu">MENU</button>
        </div>
      </div>`;
    el.querySelector('[data-a=restart]')!.addEventListener('click', () => this.on.onRestart());
    el.querySelector('[data-a=menu]')!.addEventListener('click', () => this.on.onMenu());
    this.show('results');
  }

  // ── settings ──────────────────────────────────────────
  showSettings(from: 'menu' | 'pause'): void {
    this.settingsReturn = from;
    const s = this.save.data.settings;
    const el = this.screens.settings;
    const slider = (k: keyof Settings, label: string, min: number, max: number, step: number) =>
      `<label class="row"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${s[k]}"><i>${s[k]}</i></label>`;
    const check = (k: keyof Settings, label: string) => `<label class="row"><span>${label}</span><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}></label>`;
    el.innerHTML = `
      <div class="panel-box settings">
        <h2>SETTINGS</h2>
        <div class="cols">
          <div>
            <h3>CONTROL</h3>
            ${slider('sensitivity', 'Mouse sensitivity', 0.2, 3, 0.05)}
            ${check('invertY', 'Invert Y')}
            ${slider('fov', 'Field of view', 55, 100, 1)}
            ${check('tooltips', 'Control name readout')}
            <h3>AUDIO</h3>
            ${slider('master', 'Master volume', 0, 1, 0.05)}
            ${slider('radio', 'Radio volume', 0, 1, 0.05)}
            ${slider('effects', 'Effects volume', 0, 1, 0.05)}
            ${slider('music', 'Music volume', 0, 1, 0.05)}
            ${check('radioVoice', 'Radio voice (system speech)')}
          </div>
          <div>
            <h3>VIDEO</h3>
            <label class="row"><span>Graphics quality</span><select data-k="quality">${['low', 'medium', 'high'].map((q) => `<option ${s.quality === q ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
            ${slider('resolutionScale', 'Resolution scale', 0.5, 1, 0.05)}
            ${slider('shake', 'Camera shake', 0, 1.5, 0.05)}
            ${check('reducedFlashing', 'Reduced flashing')}
            ${check('reducedMotion', 'Reduced motion')}
            <label class="row"><span>Fullscreen</span><button data-a="fs">TOGGLE</button></label>
            <h3>DATA</h3>
            <label class="row"><span>Erase all progress</span><button data-a="wipe" class="danger">ERASE</button></label>
          </div>
        </div>
        <div class="menu-buttons row"><button data-a="back" class="primary">BACK</button></div>
      </div>`;
    el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k as keyof Settings;
        const v: any = inp instanceof HTMLInputElement && inp.type === 'checkbox' ? inp.checked : inp instanceof HTMLInputElement ? parseFloat(inp.value) : inp.value;
        (this.save.data.settings as any)[k] = v;
        const i = inp.parentElement?.querySelector('i');
        if (i) i.textContent = String(v);
        this.save.save();
        this.on.onSettings();
      });
    });
    el.querySelector('[data-a=fs]')!.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    });
    el.querySelector('[data-a=wipe]')!.addEventListener('click', () => {
      if (confirm('Erase all runs, credits and purchases? The Ministry will not be able to restore them.')) {
        this.save.reset();
        this.on.onSettings();
        this.showSettings(from);
      }
    });
    el.querySelector('[data-a=back]')!.addEventListener('click', () => (this.settingsReturn === 'menu' ? this.showMenu() : this.showPause()));
    this.show('settings');
  }

  // ── records ───────────────────────────────────────────
  showRecords(): void {
    const d = this.save.data;
    const el = this.screens.records;
    const causes = Object.entries(d.failureCauses).sort((a, b) => b[1] - a[1]);
    el.innerHTML = `
      <div class="panel-box records">
        <h2>RECORDS</h2>
        <div class="grid">
          <div class="kv"><span>RUNS</span><b>${d.runs}</b></div>
          <div class="kv"><span>ESCAPES</span><b>${d.escapes}</b></div>
          <div class="kv"><span>FAILURES</span><b>${d.failures}</b></div>
          <div class="kv"><span>BEST ESCAPE</span><b>${d.personalBest !== null ? fmtTime(d.personalBest) : '--:--.--'}</b></div>
          <div class="kv"><span>BEST ALTITUDE</span><b>${(d.bestAltitude / 1000).toFixed(1)} km</b></div>
          <div class="kv"><span>EVENTS DISCOVERED</span><b>${d.eventsSeen.length} / ${ALL_EVENTS.length}</b></div>
        </div>
        <div class="cols">
          <div><h3>HOW YOU DIED</h3>${causes.length ? causes.map(([c, n]) => `<div class="kv"><span>${esc(FAILURE_TITLES[c] ?? c)}</span><b>${n}</b></div>`).join('') : '<i>Nothing yet. Give it time.</i>'}</div>
          <div><h3>RECENT RUNS</h3><table>${d.history.slice(0, 12).map((r) => `<tr><td>#${r.n}</td><td>${fmtTime(r.time)}</td><td class="${r.escaped ? 'ok' : 'bad'}">${esc(r.cause)}</td><td>${(r.maxAlt / 1000).toFixed(0)}km</td><td class="mono">${r.seed}</td></tr>`).join('')}</table></div>
        </div>
        <h3>EVENTS SEEN</h3>
        <div class="tags">${ALL_EVENTS.map((e) => `<span class="${d.eventsSeen.includes(e.id) ? 'on' : ''}">${d.eventsSeen.includes(e.id) ? esc(e.name) : '██████'}</span>`).join('')}</div>
        <h3>CITATIONS</h3>
        <div class="tags">${['first_run', 'wheels_up', 'karman', 'escape', 'ghost', 'coffee'].map((a) => `<span class="${d.achievements.includes(a) ? 'on' : ''}">${{ first_run: 'Filed a flight plan', wheels_up: 'Wheels up', karman: 'Technically in space', escape: 'Unscheduled departure', ghost: 'Never suspected', coffee: 'Beverage incident' }[a]}</span>`).join('')}</div>
        <div class="menu-buttons row"><button data-a="back" class="primary">BACK</button></div>
      </div>`;
    el.querySelector('[data-a=back]')!.addEventListener('click', () => this.showMenu());
    this.show('records');
  }

  // ── black market ──────────────────────────────────────
  showMarket(): void {
    const d = this.save.data;
    const el = this.screens.market;
    const sg = SIDEGRADES.map((s) => {
      const owned = d.owned.includes(s.id);
      const eq = d.equipped.includes(s.id);
      return `<div class="item ${eq ? 'eq' : ''}"><div><b>${esc(s.name)}</b> <small>[${s.slot}]</small><div class="pc"><span class="pro">${esc(s.pros)}</span> · <span class="con">${esc(s.cons)}</span></div></div>
        ${owned ? `<button data-eq="${s.id}">${eq ? 'UNEQUIP' : 'EQUIP'}</button>` : `<button data-buy="${s.id}" ${d.credits < s.cost ? 'disabled' : ''}>${s.cost} CC</button>`}</div>`;
    }).join('');
    const cos = COSMETICS.map((c) => {
      const owned = d.owned.includes(c.id) || c.cost === 0;
      const active = d.cosmetics.paint === c.id || d.cosmetics.reticle === c.id || d.cosmetics.display === c.id.replace('warn_', '') || (c.kind === 'snark' && d.cosmetics.snark);
      return `<div class="item ${active ? 'eq' : ''}"><div><b>${esc(c.name)}</b> <small>[${c.kind}]</small></div>${owned ? `<button data-use="${c.id}">${active ? 'IN USE' : 'USE'}</button>` : `<button data-buy="${c.id}" ${d.credits < c.cost ? 'disabled' : ''}>${c.cost} CC</button>`}</div>`;
    }).join('');
    el.innerHTML = `
      <div class="panel-box market">
        <h2>BLACK MARKET</h2>
        <div class="sub-title">Everything here makes something better and something else worse. Credits: <b>${d.credits} CC</b></div>
        <div class="cols"><div><h3>SIDEGRADES <small>(one per slot)</small></h3>${sg}</div><div><h3>COSMETICS</h3>${cos}</div></div>
        <div class="menu-buttons row"><button data-a="back" class="primary">BACK</button></div>
      </div>`;
    el.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.buy!;
        const cost = SIDEGRADES.find((s) => s.id === id)?.cost ?? COSMETICS.find((c) => c.id === id)?.cost ?? 0;
        if (d.credits >= cost && !d.owned.includes(id)) {
          d.credits -= cost;
          d.owned.push(id);
          this.save.save();
        }
        this.showMarket();
      }),
    );
    el.querySelectorAll<HTMLButtonElement>('[data-eq]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.eq!;
        const sgd = SIDEGRADES.find((s) => s.id === id)!;
        if (d.equipped.includes(id)) d.equipped = d.equipped.filter((x) => x !== id);
        else {
          d.equipped = d.equipped.filter((x) => SIDEGRADES.find((s) => s.id === x)?.slot !== sgd.slot);
          d.equipped.push(id);
        }
        this.save.save();
        this.showMarket();
      }),
    );
    el.querySelectorAll<HTMLButtonElement>('[data-use]').forEach((b) =>
      b.addEventListener('click', () => {
        const c = COSMETICS.find((x) => x.id === b.dataset.use)!;
        if (c.kind === 'paint') d.cosmetics.paint = c.id;
        if (c.kind === 'reticle') d.cosmetics.reticle = c.id;
        if (c.kind === 'warning') d.cosmetics.display = c.id.replace('warn_', '');
        if (c.kind === 'snark') d.cosmetics.snark = !d.cosmetics.snark;
        this.save.save();
        this.on.onCosmetics();
        this.showMarket();
      }),
    );
    el.querySelector('[data-a=back]')!.addEventListener('click', () => this.showMenu());
    this.show('market');
  }
}
