/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDraftPortsWorker.ts" enhancement="_blank" />
// Test helper (run by cbeDraftPorts.test.ts in separate processes): allocates the fixed port of one draft and prints it.
import { allocateDraftPort } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraftPorts.js';

const [file, projectId, slug] = process.argv.slice(2);
const result = allocateDraftPort({
  file,
  projectId: Number(projectId),
  slug,
  range: { start: 4000, end: 4099 },
  portFree: () => true,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
