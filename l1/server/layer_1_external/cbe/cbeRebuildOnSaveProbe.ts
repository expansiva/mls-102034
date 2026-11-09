/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeRebuildOnSaveProbe.ts" enhancement="_blank" />
// One-shot child for cbeRebuildOnSave.test.ts (needs its own env and root, fixed at import). Not a test file.
import { scheduleRebuildOnSave } from '/_102034_/l1/server/layer_1_external/cbe/cbeRebuildOnSave.js';

scheduleRebuildOnSave(102047);
setTimeout(() => process.exit(0), Number(process.argv[2] ?? '6000'));
