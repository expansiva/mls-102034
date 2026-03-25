/// <mls fileReference="_102034_/l1/scripts/runWriteBehindWorker.ts" enhancement="_blank" />
import { WriteBehindWorker } from '/_102034_/l1/mdm/layer_1_external/queue/WriteBehindWorker.js';

async function runWorker(): Promise<void> {
  const worker = new WriteBehindWorker();
  const result = await worker.runOnce();
  console.info(`Write-behind processed=${result.processed} failed=${result.failed}`);
}

const isMainModule = process.argv[1]?.endsWith('/runWriteBehindWorker.js');

if (isMainModule) {
  runWorker()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
