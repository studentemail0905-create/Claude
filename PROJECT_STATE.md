# NO CLEARANCE — Project State

Browser-based first-person sci-fi flight simulator (TypeScript + Vite + Three.js r186, WebGL2).
This file exists so another context can continue without rediscovering the project.

## Run / build / test

```
npm install
npm run dev          # http://localhost:5173  (add ?debug=1 for the dev panel, F1 toggles it)
npm run build        # tsc --noEmit && static build in dist/
npm test             # vitest: 21 unit/integration tests incl. a full scripted escape
npm run sim -- 1 2 3 # headless BotPilot flights for the given hex seeds (balance check)
node scripts/qa.mjs menu|fly|bot   # Playwright/Chromium (SwiftShader) screenshots → qa-shots/
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

- `npm test` green (21 tests): RNG determinism, atmosphere anchors, gravity, hydraulics, electrical overload trip, nav-computer power loss, crossfeed, jammer duration window per seed, gear-up-on-runway collapse, jump probability curve, transponder suspicion, ≥30 events + repeat protection, save migration/corruption, reward/pity, deterministic replay, full escape by BotPilot.
- Bot batch (20 seeds): 18 escapes, 2 legitimate systemic deaths (sideslip breakup after early separation, coil failure on roll).

## Known issues / next priorities

1. Headless SwiftShader runs at ~2–10 fps; real GPU performance not yet profiled (canvas display uploads are throttled 6–20 Hz).
2. Pointer lock + mouse deltas only verified via Playwright; gamepad untested on hardware.
3. Possible balance work: human-paced climb takes ~4 min to 30 km; expert divert routes untested beyond the bot.
4. Polish ideas: cockpit glass reflections at night, engine plume lighting on the canopy frame, more radio lines, more snark.
