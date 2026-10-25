/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDevProcessTwoWorkers.ts" enhancement="_blank" />
// One-shot child for the two-process draft secret proof. Not a test file.
import { ensureDevProcess } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';

const [base, slug, pidText] = process.argv.slice(2);
const pid = Number(pidText);
const info = ensureDevProcess({
  base,
  slug,
  clientProjectId: 102047,
  now: () => 1,
  writeConfig: () => {},
  spawn: () => ({ pid }),
});
process.stdout.write(JSON.stringify({ pid: info.pid, identitySecret: info.identitySecret }));
