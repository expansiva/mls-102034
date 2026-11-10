/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/noEnvAtImport.test.ts" enhancement="_blank" />
// rt202 guard: no server module may read process.env / getProjectsBaseDir() in a top-level const. The app's `.env`
// enters the process AFTER the modules are imported (config/env.ts loadEnvFile), so such a const freezes the default.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTs(full));
    else if (name.endsWith('.ts') && !/\.test\.ts$|\.d\.ts$/u.test(name)) out.push(full);
  }
  return out;
}

/** Top-level `const|let|var` statements (column 0) whose initializer reads the environment. */
function offenders(source: string): string[] {
  const lines = source.split('\n');
  const found: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^(export )?(const|let|var) /u.test(lines[i])) continue;
    let stmt = lines[i];
    for (let k = i + 1; k < Math.min(i + 5, lines.length) && !/[;{]\s*$/u.test(stmt); k += 1) stmt += `\n${lines[k]}`;
    if (/=>|function\b/u.test(stmt)) continue;
    if (/process\.env|getProjectsBaseDir\(/u.test(stmt)) found.push(lines[i].trim());
  }
  return found;
}

test('nenhum módulo do servidor lê process.env nem getProjectsBaseDir() num const de topo', () => {
  const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const bad: string[] = [];
  for (const file of listTs(serverDir)) {
    for (const line of offenders(readFileSync(file, 'utf8'))) bad.push(`${file.slice(serverDir.length)}: ${line}`);
  }
  assert.deepEqual(bad, [], 'leia a variável dentro da função que a usa (rt202)');
});
