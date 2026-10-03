import { simulateRun } from '../src/debug/BotPilot';

const seeds = process.argv.slice(2).map((s: string) => parseInt(s, 16));
const list = seeds.length ? seeds : [0x1234abcd];
for (const seed of list) {
  const t0 = Date.now();
  const { run, bot } = simulateRun(seed, 900, list.length === 1, 10);
  const sum = run.summary();
  console.log(`seed ${sum.seed}: ${sum.escaped ? 'ESCAPED' : 'FAILED ' + sum.failure?.title + ' (' + sum.failure?.detail + ')'} t=${sum.time.toFixed(1)} maxAlt=${(sum.maxAlt / 1000).toFixed(1)}km event=${sum.event}/${sum.eventOutcome} credits=${sum.reward?.total} phase=${bot.phase} wall=${Date.now() - t0}ms`);
  if (list.length === 1) {
    console.log(run.ship.messages.map((m) => `${m.t.toFixed(1)} ${m.text}`).join('\n'));
    console.log('splits', sum.splits);
    console.log('stability', run.ship.jump.stability, 'result', run.jumpResult);
  }
}
