# _102034_ l1 backend

## Files to use

- base env template: `.env.example`

## Install

Inside `l1`:

```bash
npm install
```

## Install PostgreSQL on macOS

Using Homebrew:

```bash
brew install postgresql@17
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zprofile
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
brew services start postgresql@17
```

Check installation:

```bash
psql --version
pg_isready -h 127.0.0.1 -p 5432
```

If needed, create or update the local PostgreSQL login:

```bash
psql postgres
```

Inside `psql`:

```sql
CREATE ROLE postgres WITH LOGIN SUPERUSER PASSWORD 'collablocal';
ALTER USER postgres WITH PASSWORD 'collablocal';
```

## Customize environment

Create the runtime env file:

```bash
cp .env.example .env
```

Edit `.env` and set:

- `APP_ENV`
- `PORT_DEVELOPMENT`, `PORT_STAGING`, `PORT_PRODUCTION`
- `RUNTIME_MODE_DEVELOPMENT`, `RUNTIME_MODE_STAGING`, `RUNTIME_MODE_PRODUCTION`
- `PGHOST_DEVELOPMENT`, `PGHOST_STAGING`, `PGHOST_PRODUCTION`
- `PGPORT_DEVELOPMENT`, `PGPORT_STAGING`, `PGPORT_PRODUCTION`
- `PGDATABASE_DEVELOPMENT`, `PGDATABASE_STAGING`, `PGDATABASE_PRODUCTION`
- `PGUSER_DEVELOPMENT`, `PGUSER_STAGING`, `PGUSER_PRODUCTION`
- `PGPASSWORD_DEVELOPMENT`, `PGPASSWORD_STAGING`, `PGPASSWORD_PRODUCTION`
- `AWS_REGION_DEVELOPMENT`, `AWS_REGION_STAGING`, `AWS_REGION_PRODUCTION`
- `AWS_ACCESS_KEY_ID_*`, `AWS_SECRET_ACCESS_KEY_*`, `AWS_SESSION_TOKEN_*` when needed
- `WRITE_BEHIND_ENABLED_DEVELOPMENT`, `WRITE_BEHIND_ENABLED_STAGING`, `WRITE_BEHIND_ENABLED_PRODUCTION`
- `LOG_LEVEL_DEVELOPMENT`, `LOG_LEVEL_STAGING`, `LOG_LEVEL_PRODUCTION`

The package reads a single `l1/.env` automatically for server startup, scripts, and tests.
Values are resolved by `APP_ENV`, using the matching `*_DEVELOPMENT`, `*_STAGING`, or `*_PRODUCTION` variable.
Storage table names are no longer configured in `.env`; they are versioned in code by environment.

## Build

```bash
npm run build
```

Source imports follow the project-absolute convention:

```ts
import { execBff } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
```

The Node.js runtime uses the compiled `dist/` output. During build, `tsc-alias`
rewrites these imports to relative paths valid for Node.js execution.

## Run by environment

Development:

```bash
npm run start:dev
```

Staging:

```bash
npm run start:staging
```

Production:

```bash
npm run start:prod
```

## Monitor BFF routines

Snapshot:

```bash
curl -sS http://localhost:3000/execBff \
  -H 'content-type: application/json' \
  -d '{
    "routine": "monitor.monitorGetStatistics.getSnapshot",
    "params": {}
  }'
```

Series:

```bash
curl -sS http://localhost:3000/execBff \
  -H 'content-type: application/json' \
  -d '{
    "routine": "monitor.monitorGetStatistics.getSeries",
    "params": {
      "windowSeconds": 100
    }
  }'
```

## Prepare PostgreSQL and server

First-time setup:

```bash
npm run setup:server
```

This command:

- creates the PostgreSQL database when it does not exist
- applies SQL migrations
- keeps existing tables and data
- creates the DynamoDB tables defined by the environment storage config when they do not exist
- creates monitor tables used for BFF execution statistics
- creates data-core tables for audit log, write monitoring, error log, and status history

Apply migrations only:

```bash
npm run db:migrate
```

Initialize the selected environment without deleting anything:

```bash
npm run db:init -- dev
npm run db:init -- staging
npm run db:init -- prod
```

Delete the selected environment database and DynamoDB tables:

```bash
npm run db:delete -- dev deletebd
npm run db:delete -- staging deletebd
npm run db:delete -- prod deletebd
```

Notes:

- `db:init` creates the PostgreSQL database when needed, applies migrations, and ensures DynamoDB tables exist.
- `db:delete` is destructive: it drops the PostgreSQL database for the selected environment and deletes the DynamoDB tables configured for that environment.
- The confirmation token is hardcoded as `deletebd`.

Ensure DynamoDB table only:

```bash
npm run dynamo:ensure-table
```

Reset local database only for development:

```bash
npm run db:reset-local
```

## Run tests

Unit and package tests:

```bash
npm test
```

Expected behavior:

- unit and package tests run normally
- the real PostgreSQL + DynamoDB integration test stays skipped
- this is not a failure
- the skip message appears until you explicitly request the real integration suite

Real integration tests with PostgreSQL and DynamoDB:

```bash
npm run test:integration
```

Before running integration tests:

1. configure `.env` with the `*_STAGING` PostgreSQL and AWS test values
2. ensure PostgreSQL is running
3. run `npm run setup:server`
4. run `npm run test:integration`

## Write-behind worker

Run the worker once:

```bash
npm run worker:write-behind
```

## Restore from DynamoDB

```bash
npm run restore:from-dynamo -- <mdmId>
```

Restore all relationship rows:

```bash
npm run restore:from-dynamo -- --relationships
```

## EC2 server procedure

1. copy the `l1` folder to the server
2. create `.env`
3. install Node.js
4. install PostgreSQL
5. create the PostgreSQL login and password used by `.env`
6. run `npm install`
7. run `npm run build`
8. run `npm run setup:server`
9. start the server with `npm run start:prod`
10. run `npm run worker:write-behind` in a separate process if write-behind is enabled

## AWS credentials on EC2

Preferred procedure:

1. attach an IAM Role to the EC2 instance
2. do not set `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` in `.env`

Fallback procedure for local or temporary tests:

1. set `AWS_ACCESS_KEY_ID`
2. set `AWS_SECRET_ACCESS_KEY`
3. set `AWS_SESSION_TOKEN` if required
