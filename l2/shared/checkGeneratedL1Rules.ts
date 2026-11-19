/// <mls fileReference="_102034_/l2/shared/checkGeneratedL1Rules.ts" enhancement="_blank" />
/**
 * The rules that keep generated L1 from reaching the network, a child process or dynamic code.
 * Pure: no `node:*`, no import. The caller passes the TypeScript API (`ts`): the Studio passes the TypeScript 5.0.2
 * it already loads, the release passes the `typescript` of Node. Only calls that exist in 5.0.2 and in 5.9 are used.
 * The release reads this file as it is (Node strips the types), so keep the syntax erasable: no enum, no namespace,
 * no parameter property.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TsApi = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TsNode = any;

export interface CheckedL1File {
  file: string;
  text: string;
}

export interface L1Finding {
  file: string;
  line: number;
  rule: string;
}

/** The one list of rules, with the names that appear in a finding. */
export const CHECK_GENERATED_L1_RULES = [
  'network-global',
  'node-module',
  'dynamic-code',
  'deno-api',
  'process-internal',
  'dynamic-import',
] as const;

const NODE_MODULES = new Set([
  'module', // createRequire(...)('child_process') reaches every module the list above forbids
  'child_process',
  'net',
  'tls',
  'http',
  'https',
  'http2',
  'dgram',
  'dns',
  'vm',
  'worker_threads',
  'cluster',
]);

const NETWORK_NAMES = new Set(['XMLHttpRequest', 'WebSocket', 'EventSource']);
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'global']);

const REFERENCE_RULES = new Map<string, string>([
  ['fetch', 'network-global'],
  ['XMLHttpRequest', 'network-global'],
  ['WebSocket', 'network-global'],
  ['EventSource', 'network-global'],
  ['Deno', 'deno-api'],
]);

function isForbiddenModule(name: string | null): boolean {
  if (!name) return false;
  const bare = name.startsWith('node:') ? name.slice(5) : name;
  return NODE_MODULES.has(bare);
}

/** The scan of one file. `ts` is the TypeScript API of the caller. */
function checkOne(ts: TsApi, file: string, text: string, findings: L1Finding[], seen: Set<string>): void {
  const literalText = (node: TsNode): string | null => {
    if (!node) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    return null;
  };

  const calleeName = (expr: TsNode): string | null => {
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && GLOBAL_OBJECTS.has(expr.expression.text)) {
      return expr.name.text;
    }
    return null;
  };

  const isDenoAccess = (node: TsNode): boolean => ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'Deno';

  const isProcessInternal = (node: TsNode): boolean => {
    if (!ts.isPropertyAccessExpression(node)) return false;
    if (!ts.isIdentifier(node.expression) || node.expression.text !== 'process') return false;
    return node.name.text === 'binding' || node.name.text === 'dlopen' || node.name.text === 'mainModule';
  };

  const nameHolders: Array<(node: TsNode) => boolean> = [
    ts.isPropertyAssignment, ts.isPropertyDeclaration, ts.isPropertySignature, ts.isMethodDeclaration,
    ts.isMethodSignature, ts.isVariableDeclaration, ts.isParameter, ts.isFunctionDeclaration,
    ts.isClassDeclaration, ts.isGetAccessorDeclaration, ts.isSetAccessorDeclaration, ts.isEnumMember,
    ts.isInterfaceDeclaration, ts.isTypeAliasDeclaration, ts.isLabeledStatement, ts.isImportSpecifier,
    ts.isExportSpecifier, ts.isImportClause, ts.isNamespaceImport,
  ];

  /** An identifier used as a value: not the name of something, not a member after a dot, not a type. */
  const isValueReference = (node: TsNode): boolean => {
    const parent = node.parent;
    if (!parent) return false;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
    if (nameHolders.some((test) => test(parent) && parent.name === node)) return false;
    if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) return false;
    if (ts.isTypeReferenceNode(parent) || ts.isQualifiedName(parent) || ts.isTypeQueryNode(parent)) return false;
    return true;
  };

  /** `globalThis['fetch']`, `window["eval"]`: a global read by a literal key. */
  const globalElementRule = (node: TsNode): string | null => {
    if (!ts.isElementAccessExpression(node)) return null;
    if (!ts.isIdentifier(node.expression) || !GLOBAL_OBJECTS.has(node.expression.text)) return null;
    const key = literalText(node.argumentExpression);
    if (key == null) return null;
    const known = REFERENCE_RULES.get(key);
    if (known) return known;
    return key === 'eval' || key === 'Function' ? 'dynamic-code' : null;
  };

  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const add = (node: TsNode, rule: string): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const key = `${file}\0${line}\0${rule}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file, line, rule });
  };

  const visit = (node: TsNode): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (isForbiddenModule(literalText(node.moduleSpecifier))) add(node, 'node-module');
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (isForbiddenModule(literalText(node.moduleReference.expression))) add(node, 'node-module');
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      const name = literalText(arg);
      if (name == null) add(node, 'dynamic-import');
      else if (isForbiddenModule(name)) add(node, 'node-module');
    } else if (ts.isCallExpression(node)) {
      const called = calleeName(node.expression);
      if (called === 'fetch') add(node, 'network-global');
      else if (called === 'eval' || called === 'Function') add(node, 'dynamic-code');
      else if (called && NETWORK_NAMES.has(called)) add(node, 'network-global');
      if (isProcessInternal(node.expression)) add(node, 'process-internal');
      if (
        ts.isIdentifier(node.expression)
        && node.expression.text === 'require'
        && isForbiddenModule(literalText(node.arguments[0]))
      ) {
        add(node, 'node-module');
      }
    } else if (ts.isNewExpression(node)) {
      const called = calleeName(node.expression);
      if (called === 'Function') add(node, 'dynamic-code');
      else if (called && NETWORK_NAMES.has(called)) add(node, 'network-global');
    }

    if (isDenoAccess(node)) add(node, 'deno-api');
    if (isProcessInternal(node)) add(node, 'process-internal');
    // A global reached by reference, not only by call: `const f = fetch`, `run(fetch)`, `{ fetch }`, `globalThis['fetch']`.
    if (ts.isIdentifier(node)) {
      const rule = REFERENCE_RULES.get(node.text);
      if (rule && isValueReference(node)) add(node, rule);
    }
    const viaKey = globalElementRule(node);
    if (viaKey) add(node, viaKey);

    ts.forEachChild(node, visit);
  };

  visit(source);
}

/** Every finding of the given files, in order. Scope (which files) is the caller's job. */
export function checkGeneratedL1Files(ts: TsApi, files: CheckedL1File[]): L1Finding[] {
  const findings: L1Finding[] = [];
  const seen = new Set<string>();
  for (const item of files) checkOne(ts, item.file, item.text, findings, seen);
  return findings;
}
