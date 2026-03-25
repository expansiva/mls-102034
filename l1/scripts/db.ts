/// <mls fileReference="_102034_/l1/scripts/db.ts" enhancement="_blank" />
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProjectsConfig, resolveProjectsPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getSharedPgPool } from '/_102034_/l1/mdm/layer_1_external/data/postgres/pg.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function getSqlDirPaths(): Promise<string[]> {
  const config = readProjectsConfig();
  const orderedProjectIds = ['102034', ...Object.keys(config.projects).filter((projectId) => projectId !== '102034')];
  const candidates = orderedProjectIds.map((projectId) => resolveProjectsPath(`./_${projectId}_/l1/sql`));
  const paths: string[] = [];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      paths.push(candidate);
    }
  }

  const distSqlPath = path.resolve(currentDir, '../sql');
  if (await pathExists(distSqlPath) && !paths.includes(distSqlPath)) {
    paths.unshift(distSqlPath);
  }

  return paths;
}

export async function listSqlFiles(): Promise<string[]> {
  const sqlDirs = await getSqlDirPaths();
  const files = await Promise.all(sqlDirs.map(async (sqlDir) => readdir(sqlDir)));
  return [...new Set(files.flat().filter((file) => file.endsWith('.sql')))].sort();
}

export async function readSqlFile(fileName: string): Promise<string> {
  const sqlDirs = await getSqlDirPaths();
  for (const sqlDir of sqlDirs) {
    const candidate = path.join(sqlDir, fileName);
    if (await pathExists(candidate)) {
      return readFile(candidate, 'utf8');
    }
  }

  throw new Error(`SQL file not found: ${fileName}`);
}

export async function getPgPool() {
  return getSharedPgPool(readAppEnv());
}
