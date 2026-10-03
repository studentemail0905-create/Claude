import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Run } from './Run';
import { newSeed, stringToSeed } from './RNG';
import { Input } from './Input';
import { AudioManager } from './AudioManager';
import { SaveManager, type RunRecord } from './SaveManager';
import { clamp, clamp01, lerp } from './mathutil';
import { PlanetRenderer, createStars, sunDirection, LAUNCH_SITE } from '../world/Planet';
import { LaunchFacility } from '../world/LaunchFacility';
import { WorldObjects } from '../world/WorldObjects';
import { buildShipModel, setGear, type ShipModelParts } from '../world/ShipModel';
import { Cockpit } from '../cockpit/Cockpit';
import { InteractionManager } from '../cockpit/InteractionManager';
import { createFxPass } from '../render/FxPass';
import { PLANET } from '../physics/PlanetPhysics';
import { UI } from '../ui/UI';
import { DebugPanel } from '../debug/DebugPanel';
import { BotPilot } from '../debug/BotPilot';
import { ESCAPE_LINES } from '../data/Snark';
import { RNG } from './RNG';

export type GameState = 'menu' | 'flying' | 'paused' | 'ending' | 'ended';

const PHYS_DT = 1 / 120;

export class Game {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  worldScene = new THREE.Scene();
  cockpitScene = new THREE.Scene();
  worldCam: THREE.PerspectiveCamera;
  cockpitCam: THREE.PerspectiveCamera;
  planet = new PlanetRenderer();
  stars = createStars();
  facility = new LaunchFacility();
  objects = new WorldObjects();
  cockpit: Cockpit;
  exterior: ShipModelParts;
  menuShip: ShipModelParts;
  interaction: InteractionManager;
  input: Input;
  audio = new AudioManager();
  save = new SaveManager();
  ui: UI;
  debug: DebugPanel | null = null;
  run!: Run;
  state: GameState = 'menu';
  bot: BotPilot | null = null;
  /** Debug only: simulation speed multiplier (QA). */
  timeScale = 1;
  private cockpitPass: RenderPass;
  private bloom: UnrealBloomPass | null = null;
  private fx: ShaderPass;
  private sunWorld: THREE.DirectionalLight;
  private sunCockpit: THREE.DirectionalLight;
  private hemiWorld: THREE.HemisphereLight;
  private hemiCockpit: THREE.HemisphereLight;
  private ambCockpit: THREE.AmbientLight;
  private fog: THREE.FogExp2;
  private sunDir = sunDirection();
  private acc = 0;
  private last = performance.now();
  private prevEye = new THREE.Vector3();
  private currEye = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private currQuat = new THREE.Quaternion();
  private eye = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private shake = 0;
  private shakeT = 0;
  private flash = 0;
  private endTimer = 0;
  private menuT = 0;
  private time = 0;
  fps = 60;
  private fpsAcc = 0;
  private fpsN = 0;
  private runNo = 0;
  private unsub: (() => void)[] = [];
  private jumpVisual = 0;
  private lastRecord: RunRecord | null = null;
  private nightFactor = 0;
  private cockpitPaint = '';

  constructor(private container: HTMLElement, debug: boolean) {
    const r = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance', stencil: false });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.autoClear = true;
    container.appendChild(r.domElement);
    r.domElement.id = 'game-canvas';
    this.renderer = r;
    const aspect = window.innerWidth / window.innerHeight;
    this.worldCam = new THREE.PerspectiveCamera(75, aspect, 0.5, 1.2e9);
    this.cockpitCam = new THREE.PerspectiveCamera(75, aspect, 0.01, 400);

    // world scene
    this.worldScene.add(this.stars, this.planet.mesh, this.facility.group, this.objects.group);
    this.fog = new THREE.FogExp2(0x9bb4c8, 0.00003);
    this.worldScene.fog = this.fog;
    this.sunWorld = new THREE.DirectionalLight(0xffffff, 3);
    this.hemiWorld = new THREE.HemisphereLight(0x9cc0ff, 0x4a4035, 0.6);
    this.worldScene.add(this.sunWorld, this.sunWorld.target, this.hemiWorld);
    this.menuShip = buildShipModel();
    this.worldScene.add(this.menuShip.root);

    // cockpit scene
    this.cockpitPaint = this.save.data.cosmetics.paint;
    this.cockpit = new Cockpit(this.cockpitPaint);
    this.cockpit.setPalette(this.save.data.cosmetics.display);
    this.exterior = buildShipModel();
    this.cockpit.root.add(this.exterior.root);
    this.cockpitScene.add(this.cockpit.root);
    this.sunCockpit = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sunCockpit.castShadow = true;
    this.sunCockpit.shadow.mapSize.set(1024, 1024);
    const sc = this.sunCockpit.shadow.camera;
    sc.left = sc.bottom = -1.4;
    sc.right = sc.top = 1.4;
    sc.near = 0.5;
    sc.far = 8;
    this.sunCockpit.shadow.bias = -0.0008;
    this.sunCockpit.shadow.normalBias = 0.01;
    this.hemiCockpit = new THREE.HemisphereLight(0x9cc0ff, 0x3a3530, 0.5);
    this.ambCockpit = new THREE.AmbientLight(0xffffff, 0.4);
    this.cockpitScene.add(this.sunCockpit, this.sunCockpit.target, this.hemiCockpit, this.ambCockpit);

    // composer
    this.composer = new EffectComposer(r);
    const wp = new RenderPass(this.worldScene, this.worldCam);
    this.composer.addPass(wp);
    this.cockpitPass = new RenderPass(this.cockpitScene, this.cockpitCam);
    this.cockpitPass.clear = false;
    this.cockpitPass.clearDepth = true;
    this.composer.addPass(this.cockpitPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.fx = createFxPass();
    this.composer.addPass(this.fx);
    this.composer.addPass(new OutputPass());

    this.input = new Input(r.domElement);
    this.interaction = new InteractionManager(this.input, this.cockpit, this.cockpitCam);
    this.interaction.onControl = (c, kind) => {
      this.audio.control(kind);
      if (kind === 'stuck') this.flashTooltip('jammed');
    };

    this.ui = new UI(document.getElementById('ui')!, this.save, {
      onFly: (seed) => {
        this.audio.start();
        this.ui.showBriefing(() => this.startRun(seed));
      },
      onResume: () => this.resume(),
      onRestart: () => this.startRun(),
      onMenu: () => this.toMenu(),
      onSettings: () => this.applySettings(),
      onCosmetics: () => {
        this.cockpit.setPalette(this.save.data.cosmetics.display);
      },
    });
    if (debug) this.debug = new DebugPanel(this);

    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'flying' && !this.input.free) this.pause();
    });
    r.domElement.addEventListener('click', () => {
      if (this.state === 'flying' && !this.input.locked) this.input.requestLock();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR' && (this.state === 'ended') ) this.startRun();
      if (e.code === 'Enter' && this.state === 'ended') this.startRun();
      if (e.code === 'Escape' && this.state === 'flying' && this.input.free) this.pause();
      if (e.code === 'KeyP' && this.state === 'flying') this.pause();
      if (e.code === 'F1' && this.debug) {
        e.preventDefault();
        this.debug.toggle();
      }
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.applySettings();
    // a run object always exists so the menu background has a world to show
    this.run = new Run(newSeed());
    this.cockpit.setupRun(this.run);
    this.toMenu();
    (window as any).__nc = this;
    (window as any).__BotPilot = BotPilot;
    requestAnimationFrame(() => this.frame());
  }

  // ── settings ──────────────────────────────────────────
  applySettings(): void {
    const s = this.save.data.settings;
    this.worldCam.fov = this.cockpitCam.fov = s.fov;
    this.worldCam.updateProjectionMatrix();
    this.cockpitCam.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1) * s.resolutionScale * (s.quality === 'low' ? 0.75 : 1));
    this.renderer.shadowMap.enabled = s.quality !== 'low';
    this.sunCockpit.castShadow = s.quality !== 'low';
    if (this.bloom) this.bloom.enabled = s.quality === 'high';
    this.audio.applySettings(s);
    this.resize();
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    for (const c of [this.worldCam, this.cockpitCam]) {
      c.aspect = w / h;
      c.updateProjectionMatrix();
    }
    this.fx.uniforms.uAspect.value = w / h;
  }

  // ── lifecycle ─────────────────────────────────────────
  toMenu(): void {
    this.state = 'menu';
    this.input.exitLock();
    this.audio.quiet();
    this.bot = null;
    this.ui.showMenu();
    this.audio.startMusic();
    this.cockpitPass.enabled = false;
    this.menuShip.root.visible = true;
  }

  startRun(seedStr?: string): void {
    this.audio.start();
    this.audio.stopMusic();
    this.audio.applySettings(this.save.data.settings);
    const seed = seedStr ? stringToSeed(seedStr) ?? newSeed() : newSeed();
    for (const u of this.unsub) u();
    this.unsub = [];
    this.run = new Run(seed, { equipped: this.save.data.equipped, recentEvents: this.save.data.recentEvents });
    if (this.cockpitPaint !== this.save.data.cosmetics.paint) this.rebuildCockpit();
    this.runNo = this.save.data.runs + 1;
    this.cockpit.setupRun(this.run);
    this.interaction.reset();
    this.planet.setWeather(this.run.worldRoll);
    this.exterior.module.visible = true;
    this.exterior.pods.forEach((p) => (p.visible = true));
    this.menuShip.root.visible = false;
    this.cockpitPass.enabled = true;
    this.acc = 0;
    this.endTimer = 0;
    this.jumpVisual = 0;
    this.flash = 0;
    this.shake = 0;
    this.lastRecord = null;
    this.run.ship.eyePosition(this.currEye);
    this.prevEye.copy(this.currEye);
    this.currQuat.copy(this.run.ship.quat);
    this.prevQuat.copy(this.currQuat);
    const bus = this.run.bus;
    this.unsub.push(
      bus.on('sfx', (e) => this.audio.sfxCue(e.id, e.gain)),
      bus.on('shake', (e) => {
        if (!this.save.data.settings.reducedMotion) this.shake = Math.min(2, this.shake + e.amount);
      }),
      bus.on('radio', (e) => {
        const s = this.run.ship;
        const vol = s.controls.get('rxVol');
        if (e.tone === 'pa') this.audio.radioCall(e.text, e.tone, 0.6, 0, this.save.data.settings.radioVoice);
        else this.audio.radioCall(e.text, e.tone, vol, s.comms.static, this.save.data.settings.radioVoice);
        if (vol > 0.02 || e.tone === 'pa') this.ui.subtitle(e.from, e.text, e.tone);
      }),
      bus.on('separation', () => {
        this.exterior.module.visible = false;
      }),
      bus.on('podRelease', (e) => {
        this.exterior.pods[e.index].visible = false;
      }),
      bus.on('jump', (e) => {
        if (e.phase === 'success') this.audio.jumpBoom();
      }),
    );
    this.ui.showFlight();
    this.state = 'flying';
    this.input.requestLock();
    if (this.debug && new URLSearchParams(location.search).get('bot') === '1') this.bot = new BotPilot(this.run);
  }

  pause(): void {
    if (this.state !== 'flying') return;
    this.state = 'paused';
    this.audio.quiet();
    this.ui.showPause();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'flying';
    this.ui.showFlight();
    this.input.requestLock();
    this.last = performance.now();
  }

  private flashTooltip(_s: string): void {}

  /** Repaint: rebuild the cockpit with the newly chosen paint. */
  private rebuildCockpit(): void {
    this.cockpitScene.remove(this.cockpit.root);
    this.cockpitPaint = this.save.data.cosmetics.paint;
    this.cockpit = new Cockpit(this.cockpitPaint);
    this.cockpit.setPalette(this.save.data.cosmetics.display);
    this.cockpit.root.add(this.exterior.root);
    this.cockpitScene.add(this.cockpit.root);
    const onCtl = this.interaction.onControl;
    this.interaction = new InteractionManager(this.input, this.cockpit, this.cockpitCam);
    this.interaction.onControl = onCtl;
  }

  // ── main loop ─────────────────────────────────────────
  private frame(): void {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsN / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsN = 0;
    }

    if (this.state === 'menu') this.updateMenu(dt);
    else if (this.state === 'flying' || this.state === 'ending') this.updateFlight(dt);
    else if (this.state === 'paused' || this.state === 'ended') this.renderFlightView(dt, 1);
    this.debug?.update();
  }

  private updateFlight(dt: number): void {
    const run = this.run;
    const ship = run.ship;
    if (this.state === 'flying') {
      this.interaction.update(dt, run, this.save.data.settings);
      this.acc += dt * this.timeScale;
      let steps = 0;
      const maxSteps = 14 * this.timeScale;
      while (this.acc >= PHYS_DT && steps < maxSteps && !run.ended) {
        this.prevEye.copy(this.currEye);
        this.prevQuat.copy(this.currQuat);
        this.bot?.tick();
        run.step(PHYS_DT);
        ship.eyePosition(this.currEye);
        this.currQuat.copy(ship.quat);
        this.acc -= PHYS_DT;
        steps++;
      }
      if (steps >= maxSteps) this.acc = 0;
      if (run.ended) this.beginEnding();
    } else if (this.state === 'ending') {
      this.endTimer += dt;
      const limit = run.escaped ? 2.6 : 2.4;
      if (this.endTimer > limit) this.finishRun();
    }
    const alpha = clamp01(this.acc / PHYS_DT);
    this.renderFlightView(dt, alpha);
    if (this.state === 'flying') {
      this.audio.update(dt, run, { warning: this.cockpit.masterWarning, caution: this.cockpit.masterCaution }, this.time);
      this.ui.updateFlight({
        time: run.time,
        pb: this.save.data.personalBest,
        runNo: this.runNo,
        tooltip: this.save.data.settings.tooltips ? this.interaction.tooltip : '',
        hints: this.interaction.hints,
        hovering: !!this.interaction.hovered,
        stick: this.interaction.stickGrabbed,
        locked: this.input.locked || this.input.free,
        free: this.input.free && !this.input.locked,
      });
    }
  }

  private beginEnding(): void {
    this.state = 'ending';
    this.endTimer = 0;
    this.input.exitLock();
    if (!this.run.escaped) {
      this.audio.crash();
      this.flash = 1;
      if (!this.save.data.settings.reducedMotion) this.shake = 2;
    }
  }

  private finishRun(): void {
    this.state = 'ended';
    this.audio.quiet();
    const run = this.run;
    const sum = run.summary();
    const d = this.save.data;
    d.runs++;
    const credits = sum.reward?.total ?? 0;
    d.credits += credits;
    d.bestAltitude = Math.max(d.bestAltitude, sum.maxAlt);
    if (sum.escaped) {
      d.escapes++;
      if (d.personalBest === null || sum.time < d.personalBest) d.personalBest = sum.time;
    } else {
      d.failures++;
      const cause = sum.failure?.cause ?? 'unknown';
      d.failureCauses[cause] = (d.failureCauses[cause] ?? 0) + 1;
    }
    if (sum.eventId) {
      if (!d.eventsSeen.includes(sum.eventId)) d.eventsSeen.push(sum.eventId);
      d.recentEvents.push(sum.eventId);
      d.recentEvents = d.recentEvents.slice(-6);
    }
    const ach = (id: string, cond: boolean) => cond && !d.achievements.includes(id) && d.achievements.push(id);
    ach('first_run', true);
    ach('wheels_up', 'wheels up' in sum.splits);
    ach('karman', sum.maxAlt > 100_000);
    ach('escape', sum.escaped);
    ach('coffee', sum.eventId === 'coffee_failure');
    ach('ghost', sum.escaped && sum.alertPeak < 45);
    this.lastRecord = { n: d.runs, seed: sum.seed, time: sum.time, escaped: sum.escaped, cause: sum.failure?.title ?? 'ESCAPED', maxAlt: sum.maxAlt, event: sum.event, credits, date: Date.now() };
    d.history.unshift(this.lastRecord);
    d.history = d.history.slice(0, 40);
    this.save.save();
    if (sum.escaped) this.ui.showResults(sum, d.personalBest, new RNG(run.seed).pick(ESCAPE_LINES));
    else this.ui.showFailure(sum, d.personalBest);
  }

  // ── rendering ─────────────────────────────────────────
  private renderFlightView(dt: number, alpha: number): void {
    const run = this.run;
    const ship = run.ship;
    const settings = this.save.data.settings;
    this.eye.copy(this.prevEye).lerp(this.currEye, alpha);
    this.quat.copy(this.prevQuat).slerp(this.currQuat, alpha);

    // head: look rotation + shake + buffet + structure-borne vibration
    const e = ship.env;
    const vib = settings.reducedMotion ? 0 : (e.buffet * Math.min(1, e.q / 20_000) * 0.6 + ship.weather.turbLevel * Math.min(1, e.q / 8000) * 0.4 + (ship.gear.wow ? Math.min(1, e.groundSpeed / 80) * 0.25 : 0) + Math.max(ship.engines.A.vibration, ship.engines.B.vibration) * 0.5) * settings.shake;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.shakeT += dt;
    const sh = (this.shake * 0.012 + vib * 0.004) * settings.shake;
    const head = this.interaction.headQuat();
    const jitter = new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh * 0.5));
    const camQ = this.quat.clone().multiply(head).multiply(jitter);
    // G pushes the head slightly (body frame)
    const lean = new THREE.Vector3(0, clamp(-(e.nz - 1) * 0.008, -0.04, 0.03), clamp(e.nx * 0.01, -0.04, 0.04));
    const camPosLocal = lean.applyQuaternion(this.quat);
    for (const cam of [this.worldCam, this.cockpitCam]) {
      cam.quaternion.copy(camQ);
      cam.position.copy(camPosLocal);
      const fov = settings.fov / this.interaction.zoom;
      if (Math.abs(cam.fov - fov) > 0.01) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
      cam.updateMatrixWorld();
    }
    // cockpit (and attached exterior) follow the ship's attitude
    this.cockpit.root.quaternion.copy(this.quat);
    this.cockpit.root.updateMatrixWorld();
    setGear(this.exterior, ship.sep.moduleAttached ? ship.gear.pos : 0);
    this.cockpit.sync(run, dt, this.time, this.nightFactor, settings.reducedFlashing);

    this.updateWorld(dt, this.eye, run.time);
    this.objects.update(run, this.eye, this.time, ship.controls.get('routeMkr') === 1 && ship.avionics.hudOn, ship.avionics.hudOn && ship.avionics.escLoaded && ship.controls.get('navSource') === 2);

    // effects
    const u = this.fx.uniforms;
    u.uTime.value = this.time;
    u.uHypoxia.value = clamp01((ship.press.hypoxia - 0.25) / 0.75);
    u.uGrey.value = clamp01((e.nz - 6.5) / 3);
    u.uRed.value = clamp01((-e.nz - 2.5) / 2);
    const js = ship.jump.sequence;
    if (js >= 0) this.jumpVisual = clamp01(js / 1.6);
    if (run.escaped) this.jumpVisual = 1;
    u.uJump.value = settings.reducedMotion ? this.jumpVisual * 0.3 : this.jumpVisual;
    let white = 0;
    if (this.state === 'ending' && run.escaped) white = clamp01(this.endTimer / 0.5) * (this.endTimer < 2.2 ? 1 : 1);
    u.uWhite.value = settings.reducedFlashing ? white * 0.7 : white;
    this.flash = Math.max(0, this.flash - dt * 1.5);
    u.uFlash.value = settings.reducedFlashing ? this.flash * 0.3 : this.flash;
    u.uNoise.value = clamp01(ship.elec.noise + ship.comms.static * 0.3 + (js >= 0 ? js * 0.4 : 0));
    u.uBlack.value = this.state === 'ending' && !run.escaped ? clamp01((this.endTimer - 0.6) / 1.4) : this.state === 'ended' && !run.escaped ? 0.85 : 0;
    this.composer.render(dt);
  }

  private updateWorld(dt: number, eye: THREE.Vector3, time: number): void {
    const run = this.run;
    const r = eye.length();
    const alt = r - PLANET.radius;
    const up = eye.clone().normalize();
    // sun visibility from the eye (planet occlusion) and reddening near the horizon
    const sunEl = Math.asin(clamp(up.dot(this.sunDir), -1, 1));
    const horizonDip = -Math.acos(Math.min(1, PLANET.radius / r));
    const vis = clamp01((sunEl - horizonDip) / 0.02 + 0.5);
    const lowSun = clamp01(1 - (sunEl - horizonDip) / 0.35) * clamp01(1 - alt / 60_000);
    const sunColor = new THREE.Color(1, 1 - lowSun * 0.35, 1 - lowSun * 0.6);
    const dens = Math.exp(-Math.max(0, alt) / 8000);
    this.sunWorld.position.copy(this.sunDir).multiplyScalar(1000);
    this.sunWorld.intensity = 3.2 * vis;
    this.sunWorld.color.copy(sunColor);
    this.sunCockpit.position.copy(this.sunDir).multiplyScalar(4);
    this.sunCockpit.target.position.set(0, 0, 0);
    this.sunCockpit.intensity = 2.8 * vis;
    this.sunCockpit.color.copy(sunColor);
    const sky = new THREE.Color(0x7fa4d8).multiplyScalar(dens * clamp01(sunEl * 3 + 0.4)).add(new THREE.Color(0x101418).multiplyScalar(0.4));
    this.hemiWorld.color.copy(sky);
    this.hemiWorld.intensity = 0.35 + dens * 0.5;
    this.hemiCockpit.color.copy(sky);
    const day = clamp01(sunEl * 3 + 0.3) * vis;
    this.hemiCockpit.intensity = 0.5 + 1.6 * day * (0.35 + 0.65 * dens);
    this.ambCockpit.intensity = 0.18 + 0.75 * day;
    this.nightFactor = clamp01(1 - (vis * (0.3 + dens * 0.7)) * 1.4);
    // fog = aerial perspective for meshes
    this.fog.density = (1 / 26_000) * Math.pow(dens, 0.9) * (1 + run.ship.env.inCloud * 30);
    this.fog.color.setRGB(0.55 * dens + 0.05, 0.66 * dens + 0.06, 0.8 * dens + 0.08).multiplyScalar(clamp01(sunEl * 2 + 0.5));
    // stars fade with sky brightness
    const starVis = clamp01(1 - dens * 6 * clamp01(sunEl * 4 + 0.5));
    (this.stars.material as THREE.ShaderMaterial).uniforms.uBright.value = starVis;
    (this.stars.material as THREE.ShaderMaterial).uniforms.uPx.value = this.renderer.getPixelRatio();
    // planet pass
    const q = this.save.data.settings.quality;
    this.planet.update(this.worldCam, eye, run.ship.env.inCloud * (this.state === 'menu' ? 0 : 1), time, q === 'low' ? 6 : q === 'medium' ? 9 : 12, run.ship.jump.atmosphericPlasmaHeat > 0 ? clamp01(run.ship.jump.atmosphericPlasmaHeat / 8000) : 0);
    // launch facility relative to eye (hidden beyond the horizon)
    this.facility.group.position.copy(LAUNCH_SITE).sub(eye);
    this.facility.group.visible = eye.distanceTo(LAUNCH_SITE) < 600_000;
    this.facility.update(dt, sunEl);
  }

  private updateMenu(dt: number): void {
    this.menuT += dt;
    const ship = this.run.ship;
    // orbit the parked shuttle
    const center = ship.eyePosition(new THREE.Vector3());
    const a = this.menuT * 0.05 + 2.2;
    const local = new THREE.Vector3(Math.cos(a) * 75, 16 + Math.sin(this.menuT * 0.1) * 4, Math.sin(a) * 75);
    const eye = center.clone().add(local);
    this.menuShip.root.position.copy(center).sub(eye);
    this.menuShip.root.quaternion.copy(ship.quat);
    setGear(this.menuShip, 1);
    const look = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), center.clone().sub(eye).add(new THREE.Vector3(0, -3, 0)), new THREE.Vector3(0, 1, 0));
    this.worldCam.quaternion.setFromRotationMatrix(look);
    this.worldCam.position.set(0, 0, 0);
    if (Math.abs(this.worldCam.fov - 55) > 0.01) {
      this.worldCam.fov = 55;
      this.worldCam.updateProjectionMatrix();
    }
    this.worldCam.updateMatrixWorld();
    this.updateWorld(dt, eye, this.menuT);
    this.objects.update(this.run, eye, this.menuT, false, false);
    const u = this.fx.uniforms;
    u.uJump.value = 0;
    u.uWhite.value = 0;
    u.uBlack.value = 0;
    u.uHypoxia.value = 0;
    u.uGrey.value = 0;
    u.uRed.value = 0;
    u.uFlash.value = 0;
    u.uNoise.value = 0;
    this.composer.render(dt);
  }

  /** For automated QA / debug. */
  get debugInfo() {
    const s = this.run.ship;
    return { state: this.state, time: this.run.time, alt: s.env.altitude, fps: this.fps, ended: this.run.ended };
  }
}

export const _l = lerp;
