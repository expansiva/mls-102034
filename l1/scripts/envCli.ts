/// <mls fileReference="_102034_/l1/scripts/envCli.ts" enhancement="_blank" />
export type CliAppEnv = 'development' | 'staging' | 'production';

export function parseCliAppEnv(value: string | undefined): CliAppEnv {
  switch ((value ?? '').toLowerCase()) {
    case 'dev':
    case 'development':
      return 'development';
    case 'staging':
    case 'stage':
      return 'staging';
    case 'prod':
    case 'production':
      return 'production';
    default:
      throw new Error('Environment argument must be one of: dev, staging, prod');
  }
}

export function setCliAppEnv(value: string | undefined): CliAppEnv {
  const appEnv = parseCliAppEnv(value);
  process.env.APP_ENV = appEnv;
  return appEnv;
}
