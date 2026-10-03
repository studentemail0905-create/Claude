import type { Run } from './Run';
import type { Settings } from './SaveManager';
import { clamp, clamp01 } from './mathutil';

type Layer = { gain: GainNode; filter?: BiquadFilterNode; osc?: OscillatorNode[]; src?: AudioBufferSourceNode };

/**
 * Fully procedural Web Audio: engine spool & combustion, wind that fades with air density,
 * structure-borne vibration, pumps, hum, RCS, distinct alarm categories, radio babble.
 */
export class AudioManager {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private radio!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private layers: Record<string, Layer> = {};
  private alarmTimers: Record<string, number> = {};
  private radioFilter!: BiquadFilterNode;
  private musicLayer: Layer | null = null;
  private runwayPhase = 0;
  private lastRcs = 0;
  enabled = false;
  private speechOk = typeof window !== 'undefined' && 'speechSynthesis' in window;
  muteFlight = false;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.radio = ctx.createGain();
    this.radioFilter = ctx.createBiquadFilter();
    this.radioFilter.type = 'bandpass';
    this.radioFilter.frequency.value = 1700;
    this.radioFilter.Q.value = 0.9;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      curve[i] = Math.tanh(x * 3);
    }
    shaper.curve = curve;
    this.radio.connect(this.radioFilter).connect(shaper).connect(this.master);
    this.music = ctx.createGain();
    this.music.connect(this.master);

    // noise buffers
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      d[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * d[i]) / 1.02;
      b[i] = last * 3.5;
    }
    this.buildLayers();
    this.enabled = true;
  }

  private noiseSrc(buf: AudioBuffer): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  private layer(name: string, src: AudioNode, type: BiquadFilterType, freq: number, q = 1, dest: AudioNode = this.sfx): Layer {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(dest);
    const l: Layer = { gain: g, filter: f };
    this.layers[name] = l;
    return l;
  }

  private oscLayer(name: string, freqs: number[], type: OscillatorType, filterType: BiquadFilterType, ff: number, q = 1): Layer {
    const ctx = this.ctx!;
    const mix = ctx.createGain();
    const oscs = freqs.map((fr) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = fr;
      o.connect(mix);
      o.start();
      return o;
    });
    const l = this.layer(name, mix, filterType, ff, q);
    l.osc = oscs;
    return l;
  }

  private buildLayers(): void {
    this.layer('rumble', this.noiseSrc(this.brown), 'lowpass', 120, 0.7);
    this.oscLayer('whineA', [220, 331], 'sawtooth', 'bandpass', 900, 3);
    this.oscLayer('whineB', [223, 334], 'sawtooth', 'bandpass', 900, 3);
    this.layer('crackle', this.noiseSrc(this.noise), 'bandpass', 1400, 0.8);
    this.layer('wind', this.noiseSrc(this.noise), 'bandpass', 600, 0.5);
    this.layer('buffet', this.noiseSrc(this.brown), 'lowpass', 70, 1);
    this.layer('runway', this.noiseSrc(this.brown), 'lowpass', 180, 0.7);
    this.oscLayer('hyd', [395, 790], 'square', 'bandpass', 800, 4);
    this.oscLayer('hum', [400, 800, 1200], 'sine', 'lowpass', 1500, 0.7);
    this.layer('cool', this.noiseSrc(this.brown), 'bandpass', 95, 2);
    this.layer('vent', this.noiseSrc(this.noise), 'lowpass', 700, 0.5);
    this.layer('rcs', this.noiseSrc(this.noise), 'highpass', 2200, 0.5);
    this.oscLayer('jam', [118, 121], 'sawtooth', 'lowpass', 500, 2);
    this.oscLayer('jump', [200, 301], 'sine', 'lowpass', 4000, 0.5);
    this.layer('static', this.noiseSrc(this.noise), 'bandpass', 2200, 0.6, this.radio);
    this.layer('scrape', this.noiseSrc(this.noise), 'bandpass', 900, 0.6);
  }

  private set(name: string, gain: number, t = 0.08): void {
    const l = this.layers[name];
    if (!l || !this.ctx) return;
    l.gain.gain.setTargetAtTime(Math.max(0, gain), this.ctx.currentTime, t);
  }

  private freq(name: string, f: number, t = 0.1): void {
    const l = this.layers[name];
    if (!l?.filter || !this.ctx) return;
    l.filter.frequency.setTargetAtTime(f, this.ctx.currentTime, t);
  }

  private oscFreq(name: string, base: number, t = 0.1): void {
    const l = this.layers[name];
    if (!l?.osc || !this.ctx) return;
    l.osc.forEach((o, i) => o.frequency.setTargetAtTime(base * (1 + i * 0.503), this.ctx!.currentTime, t));
  }

  applySettings(s: Settings): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.effects, t, 0.05);
    this.radio.gain.setTargetAtTime(s.radio * 1.4, t, 0.05);
    this.music.gain.setTargetAtTime(s.music * 0.5, t, 0.05);
  }

  /** Silence every flight layer (menu, results). */
  quiet(): void {
    for (const k of Object.keys(this.layers)) this.set(k, 0, 0.2);
    for (const k of Object.keys(this.alarmTimers)) this.alarmTimers[k] = 0;
  }

  update(dt: number, run: Run, alarms: { warning: boolean; caution: boolean }, t: number): void {
    if (!this.ctx || !this.enabled) return;
    const s = run.ship;
    const e = s.env;
    const dens = clamp01(e.atmo.density / 1.225);
    const air = Math.sqrt(dens);
    const nA = s.engines.A.N, nB = s.engines.B.N;
    const thrust = (s.engines.A.thrust + s.engines.B.thrust) / 1.36e6;
    // engines: structure-borne rumble always, combustion crackle needs air
    this.set('rumble', 0.25 * Math.max(nA, nB) + thrust * 0.5);
    this.freq('rumble', 60 + Math.max(nA, nB) * 260);
    this.set('whineA', nA * 0.035);
    this.set('whineB', nB * 0.035);
    this.oscFreq('whineA', 150 + nA * 520);
    this.oscFreq('whineB', 152 + nB * 524);
    this.freq('whineA', 400 + nA * 1600);
    this.freq('whineB', 400 + nB * 1600);
    this.set('crackle', thrust * 0.22 * (0.3 + 0.7 * air) * (0.7 + Math.random() * 0.6), 0.03);
    // aerodynamic noise: only where there is air
    const qk = e.q / 1000;
    this.set('wind', clamp(Math.sqrt(qk) * 0.06, 0, 0.6) * air + e.inCloud * 0.05);
    this.freq('wind', 300 + Math.min(4000, e.tas * 2.2 * (0.4 + air)));
    this.set('buffet', clamp(e.buffet * qk * 0.04 + s.weather.turbLevel * qk * 0.01, 0, 0.8) * (0.6 + 0.4 * Math.sin(t * 70)), 0.02);
    // runway roll + seams
    if (s.gear.wow) {
      this.runwayPhase += e.groundSpeed * dt;
      this.set('runway', clamp(e.groundSpeed / 90, 0, 0.6));
      if (this.runwayPhase > 25) {
        this.runwayPhase = 0;
        if (e.groundSpeed > 3) this.thump(0.15 + e.groundSpeed / 300);
      }
    } else this.set('runway', 0);
    this.set('scrape', clamp(s.bellyScrape / 40, 0, 0.8), 0.03);
    // systems
    const hydCount = (s.hyd.A.pumpRunning ? 1 : 0) + (s.hyd.B.pumpRunning ? 1 : 0);
    this.set('hyd', hydCount * 0.012);
    this.set('hum', s.elec.volts.A > 18 ? 0.006 + clamp(s.elec.totalLoad / 300, 0, 1) * 0.012 : 0);
    this.oscFreq('hum', 400 * (s.elec.volts.A > 1 ? s.elec.volts.A / 28 : 1));
    this.set('cool', (s.thermal.loop.A.running ? 0.05 : 0) + (s.thermal.loop.B.running ? 0.05 : 0));
    this.set('vent', s.press.packRunning ? 0.025 : 0);
    const rcs = s.rcs.activity;
    this.set('rcs', rcs > 0.05 ? 0.12 * rcs * (0.5 + Math.random() * 0.5) : 0, 0.015);
    if (rcs > 0.3 && t - this.lastRcs > 0.18) {
      this.lastRcs = t;
      this.thump(0.12 * rcs, 140);
    }
    this.set('jam', s.jammer.active ? 0.03 + s.jammer.field * 0.03 : 0);
    if (s.jammer.active) this.oscFreq('jam', 118 + Math.sin(t * 9) * 6 * s.jammer.field);
    const jc = s.jump.charge;
    this.set('jump', s.controls.get('jumpCharge') === 1 && s.jump.controlPowered ? 0.02 + jc * 0.025 : s.jump.coilsArmed ? 0.01 : 0);
    this.oscFreq('jump', 180 + jc * 1400 + (s.jump.sequence >= 0 ? s.jump.sequence * 2000 : 0));
    // radio static when receiver is on
    const rxOn = s.comms.powered(s);
    this.set('static', rxOn ? (0.004 + s.comms.static * 0.05) * s.controls.get('rxVol') : 0);

    // alarms (distinct categories)
    const lockFast = run.interceptors.missileInbound;
    const lockSlow = !lockFast && run.interceptors.lockWarning > 0.3;
    this.pattern('missile', lockFast, 0.12, () => this.beep(1900, 0.06, 0.1, 'square'));
    this.pattern('track', lockSlow || run.ghostLock > 0, 0.9, () => this.beep(1200, 0.08, 0.06, 'square'));
    this.pattern('stall', e.stalled && e.q > 300 && !e.onGround, 0.5, () => this.beep(440, 0.4, 0.09, 'sawtooth'));
    this.pattern('fire', s.engines.A.fire > 0 || s.engines.B.fire > 0 || !!s.elec.fire.bus, 0.9, () => this.bell());
    this.pattern('cabin', s.press.cockpit < 57_000 && s.elec.volts.EMER > 18, 1.4, () => this.whoop());
    this.pattern('overg', e.nz > s.structureLimits.nz * 0.9, 0.3, () => this.beep(300, 0.25, 0.08, 'square'));
    this.pattern('warning', alarms.warning && s.elec.volts.EMER > 18, 0.7, () => {
      this.beep(820, 0.25, 0.06, 'square');
      setTimeout(() => this.beep(620, 0.25, 0.06, 'square'), 300);
    });
    this.pattern('gear', s.sep.moduleAttached && s.gear.pos < 0.98 && e.agl < 300 && !e.onGround && s.vel.length() < 140 && e.vs < -2, 0.8, () => this.beep(650, 0.5, 0.05, 'triangle'));
    this.pattern('override', run.flightCommand.remoteOverride >= 0, 0.5, () => this.beep(980, 0.2, 0.07, 'sawtooth'));
  }

  private pattern(name: string, active: boolean, period: number, fire: () => void): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (!active) {
      this.alarmTimers[name] = 0;
      return;
    }
    if (!this.alarmTimers[name] || now >= this.alarmTimers[name]) {
      this.alarmTimers[name] = now + period;
      fire();
    }
  }

  // ── synthesis primitives ─────────────────────────────
  beep(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', when = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.setValueAtTime(gain, t + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, gain: number, type: BiquadFilterType, freq: number, q = 1, decay = 0.1, buf?: AudioBuffer, sweepTo?: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = buf ?? this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.setTargetAtTime(0, t + 0.005, decay);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t, Math.random());
    s.stop(t + dur);
  }

  private thump(gain: number, freq = 90): void {
    this.burst(0.3, gain, 'lowpass', freq, 1, 0.05, this.brown);
  }

  private click(freq = 3200, gain = 0.25): void {
    this.burst(0.05, gain, 'bandpass', freq, 2, 0.006);
    this.burst(0.06, gain * 0.5, 'bandpass', freq * 0.45, 3, 0.012);
  }

  private bell(): void {
    for (const [f, g] of [[880, 0.08], [1320, 0.05], [2090, 0.03]] as const) {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(g, t);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      o.connect(gn).connect(this.sfx);
      o.start(t);
      o.stop(t + 0.85);
    }
  }

  private whoop(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(1100, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.07, t);
    g.gain.linearRampToValueAtTime(0, t + 0.65);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.7);
  }

  /** Physical control actuation sounds. */
  control(kind: string): void {
    if (!this.ctx) return;
    switch (kind) {
      case 'toggle': this.click(2600, 0.3); break;
      case 'guard': this.click(1400, 0.3); this.thump(0.05, 300); break;
      case 'rotary': this.click(4200, 0.18); break;
      case 'knob': case 'knob_drag': this.click(5200, 0.06); break;
      case 'lever': case 'lever_drag': this.burst(0.08, 0.05, 'bandpass', 700, 1, 0.03); break;
      case 'button': case 'latch': this.click(1800, 0.22); break;
      case 'pull': case 'pull_drag': this.thump(0.25, 220); this.click(900, 0.25); break;
      case 'breaker': this.click(3600, 0.35); break;
      case 'stuck': this.thump(0.25, 160); this.click(700, 0.2); break;
      case 'stick_grab': this.burst(0.08, 0.04, 'lowpass', 400, 1, 0.03); break;
    }
  }

  /** One-shot simulation cues. */
  sfxCue(id: string, gain = 1): void {
    if (!this.ctx) return;
    switch (id) {
      case 'breaker_pop': this.click(3000, 0.45); break;
      case 'igniter_tick': for (let i = 0; i < 4; i++) setTimeout(() => this.click(5000, 0.25), i * 120); break;
      case 'eng_ignite': this.burst(1.6, 0.4, 'lowpass', 200, 0.8, 0.5, this.brown, 1600); break;
      case 'eng_shutdown': this.burst(2.5, 0.25, 'lowpass', 900, 0.8, 0.9, this.brown, 80); break;
      case 'flameout': this.thump(0.6, 120); this.burst(1.2, 0.2, 'lowpass', 800, 1, 0.4, this.brown, 60); break;
      case 'spark': for (let i = 0; i < 6; i++) setTimeout(() => this.burst(0.05, 0.3, 'highpass', 3000, 1, 0.01), i * 40 + Math.random() * 30); break;
      case 'explosion_small': this.burst(1.2, 0.8, 'lowpass', 600, 0.7, 0.3, this.brown, 60); break;
      case 'explosion_near': this.burst(1.8, 1.2, 'lowpass', 900, 0.7, 0.4, this.brown, 50); break;
      case 'pyro_bang': this.burst(0.8, 1.0, 'lowpass', 1200, 0.7, 0.12, this.noise, 80); this.thump(0.8, 70); break;
      case 'separation': this.burst(2.5, 1.0, 'lowpass', 500, 0.7, 0.6, this.brown, 40); setTimeout(() => this.creak(0.6), 400); break;
      case 'pod_fire': this.thump(0.5, 110); this.burst(1.0, 0.3, 'bandpass', 900, 0.7, 0.3, this.noise, 300); break;
      case 'gear_collapse': this.burst(1.0, 0.9, 'lowpass', 700, 0.8, 0.25, this.brown, 70); this.creak(0.8); break;
      case 'tire_burst': this.burst(0.3, 0.9, 'lowpass', 1500, 0.7, 0.05); break;
      case 'collision': case 'impact': this.burst(1.0, 1.0, 'lowpass', 1500, 0.8, 0.2, this.noise, 80); this.creak(0.6); break;
      case 'extinguisher': this.burst(3, 0.25, 'highpass', 1500, 0.5, 1.2); break;
      case 'cartridge': this.click(1200, 0.3); setTimeout(() => this.click(1600, 0.3), 180); setTimeout(() => this.beep(1400, 0.05, 0.05), 900); break;
      case 'nav_beep': this.beep(1500, 0.08, 0.06); break;
      case 'nav_reject': this.beep(300, 0.2, 0.08, 'square'); break;
      case 'ptt': this.burst(0.12, 0.15, 'bandpass', 2000, 1, 0.03); break;
      case 'arc': this.burst(0.25, 0.6, 'highpass', 2000, 0.5, 0.05); this.beep(60, 0.2, 0.2, 'sawtooth'); break;
      case 'quench': this.thump(0.8, 90); this.burst(2, 0.3, 'highpass', 1200, 0.5, 0.8); break;
      case 'sync_start': this.beep(600, 0.15, 0.05); this.beep(900, 0.15, 0.05, 'sine', 0.18); break;
      case 'sync_done': this.beep(1200, 0.3, 0.06); break;
      case 'fizzle': this.burst(1.5, 0.4, 'bandpass', 3000, 2, 0.5, this.noise, 200); break;
      case 'jump_spool': this.beep(120, 1.6, 0.12, 'sawtooth'); break;
      case 'cap_dump': this.burst(2, 0.4, 'bandpass', 2400, 1, 0.8, this.noise, 300); break;
      case 'decoy': this.thump(0.3, 200); this.burst(0.4, 0.2, 'highpass', 2500, 1, 0.1); break;
      case 'missile_launch_warn': for (let i = 0; i < 3; i++) this.beep(2400, 0.08, 0.1, 'square', i * 0.15); break;
      case 'ap_disconnect': for (let i = 0; i < 3; i++) this.beep(i % 2 ? 1100 : 1400, 0.18, 0.06, 'triangle', i * 0.2); break;
      case 'ap_engage': this.beep(1000, 0.1, 0.05); break;
      case 'clunk': this.thump(0.3, 160); this.click(600, 0.2); break;
      case 'button_dead': this.click(900, 0.12); break;
      case 'lock_release': case 'lock_engage': this.thump(0.5, 140); this.burst(0.4, 0.15, 'bandpass', 600, 2, 0.1); break;
      case 'creak': this.creak(gain); break;
      case 'prox_warn': for (let i = 0; i < 4; i++) this.beep(1600, 0.07, 0.06, 'square', i * 0.12); break;
      case 'alarm_jam': for (let i = 0; i < 3; i++) this.beep(700, 0.1, 0.06, 'sawtooth', i * 0.15); break;
      case 'alarm_override': this.beep(500, 0.6, 0.08, 'sawtooth'); break;
      case 'apu_start': this.burst(8, 0.12, 'bandpass', 200, 3, 3, this.noise, 2400); break;
      case 'master_caution': this.beep(1250, 0.22, 0.07); break;
      case 'master_warning': break; // handled by the latched warning pattern
      case 'fire_bell': this.bell(); break;
      case 'pyro_arm': this.click(2000, 0.3); break;
      case 'button_light': this.click(2400, 0.15); break;
    }
  }

  private creak(gain: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70 + Math.random() * 40, t);
    o.frequency.linearRampToValueAtTime(40 + Math.random() * 30, t + 0.6);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 300;
    f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12 * clamp01(gain), t + 0.1);
    g.gain.linearRampToValueAtTime(0, t + 0.6);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.65);
  }

  /** Radio transmission: squelch, bandlimited babble, squelch tail; optional system TTS. */
  radioCall(text: string, tone: string, rxVol: number, staticAmt: number, voice: boolean): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const vol = rxVol;
    if (vol <= 0.01) return;
    const sq = () => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const g = ctx.createGain();
      g.gain.value = 0.25 * vol;
      s.connect(g).connect(this.radio);
      return { s, g };
    };
    const a = sq();
    a.s.start(t0);
    a.s.stop(t0 + 0.08);
    if (voice && this.speechOk) {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = tone === 'pa' ? 0.95 : 1.12;
        u.pitch = tone === 'hostile' ? 0.6 : tone === 'pa' ? 1.1 : 0.85;
        u.volume = Math.min(1, vol);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } catch { /* ignore */ }
    } else {
      // syllable babble through formant filters
      const syl = Math.min(40, Math.max(6, Math.round(text.length / 3.2)));
      const base = tone === 'hostile' ? 95 : tone === 'pa' ? 190 : 120;
      for (let i = 0; i < syl; i++) {
        const t = t0 + 0.1 + i * 0.105 + (Math.random() - 0.5) * 0.02;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.25), t);
        const f1 = ctx.createBiquadFilter();
        f1.type = 'bandpass';
        f1.frequency.value = 500 + Math.random() * 600;
        f1.Q.value = 4;
        const f2 = ctx.createBiquadFilter();
        f2.type = 'bandpass';
        f2.frequency.value = 1300 + Math.random() * 1100;
        f2.Q.value = 5;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.5 * vol, t + 0.02);
        g.gain.linearRampToValueAtTime(0, t + 0.09);
        o.connect(f1).connect(g);
        o.connect(f2).connect(g);
        g.connect(this.radio);
        o.start(t);
        o.stop(t + 0.1);
      }
      const end = t0 + 0.15 + syl * 0.105;
      const b = sq();
      b.g.gain.value = (0.2 + staticAmt * 0.3) * vol;
      b.s.start(end);
      b.s.stop(end + 0.12);
    }
  }

  // ── menu music: slow authoritarian drone ───────────────
  startMusic(): void {
    if (!this.ctx || this.musicLayer) return;
    const ctx = this.ctx;
    const mix = ctx.createGain();
    const oscs = [55, 55.4, 82.4, 110.3].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(mix);
      o.start();
      return o;
    });
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 180;
    lfo.connect(lg).connect(f.frequency);
    lfo.start();
    const g = ctx.createGain();
    g.gain.value = 0;
    mix.connect(f).connect(g).connect(this.music);
    g.gain.setTargetAtTime(0.05, ctx.currentTime, 2);
    this.musicLayer = { gain: g, filter: f, osc: [...oscs, lfo] };
  }

  stopMusic(): void {
    if (!this.ctx || !this.musicLayer) return;
    const l = this.musicLayer;
    l.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
    setTimeout(() => l.osc?.forEach((o) => o.stop()), 2500);
    this.musicLayer = null;
  }

  /** Jump: crescendo → silence. Failure: impact. */
  jumpBoom(): void {
    this.burst(3, 1.2, 'lowpass', 3000, 0.5, 0.8, this.noise, 30);
    this.beep(40, 2.0, 0.4, 'sine');
  }

  crash(): void {
    this.burst(2.5, 1.3, 'lowpass', 1600, 0.6, 0.7, this.brown, 40);
    this.burst(1.0, 0.8, 'highpass', 800, 0.6, 0.3);
  }
}
