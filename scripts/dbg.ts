import { Run } from '../src/core/Run';
import { BotPilot } from '../src/debug/BotPilot';
import { RAD } from '../src/core/mathutil';
const run = new Run(0x1234abcd);
const bot = new BotPilot(run);
const s = run.ship;
let next = 15;
while (!run.ended && run.time < 32) {
  bot.tick();
  run.step(1 / 120);
  if (run.time >= next) {
    next += 0.5;
    const e = s.env;
    console.log(`t=${run.time.toFixed(1)} ph=${bot.phase} eas=${e.eas.toFixed(0)} pit=${(e.attitude.pitch*RAD).toFixed(1)} roll=${(e.attitude.roll*RAD).toFixed(1)} hdg=${(e.attitude.heading*RAD).toFixed(1)} sp=${s.controls.stickPitch.toFixed(2)} de=${s.fcs.de.toFixed(2)} auth=${s.fcs.surfaceAuth.toFixed(2)} aeroT=${s.aero.torque.x.toExponential(2)} cmd=${s.fcs.lastCmd.x.toExponential(2)} thrM=${s.thrustMoment.x.toExponential(2)} w=${(s.omega.x*RAD).toFixed(2)},${(s.omega.y*RAD).toFixed(2)},${(s.omega.z*RAD).toFixed(2)} alpha=${(e.alpha*RAD).toFixed(1)} beta=${(e.beta*RAD).toFixed(1)} comz=${s.massModel.com.z.toFixed(2)} I=${s.massModel.inertia.x.toExponential(2)} wow=${s.gear.wow}`);
  }
}
console.log(run.failed);
