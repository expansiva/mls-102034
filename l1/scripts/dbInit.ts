/// <mls fileReference="_102034_/l1/scripts/dbInit.ts" enhancement="_blank" />
import { setupServer } from '/_102034_/l1/scripts/setupServer.js';
import { setCliAppEnv } from '/_102034_/l1/scripts/envCli.js';

export async function dbInit(inputEnv?: string): Promise<void> {
  const appEnv = setCliAppEnv(inputEnv);
  await setupServer();
  console.info(`Database initialized for ${appEnv}`);
}

const isMainModule = process.argv[1]?.endsWith('/dbInit.js');

if (isMainModule) {
  dbInit(process.argv[2])
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
