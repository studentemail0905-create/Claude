# NO CLEARANCE — Project State

Browser-based first-person sci-fi flight simulator (TypeScript + Vite + Three.js r186, WebGL2).
This file exists so another context can continue without rediscovering the project.

## Run / build / test

```
npm install
npm run dev          # http://localhost:5173  (add ?debug=1 for the dev panel, F1 toggles it)
npm run build        # tsc --noEmit && static build in dist/
npm test             # vitest: 27 unit/integration tests incl. a full scripted escape and no-stage-gating checks
npm run sim -- 1 2 3 # headless BotPilot flights for the given hex seeds (balance check)
URL=http://localhost:4173/?debug=1 TS=25 SEED=00000001 node scripts/qa.mjs bot   # Playwright/Chromium (SwiftShader) flight + screenshots → qa-shots/
node scripts/qa-fail.mjs | scripts/qa-ui.mjs                                       # failure/restart flow, menu screens
# Run browser QA against `npx vite preview` (port 4173), not the dev server: HMR reloads kill long runs.
```

`?debug=1&bot=1` starts every run with the scripted BotPilot flying the real cockpit inputs.

## Architecture (src/)

| Area | Files | Notes |
|---|---|---|
| core | `core/Game.ts` (loop, render passes, lifecycle, saves), `Run.ts` (one run: ship+gov+events+objects+failures+scoring), `RNG.ts` (sfc32, named forks), `Input.ts`, `AudioManager.ts` (100% procedural Web Audio), `SaveManager.ts` (versioned v2 + migration + corruption recovery), `EventBus.ts`, `mathutil.ts` | Fixed physics step 1/120 s with render interpolation |
| physics | `PlanetPhysics.ts` (μ/r², Earth radius), `Atmosphere.ts` (USSA-76 layers + tabulated thermosphere), `Aerodynamics.ts` (CL/CD/moments vs α, β, Mach, rates), `Weather.ts` (wind profile, jet stream, Dryden-like turbulence, cloud coverage noise shared bit-exact with the shader) | SI units |
| ship | `Ship.ts` (6DOF rigid body at the COM, gear/belly contact model, structural checks, env), `Controls.ts` (every cockpit input = one ControlState id), `MassModel.ts` (component masses → COM + inertia), `MachineRoll.ts` (layer-1 RNG tolerances + sidegrades), `DamageModel.ts` | Body frame: x right, y up, z aft; origin = pilot eye |
| ship/systems | Electrical, Hydraulic, Fuel, Engine, Thermal (coolant loops + hull skin), Pressurization, FlightControl (DIRECT/NORM, SAS, AP, allocation aero→TVC→RCS), RCS, Avionics (displays, nav computer, escape vector, jump solution), Transponder, Communication, Jammer, Passenger (pods), Separation, JumpDrive | No stage gating anywhere |
| flight | `LegalFlightPlan.ts` (OTL-3 corridor, 85 km ceiling), `FlightDirector.ts` (FD cue + AP rate commands), `EscapeNavigation.ts` | |
| government | `TrackingNetwork.ts` (2 radar sites w/ random sweep intervals, interrogator, datalink, orbital IR, ESM), `FlightCommand.ts` (ATC + alert model + challenges + remote override), `InterceptorDirector.ts` (interceptors, PN missiles, inspection drones, decoys) | Government only knows what its sensors saw |
| events | `EventDefinition.ts`, `EventDirector.ts`, `defs/{hostile,systems,bureaucracy}.ts` | 31 systemic events, weighted, repeat-protected |
| progression | `RewardCalculator.ts` | hidden zones 0–7, sustained-hold rewards, pity 1–2 |
| world | `Planet.ts` + `shaders/planet.glsl.ts` (ray-traced planet, Rayleigh/Mie single scattering, 2 cloud layers, city lights, log-depth write), `LaunchFacility.ts`, `WorldObjects.ts` (objects, route gates, station, moon, sats), `ShipModel.ts` | Floating origin: everything rendered relative to the eye |
| cockpit | `Cockpit.ts` (shell, canopy, 14 panels), `Panel.ts` (canvas-painted worn panels), `controls/Controls3D.ts`, `InteractionManager.ts`, `Displays.ts` (PFD, ND, EICAS, SYS, COMM, JUMP, JAM, annunciators), `HUD.ts` | |
| render | `FxPass.ts` (hypoxia tunnel, G greyout, jump distortion/whiteout), `textures.ts` | Composer: world pass → cockpit pass (clearDepth) → bloom (high) → fx → output |
| ui | `ui/UI.ts`, `style.css` | menu, pause, failure, results, settings, records, black market, flight overlay |
| data | `Balance.ts`, `Snark.ts`, `Sidegrades.ts` | |
| debug | `BotPilot.ts` (scripted expert, uses only ControlState), `DebugPanel.ts` | dev only |

## Physical model (key constants — `data/Balance.ts`)

- Takeoff mass ≈ 98 t (core 27.5 t, module 23 t, pods 4×(1.25 t + 10 pax), fuel 13.6 t core + 24.7 t service, RCS 650 kg). Post-separation ≈ 38–41 t (≈ 58 % reduction).
- 2 × fusion engines: Tvac 680 kN each, exit-area loss 1.6 m² × p_amb (≈ 518 kN SL), Isp 2600 s, spool lag, heat 900 kW/engine at N=1, coolant 1.18 kW/K.
- Aero pre-sep S = 260 m², c = 14, stable (xcp 11.2 vs xcg ≈ 9.9); post-sep S = 58 m², statically unstable (needs FCS NORM/SAS). Mach factors: Prandtl-Glauert / Ackeret lift, transonic wave drag rise, control-effectiveness loss.
- Hull heating: Sutton–Graves flux bounded by recovery temperature, radiative cooling, lumped skin (16 kJ/m²K). Damage >1420 K, destruction 1720 K.
- Structure: nz 4.2 g pre / 7.5 g post, q 48 / 42 kPa, sideslip × q limit; >1.55× instant breakup.
- Electrical: GEN 140 kW each (needs engine N > 0.4, full at 0.75 → use THRUST LIMIT = GEN for power without thrust), EXT 90 kW (cable tears if you roll with it ON), APU 45, battery 35 kW. Overload → sag → feeder trip (heaviest branch first) → fire risk.
- Jammer: ~40 s × machine roll, drains faster hot/WIDE/overdrive, ESM-detectable, thermal runaway ~165 °C × roll.
- Jump: required charge = mass / 46 t (module attached ⇒ impossible); stability = product of atmosphere (logistic in log ρ), rotation, alignment, charge, sync, coil temp, power, coil quality; P(success) = logistic((S − 0.86)·30). Overcharge > 1.15 arcs, > 1.27 explodes.

## Verified behaviour

- Browser (production build, headless Chromium/SwiftShader): menu → FLY → full BotPilot flight → separation → space → jump → ESCAPE CONFIRMED results for seed 00000001 in 5:52.47, bit-identical to the headless sim. Failure screen + instant restart (R) verified. Settings / records / black market screens verified. No page errors.
- `npm test` green (27 tests): RNG determinism, atmosphere anchors, gravity, hydraulics, electrical overload trip, nav-computer power loss, crossfeed, jammer duration window per seed, gear-up-on-runway collapse, jump probability curve, transponder suspicion, ≥30 events + repeat protection, save migration/corruption, reward/pity, deterministic replay, full escape by BotPilot.
- Bot batch (20 seeds): 18 escapes, 2 legitimate systemic deaths (sideslip breakup after early separation, coil failure on roll).

## Controls UX

FLY opens a controls briefing (`UI.showBriefing`, also in the pause menu). Aiming at any control shows its name/state plus key chips (`Control3D.hints`). Keyboard actuation of the hovered control: **G** operate, **H** reverse, **V/C** increase/decrease (hold to repeat) — `InteractionManager` + `Control3D.keyAct`. The brief said "no tutorial"; the user later asked for this screen and these prompts explicitly.

## Cockpit controls (≈90 bound inputs + 12 breakers; ids in `ship/Controls.ts`)

Overhead: BATTERY, EXT PWR, APU (OFF/ON/START), GEN A/B, BUS TIE, AVIONICS, CABIN BUS, JUMP BUS (guard), HYD PUMP A/B, PRESS MODE, PILOT O2, COCKPIT SEAL, CABIN ISOL.
Glareshield: MASTER CAUTION/WARNING, FLT DIR, NAV SOURCE (LEGAL/INS/ESCAPE), ROUTE MKR, AUTOPILOT, FCS MODE, STAB AUG, THRUST VEC, HUD BRT.
Left wing: LANDING GEAR (+3 lamps, WOW), PARK BRK, COOL A/B, COOL PRIO, FIRE A/B pull handles.
Left console: THROTTLE A/B, SPD BRK, THRUST LIMIT (GEN/60/85/100/110), ENG MASTER, START A/B; FUEL: PUMP A/B, XFEED, ISOL A/B, XFER, SVC LINE (guard).
Right wing (evac): RESTRAINT CMD, POD PWR, POD GUID, RETURN PROG, EVAC ARM (guard), POD RELEASE (guard), capsule/CLEAR lamps.
Right console: COMMS, TX, FREQ, RX VOL, ACK/PTT, IDENT, XPDR (OFF/STBY/ON/ALT/SECURE), AUTH DLINK (guard), AUTH digit, AUTH TX; NAV COMP, ESC LOAD, JUMP SOLVE, RCS, RCS MODE, PITCH TRIM wheel, YAW TRIM.
Lower centre: SEPARATION (UMBILICAL, MECH LOCKS guard, SEP CHARGES guard, EMERGENCY SEPARATION guarded pull) and JUMP DRIVE box (CAP CHG, COILS guard, SYNC, CAP DUMP, SAFETY pull pin, JUMP guard).
Right wall: SIGNAL MASKING UNIT (BUS, COOL, CHG, FIELD PROFILE, DECOY, ARM guard, ENGAGE, OVERDRIVE guard) and 12 circuit breakers. Left wall: kneeboard (callsign, squawk, authentication table — regenerated per run).

## Events (31)

Interceptor, Missile Lock, Inspection Drone, Unknown Contact, Debris Field, Jammer Overheat, Engine Flameout, Coolant Leak, Capacitor Arc, Micrometeor, Solar Flare, Transponder Reboot, Reactor Surge, Throttle Jam, Control Calibration, Avionics Bus Failure, Radar Ghosts, Engine Oscillation, Fuel Imbalance, Jump Coil Quench, Jump Clock Desync, Hydraulic Leak, Navigation Spoof, False Clearance, Government Challenge, Forced Software Update, Autopilot Intervention, Passenger PA Broadcast, Mechanical Obstruction, Coffee Failure, Orbital Toll Authority.

## Known issues / next priorities

1. Headless SwiftShader runs at ~2–10 fps; real GPU performance not yet profiled (canvas display uploads are throttled 6–20 Hz).
2. Pointer lock + mouse deltas only verified via Playwright; gamepad untested on hardware.
3. Possible balance work: human-paced climb takes ~4 min to 30 km; expert divert routes untested beyond the bot.
4. Polish ideas: cockpit glass reflections at night, engine plume lighting on the canopy frame, more radio lines, more snark.
