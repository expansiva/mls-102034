/// <mls fileReference="_102034_/l1/workflow/assistantContractSource.ts" enhancement="_blank"/>

/**
 * Reader of the L2 contract sources the release carries (`l2/<module>/web/contracts/<page>.defs.ts`): TypeScript types
 * only. A small tokenizer and a recursive-descent parser read the subset the contract generator emits (object literals,
 * unions of string literals, arrays, tuples, named interfaces and types). Pure: no `mls`, no files, nothing evaluated.
 */

export type AsTypeNode =
  | { kind: 'primitive'; name: 'string' | 'number' | 'boolean' | 'unknown' }
  | { kind: 'literal'; values: string[] }
  | { kind: 'object'; fields: AsTypeField[] }
  | { kind: 'array'; of: AsTypeNode }
  | { kind: 'tuple'; items: AsTypeNode[] }
  | { kind: 'ref'; name: string };

export interface AsTypeField {
  name: string;
  optional: boolean;
  type: AsTypeNode;
}

export interface AsContractRoute {
  route: string;
  kind: string;
  writes: string;
  input: AsTypeNode;
  output: AsTypeNode | undefined;
}

// ---- TypeScript type parser ----

type Token = { kind: 'punct' | 'string' | 'ident' | 'number'; value: string };

const PUNCT = new Set(['{', '}', '[', ']', '(', ')', '<', '>', ';', ',', ':', '?', '|', '&', '=']);

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (/\s/.test(char)) { i += 1; continue; }
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close < 0 ? text.length : close + 2;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      let j = i + 1;
      let value = '';
      while (j < text.length && text[j] !== char) {
        if (text[j] === '\\') { value += text[j + 1] ?? ''; j += 2; continue; }
        value += text[j];
        j += 1;
      }
      tokens.push({ kind: 'string', value });
      i = j + 1;
      continue;
    }
    if (PUNCT.has(char)) {
      tokens.push({ kind: 'punct', value: char });
      i += 1;
      continue;
    }
    if (/[0-9-]/.test(char)) {
      let j = i + 1;
      while (j < text.length && /[0-9.]/.test(text[j])) j += 1;
      tokens.push({ kind: 'number', value: text.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      let j = i + 1;
      while (j < text.length && /[\w$.]/.test(text[j])) j += 1;
      tokens.push({ kind: 'ident', value: text.slice(i, j) });
      i = j;
      continue;
    }
    i += 1; // anything else (e.g. stray symbols) is skipped
  }
  return tokens;
}

class TypeParser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  get done(): boolean { return this.index >= this.tokens.length; }
  peek(offset = 0): Token | undefined { return this.tokens[this.index + offset]; }
  next(): Token | undefined { return this.tokens[this.index++]; }
  isPunct(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token?.kind === 'punct' && token.value === value;
  }
  expectPunct(value: string): void {
    const token = this.next();
    if (token?.kind !== 'punct' || token.value !== value) throw new Error(`expected '${value}' but found '${token?.value ?? 'end'}'`);
  }

  parseType(): AsTypeNode {
    if (this.isPunct('|')) this.next(); // leading pipe of a multi-line union
    const members: AsTypeNode[] = [this.parsePostfix()];
    while (this.isPunct('|') || this.isPunct('&')) {
      this.next();
      members.push(this.parsePostfix());
    }
    if (members.length === 1) return members[0];
    const literals = members.filter((member): member is { kind: 'literal'; values: string[] } => member.kind === 'literal');
    if (literals.length === members.length) return { kind: 'literal', values: literals.flatMap(member => member.values) };
    const meaningful = members.filter(member => !(member.kind === 'ref' && (member.name === 'null' || member.name === 'undefined')));
    return meaningful.length === 1 ? meaningful[0] : { kind: 'primitive', name: 'unknown' };
  }

  private parsePostfix(): AsTypeNode {
    let node = this.parsePrimary();
    while (this.isPunct('[') && this.isPunct(']', 1)) {
      this.next();
      this.next();
      node = { kind: 'array', of: node };
    }
    return node;
  }

  private parsePrimary(): AsTypeNode {
    const token = this.next();
    if (!token) throw new Error('unexpected end of type');
    if (token.kind === 'string' || token.kind === 'number') return { kind: 'literal', values: [token.value] };
    if (token.kind === 'punct') {
      if (token.value === '{') return this.parseObjectBody();
      if (token.value === '[') return this.parseTupleBody();
      if (token.value === '(') {
        const inner = this.parseType();
        this.expectPunct(')');
        return inner;
      }
      throw new Error(`unexpected '${token.value}' in type`);
    }
    const name = token.value;
    if (this.isPunct('<')) {
      this.skipGeneric();
      if (name === 'Array' || name === 'ReadonlyArray') return { kind: 'array', of: { kind: 'primitive', name: 'unknown' } };
      return { kind: 'primitive', name: 'unknown' };
    }
    if (name === 'string' || name === 'number' || name === 'boolean') return { kind: 'primitive', name };
    if (name === 'true' || name === 'false') return { kind: 'literal', values: [name] };
    if (name === 'unknown' || name === 'any' || name === 'object' || name === 'never') return { kind: 'primitive', name: 'unknown' };
    return { kind: 'ref', name };
  }

  private skipGeneric(): void {
    let depth = 0;
    do {
      const token = this.next();
      if (!token) return;
      if (token.kind === 'punct' && token.value === '<') depth += 1;
      if (token.kind === 'punct' && token.value === '>') depth -= 1;
    } while (depth > 0);
  }

  // Called right after '{'.
  parseObjectBody(): AsTypeNode {
    const fields: AsTypeField[] = [];
    while (!this.done && !this.isPunct('}')) {
      if (this.isPunct(';') || this.isPunct(',')) { this.next(); continue; }
      if (this.isPunct('[')) { this.skipIndexSignature(); continue; }
      const modifier = this.peek();
      const afterModifier = this.peek(1);
      if (modifier?.kind === 'ident' && modifier.value === 'readonly' && afterModifier && afterModifier.kind !== 'punct') this.next();
      const key = this.next();
      if (!key || key.kind === 'punct') throw new Error(`invalid property key '${key?.value ?? 'end'}'`);
      let optional = false;
      if (this.isPunct('?')) { this.next(); optional = true; }
      this.expectPunct(':');
      fields.push({ name: key.value, optional, type: this.parseType() });
    }
    this.expectPunct('}');
    return { kind: 'object', fields };
  }

  private skipIndexSignature(): void {
    // [key: string]: T
    this.next();
    while (!this.done && !this.isPunct(']')) this.next();
    this.next();
    if (this.isPunct(':')) { this.next(); this.parseType(); }
  }

  // Called right after '['.
  private parseTupleBody(): AsTypeNode {
    const items: AsTypeNode[] = [];
    while (!this.done && !this.isPunct(']')) {
      if (this.isPunct(',')) { this.next(); continue; }
      items.push(this.parseType());
    }
    this.expectPunct(']');
    return { kind: 'tuple', items };
  }
}

export function parseTypeText(text: string): AsTypeNode {
  const parser = new TypeParser(tokenize(text));
  const node = parser.parseType();
  if (!parser.done) throw new Error('trailing tokens after type');
  return node;
}

export interface AsParsedContract {
  types: Record<string, AsTypeNode>;
  routes: AsContractRoute[];
}

// Reads every `export interface X { }` / `export type X = ...;` and collects the routes:
// properties whose key is a dotted route name and whose value is an object with a `kind`.
export function parseContractSource(source: string): AsParsedContract {
  const tokens = tokenize(source);
  const types: Record<string, AsTypeNode> = {};
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.kind === 'ident' && token.value === 'export' && tokens[i + 1]?.kind === 'ident') {
      const keyword = tokens[i + 1].value;
      const name = tokens[i + 2]?.value;
      if (keyword === 'interface' && name) {
        let j = i + 3;
        while (j < tokens.length && !(tokens[j].kind === 'punct' && tokens[j].value === '{')) j += 1;
        const parser = new TypeParser(tokens.slice(j + 1));
        try {
          types[name] = parser.parseObjectBody();
        } catch {
          // an interface the parser cannot read is simply not available
        }
        i = j + 1;
        continue;
      }
      if (keyword === 'type' && name && tokens[i + 3]?.kind === 'punct' && tokens[i + 3].value === '=') {
        let j = i + 4;
        let depth = 0;
        const start = j;
        while (j < tokens.length) {
          const t = tokens[j];
          if (t.kind === 'punct' && (t.value === '{' || t.value === '[' || t.value === '(' || t.value === '<')) depth += 1;
          if (t.kind === 'punct' && (t.value === '}' || t.value === ']' || t.value === ')' || t.value === '>')) depth -= 1;
          if (depth === 0 && t.kind === 'punct' && t.value === ';') break;
          if (depth === 0 && t.kind === 'ident' && t.value === 'export') break;
          j += 1;
        }
        try {
          const parser = new TypeParser(tokens.slice(start, j));
          types[name] = parser.parseType();
        } catch {
          // ignore unreadable type aliases
        }
        i = j;
        continue;
      }
    }
    i += 1;
  }

  const routes: AsContractRoute[] = [];
  for (const node of Object.values(types)) {
    if (node.kind !== 'object') continue;
    for (const field of node.fields) {
      if (!field.name.includes('.') || field.type.kind !== 'object') continue;
      const kind = literalOf(field.type, 'kind');
      if (!kind) continue;
      const input: AsTypeNode = field.type.fields.find(item => item.name === 'input')?.type ?? { kind: 'object', fields: [] };
      routes.push({ route: field.name, kind, writes: literalOf(field.type, 'writes'), input, output: field.type.fields.find(item => item.name === 'output')?.type });
    }
  }
  return { types, routes };
}

function literalOf(node: { fields: AsTypeField[] }, name: string): string {
  const field = node.fields.find(item => item.name === name);
  return field?.type.kind === 'literal' ? field.type.values[0] ?? '' : '';
}

export interface AsTypeLeaf {
  path: string;
  required: boolean;
  type: AsTypeNode;
}

// Flattens an input type into wire leaves, resolving named types from the same contract.
export function flattenType(node: AsTypeNode, types: Record<string, AsTypeNode>, prefix = '', required = true, depth = 0): AsTypeLeaf[] {
  if (depth > 8) return [{ path: prefix, required, type: { kind: 'primitive', name: 'unknown' } }];
  if (node.kind === 'ref') {
    const resolved = types[node.name];
    if (!resolved) return [{ path: prefix, required, type: { kind: 'primitive', name: 'unknown' } }];
    return flattenType(resolved, types, prefix, required, depth + 1);
  }
  if (node.kind === 'object') {
    return node.fields.flatMap(field => flattenType(field.type, types, prefix ? `${prefix}.${field.name}` : field.name, required && !field.optional, depth + 1));
  }
  return [{ path: prefix, required, type: node }];
}
