import { promises as fs } from 'node:fs';
import path from 'node:path';

const distRoot = process.env.DIST_ROOT
  ? path.resolve(process.env.DIST_ROOT)
  : path.resolve('dist', 'local');
const projectAbsoluteImportPattern = /^\/_\d+_\/(?:core|l1|l2)\/.+$/u;

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(fullPath);
    }
    return [fullPath];
  }));
  return files.flat();
}

function rewriteSpecifier(filePath, specifier) {
  if (!projectAbsoluteImportPattern.test(specifier)) {
    return specifier;
  }

  const relativeTarget = specifier.slice(1);
  const targetPath = path.join(distRoot, relativeTarget);
  let nextSpecifier = path.relative(path.dirname(filePath), targetPath).replaceAll(path.sep, '/');
  if (!nextSpecifier.startsWith('.')) {
    nextSpecifier = `./${nextSpecifier}`;
  }
  return nextSpecifier;
}

function rewriteContent(filePath, content) {
  return content
    .replace(
      /(\bfrom\s+['"])(\/_\d+_\/(?:core|l1|l2)\/[^'"]+)(['"])/g,
      (_match, prefix, specifier, suffix) => `${prefix}${rewriteSpecifier(filePath, specifier)}${suffix}`,
    )
    .replace(
      /(\bimport\s*\(\s*['"])(\/_\d+_\/(?:core|l1|l2)\/[^'"]+)(['"]\s*\))/g,
      (_match, prefix, specifier, suffix) => `${prefix}${rewriteSpecifier(filePath, specifier)}${suffix}`,
    );
}

async function main() {
  const files = (await listFiles(distRoot))
    .filter((filePath) => filePath.endsWith('.js'))
    .filter((filePath) => filePath.includes('/l1/'));
  await Promise.all(files.map(async (filePath) => {
    const current = await fs.readFile(filePath, 'utf8');
    const next = rewriteContent(filePath, current);
    if (next !== current) {
      await fs.writeFile(filePath, next, 'utf8');
    }
  }));
}

await main();
