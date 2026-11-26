#!/usr/bin/env tsx
/**
 * Check Storage Encapsulation
 *
 * Enforces the database access architecture rule (replit.md, "All database
 * access MUST go through the storage layer"): every query is built and issued
 * from a storage module. Outside the storage directories — `server/storage/**`
 * and each component's `components/<id>/server/storage/**` — a server file may
 * not construct a query. Concretely, it fails a file that:
 *
 *   [db-import]     value-imports the database client module (`server/db.ts`
 *                   or `server/storage/db.ts`: `db`, `pool`, …), statically or
 *                   via `await import(...)`;
 *   [get-client]    value-imports `getClient` from a storage module
 *                   (`server/storage/transaction-context`), or reaches it
 *                   through a static/dynamic namespace binding of one
 *                   (`tc.getClient`, `tc["getClient"]`, `const { getClient } = tc`);
 *   [drizzle-orm]   value-imports from `drizzle-orm` / `drizzle-orm/*`
 *                   (operators such as `eq`, `and`, `inArray`, the `sql`
 *                   template, dialects, …). Pure table-introspection helpers
 *                   (`getTableColumns`, `getTableConfig`, `getTableName`, `is`,
 *                   `Table`, `Column`, `SQL`) are allowed;
 *   [schema-table]  value-imports a Drizzle TABLE (or view) from a schema
 *                   module (`@shared/schema`, `shared/schema/**`, or a
 *                   component's `shared/schema/**`). Whether an export is a
 *                   table is decided by loading the schema module and asking
 *                   Drizzle, so Zod insert/validation schemas, enums,
 *                   constants and `import type` / `type` specifiers stay
 *                   allowed. A namespace import (`import * as schema`) of a
 *                   module that exports tables counts as a table import.
 *                   A table import is reported only when it builds a query:
 *                   the table is passed to `.from/.insert/.update/.delete/
 *                   …Join(...)`, or the file has another finding above. A
 *                   table handed purely as a declaration to a framework
 *                   (metadata contexts, token roots, options registrations)
 *                   is not a query.
 *
 * Sanctioned plugin read-only escape hatch: a file under `server/plugins/`
 * that declares `needsReadOnlyDb` (or is listed in READONLY_FLAG_EXEMPT_FILES
 * as plugin-kind/engine infrastructure whose wrapper carries the flag) may use
 * drizzle-orm operators and schema tables to build the read queries it runs
 * through `storage.readOnly.query(...)`. It still may NOT:
 *
 *   [plugin-mutation]  call an insert/update/delete builder on a schema table
 *                      (`.insert(table)`, `.update(table)`, `.delete(table)`),
 *                      or put INSERT/UPDATE/DELETE/MERGE/TRUNCATE/DDL in SQL
 *                      text — any `sql`/`ns.sql`/aliased sql template (an
 *                      interpolated `UPDATE ${table} SET` included), or a
 *                      string passed to `.execute()`, `.query()`, `.raw()`;
 *   [db-import] / [get-client]  — the client always comes from readOnly.query.
 *
 * In addition, a plugin calling `readOnly.query(...)` must declare
 * `needsReadOnlyDb` ([readonly-flag]); this one has no baseline.
 *
 * Shrink-only baseline: files that violated the rule when it was tightened
 * are listed, each with a reason, in `storage-encapsulation-baseline.ts`. A
 * baselined file is not reported; a NEW violating file fails the rule; and a
 * baseline entry whose file no longer exists or no longer violates ALSO fails
 * the rule, so the entry must be deleted — the list can only shrink.
 *
 * Before scanning, the rule runs its own detector over the in-memory fixtures
 * in `storage-encapsulation-fixtures.ts` and fails if any expectation is off.
 *
 * Not scanned: tests, `scripts/`, the client, and `shared/`.
 *
 * Usage: npx tsx scripts/dev/check-storage-encapsulation.ts
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, dirname, resolve } from 'path';
import { pathToFileURL } from 'url';
import ts from 'typescript';
import { is, Table, View } from 'drizzle-orm';
import { STORAGE_ENCAPSULATION_BASELINE } from './storage-encapsulation-baseline';
import { runSelfTest } from './storage-encapsulation-fixtures';
import { readComponentDeveloperChecks } from '../optional-components';

export type Pattern =
  | 'db-import'
  | 'get-client'
  | 'drizzle-orm'
  | 'schema-table'
  | 'plugin-mutation'
  | 'readonly-flag';

export interface Violation {
  file: string;
  line: number;
  pattern: Pattern;
  detail: string;
}

const ROOT = process.cwd();

const ALLOWED_FILES = [
  // Back-compat re-export of the storage-owned client.
  'server/db.ts',
];

// Files under server/plugins/ that call storage.readOnly.query(...) but are
// shared plugin-kind infrastructure rather than an individual plugin carrying
// its own `needsReadOnlyDb` metadata flag. These are exempt from the
// needsReadOnlyDb declaration requirement below, and — like a flagged plugin —
// may build read queries with drizzle-orm and schema tables.
const READONLY_FLAG_EXEMPT_FILES = [
  ...readComponentDeveloperChecks().readOnlyFlagExemptFiles,
  // Trust-eligibility executor: shared infra that loads exemptions across all
  // eligibility plugins; it is not itself a plugin with a metadata flag.
  'server/plugins/trust/eligibility/executor.ts',
  // Wizard engine internals. A wizard's direct read query lives in its
  // engine/types/*.ts implementation, while the `needsReadOnlyDb: true`
  // opt-in flag is declared on the thin plugins/*.ts wrapper's metadata (and
  // surfaced by the wizard registry). These engine files are that wizard's
  // implementation, not a separate plugin carrying its own flag, so they are
  // exempt from the per-file flag requirement. Each entry corresponds to a
  // plugin wrapper that declares `needsReadOnlyDb: true`.
  // Trust-provider EDI shared infrastructure and file-type plugins: their read
  // queries live here while the `needsReadOnlyDb: true` flag is declared on
  // the single trust_provider_edi wizard wrapper that drives them.
  'server/plugins/trust/provider-edi/base.ts',
  'server/plugins/trust/provider-edi/plugins/sitespecific-bao-healthnet.ts',
  'server/plugins/trust/provider-edi/plugins/sitespecific-bao-kaiser.ts',
  'server/plugins/wizards/engine/types/report_workers_missing_ssn.ts',
  'server/plugins/wizards/engine/types/report_workers_invalid_ssn.ts',
  'server/plugins/wizards/engine/types/report_workers_duplicate_ssn.ts',
  'server/plugins/wizards/engine/types/report_gbhet_legal_compliance.ts',
  'server/plugins/wizards/engine/types/report_employer_users.ts',
  'server/plugins/wizards/engine/types/report_btu_workers_invalid_cardcheck.ts',
  'server/plugins/wizards/engine/types/btu_dues_allocation.ts',
  'server/plugins/wizards/engine/types/btu_cardcheck_import.ts',
];

// drizzle-orm value exports that only introspect table definitions or test a
// value's kind; they cannot build or run a query on their own.
const DRIZZLE_INTROSPECTION_EXPORTS = new Set([
  'getTableColumns',
  'getTableConfig',
  'getTableName',
  'getViewName',
  'is',
  'Table',
  'Column',
  'SQL',
]);

const MUTATION_METHODS = new Set(['insert', 'update', 'delete']);
// Query-builder methods whose first argument is the table being queried.
const BUILDER_METHODS = new Set([
  ...MUTATION_METHODS,
  'from',
  'innerJoin',
  'leftJoin',
  'rightJoin',
  'fullJoin',
  'crossJoin',
]);
// Write/DDL statements in SQL text. `update … set` spans whatever names the
// table, including an interpolated `${table}`.
const MUTATING_SQL =
  /\b(insert\s+into|delete\s+from|update\b[^;]*?\bset|merge\s+into|truncate|(?:drop|alter|create)\s+(?:table|index|schema|view|sequence|type|function|trigger))\b/i;
// Client methods that run SQL text handed to them as a plain string.
const RAW_SQL_CALLS = new Set(['execute', 'query', 'raw']);

const FIX_HINT =
  'Move the query into a storage method (server/storage/** or the component\'s server/storage/**) and call it ' +
  'via storage.*. See replit.md "All database access MUST go through the storage layer".';

/** Strip a leading `components/<id>/` so component files match core paths. */
function corePath(relPath: string): string {
  return relPath.replace(/^components\/[^/]+\//, '');
}

function isInStorageDirectory(relPath: string): boolean {
  return corePath(relPath).startsWith('server/storage/');
}

function findTsFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry !== 'node_modules' && entry !== '.git' && entry !== 'dist') findTsFiles(fullPath, files);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Resolve an import specifier to a repo-relative file path, or null when it is a package. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@shared/')) base = join(ROOT, 'shared', spec.slice('@shared/'.length));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else if (spec.startsWith('server/')) base = join(ROOT, spec);
  else return null;
  base = base.replace(/\.js$/, '');
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return relative(ROOT, candidate).replace(/\\/g, '/');
    }
  }
  return relative(ROOT, `${base}.ts`).replace(/\\/g, '/');
}

const DB_MODULES = new Set(['server/db.ts', 'server/storage/db.ts']);
const isDbModule = (p: string | null) => p !== null && DB_MODULES.has(p);
const isStorageModule = (p: string | null) => p !== null && isInStorageDirectory(p);
const isSchemaModule = (p: string | null) =>
  p !== null && /(^|\/)shared\/schema(\.ts$|\/)/.test(p);
const isDrizzleModule = (spec: string) => spec === 'drizzle-orm' || spec.startsWith('drizzle-orm/');

// Schema module → set of exported table/view names, loaded once per module.
const schemaTableCache = new Map<string, Set<string>>();
async function tableExportsOf(schemaPath: string): Promise<Set<string>> {
  const cached = schemaTableCache.get(schemaPath);
  if (cached) return cached;
  const mod = await import(pathToFileURL(join(ROOT, schemaPath)).href);
  const tables = new Set<string>();
  for (const [name, value] of Object.entries(mod)) {
    if (value && typeof value === 'object' && (is(value, Table) || is(value, View))) tables.add(name);
  }
  schemaTableCache.set(schemaPath, tables);
  return tables;
}

/** One import site: which module, and which value bindings it brings in. */
interface ImportSite {
  spec: string;
  line: number;
  /** Imported export names (value only) → local binding name. */
  named: Array<{ imported: string; local: string }>;
  /** Local name of a namespace binding (`import * as x`, `const x = await import(...)`). */
  namespace?: string;
  /** A dynamic import whose result is not bound to names we can see. */
  unbound?: boolean;
  dynamic: boolean;
}

function collectImports(sf: ts.SourceFile): ImportSite[] {
  const sites: ImportSite[] = [];
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const clause = stmt.importClause;
    const site: ImportSite = { spec: stmt.moduleSpecifier.text, line: lineOf(stmt), named: [], dynamic: false };
    if (!clause) continue; // side-effect import: no bindings
    if (clause.isTypeOnly) continue;
    if (clause.name) site.named.push({ imported: 'default', local: clause.name.text });
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) site.namespace = nb.name.text;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        if (el.isTypeOnly) continue;
        site.named.push({ imported: (el.propertyName ?? el.name).text, local: el.name.text });
      }
    }
    if (site.named.length || site.namespace) sites.push(site);
  }

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const site: ImportSite = { spec: node.arguments[0].text, line: lineOf(node), named: [], dynamic: true };
      let outer: ts.Node = node;
      while (ts.isAwaitExpression(outer.parent) || ts.isParenthesizedExpression(outer.parent)) outer = outer.parent;
      const parent = outer.parent;
      if (ts.isVariableDeclaration(parent) && parent.initializer === outer) {
        if (ts.isObjectBindingPattern(parent.name)) {
          for (const el of parent.name.elements) {
            const imported = el.propertyName && ts.isIdentifier(el.propertyName)
              ? el.propertyName.text
              : ts.isIdentifier(el.name) ? el.name.text : undefined;
            if (imported && ts.isIdentifier(el.name)) site.named.push({ imported, local: el.name.text });
          }
        } else if (ts.isIdentifier(parent.name)) {
          site.namespace = parent.name.text;
        }
      } else if (ts.isPropertyAccessExpression(parent) && parent.expression === outer) {
        site.named.push({ imported: parent.name.text, local: parent.name.text });
      } else {
        site.unbound = true;
      }
      sites.push(site);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

export interface FileResult {
  violations: Violation[];
}

async function checkFile(filePath: string): Promise<FileResult> {
  const relPath = relative(ROOT, filePath).replace(/\\/g, '/');
  if (isInStorageDirectory(relPath) || ALLOWED_FILES.includes(relPath)) return { violations: [] };
  return checkSource(relPath, readFileSync(filePath, 'utf-8'));
}

/** Check one file's source. `relPath` is repo-relative; imports resolve from it. */
export async function checkSource(relPath: string, content: string): Promise<FileResult> {
  const violations: Violation[] = [];
  const filePath = join(ROOT, relPath);
  if (isInStorageDirectory(relPath) || ALLOWED_FILES.includes(relPath)) return { violations };

  const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = content.split('\n');
  const normalized = corePath(relPath);

  const isPlugin = normalized.startsWith('server/plugins/');
  const readOnlyOptIn =
    isPlugin && (content.includes('needsReadOnlyDb') || READONLY_FLAG_EXEMPT_FILES.includes(relPath));

  const push = (line: number, pattern: Pattern, detail: string) =>
    violations.push({ file: relPath, line, pattern, detail });

  // Local names bound to schema tables / schema namespaces / drizzle `sql`,
  // used by the plugin mutation scan below.
  const tableLocals = new Set<string>();
  const schemaNamespaces = new Map<string, Set<string>>();
  const sqlLocals = new Set<string>();
  const drizzleNamespaces = new Set<string>();
  const storageNamespaces = new Map<string, ImportSite>();
  const schemaFindings: Array<{ line: number; detail: string }> = [];

  for (const site of collectImports(sf)) {
    const how = site.dynamic ? 'dynamic import' : 'import';

    if (isDrizzleModule(site.spec)) {
      for (const n of site.named) if (n.imported === 'sql') sqlLocals.add(n.local);
      if (site.namespace) drizzleNamespaces.add(site.namespace);
      if (readOnlyOptIn) continue;
      const names = site.named.map((n) => n.imported).filter((n) => !DRIZZLE_INTROSPECTION_EXPORTS.has(n));
      if (site.namespace || site.unbound) names.unshift(site.namespace ? `* as ${site.namespace}` : '*');
      if (names.length) push(site.line, 'drizzle-orm', `${how} of { ${names.join(', ')} } from "${site.spec}"`);
      continue;
    }

    const target = resolveSpecifier(filePath, site.spec);

    if (isDbModule(target)) {
      const names = site.named.map((n) => n.imported);
      if (site.namespace) names.push(`* as ${site.namespace}`);
      if (site.unbound) names.push('*');
      if (names.length) push(site.line, 'db-import', `${how} of { ${names.join(', ')} } from "${site.spec}"`);
      continue;
    }

    if (isStorageModule(target)) {
      if (site.named.some((n) => n.imported === 'getClient')) {
        push(site.line, 'get-client', `${how} of getClient from "${site.spec}"`);
      }
      // `import * as tc` / `const tc = await import(...)`: checked by use below.
      if (site.namespace) storageNamespaces.set(site.namespace, site);
      continue;
    }

    if (isSchemaModule(target)) {
      if (!existsSync(join(ROOT, target!))) continue;
      const tables = await tableExportsOf(target!);
      const used = site.named.filter((n) => tables.has(n.imported));
      for (const n of used) tableLocals.add(n.local);
      if (site.namespace && tables.size) schemaNamespaces.set(site.namespace, tables);
      if (readOnlyOptIn) continue;
      const names = used.map((n) => n.imported);
      if (site.namespace && tables.size) names.unshift(`* as ${site.namespace}`);
      if (names.length) {
        const shown = names.length > 6 ? [...names.slice(0, 6), `… +${names.length - 6} more`] : names;
        schemaFindings.push({ line: site.line, detail: `${how} of table(s) { ${shown.join(', ')} } from "${site.spec}"` });
      }
    }
  }

  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const tableRef = (expr: ts.Expression | undefined): string | undefined => {
    if (!expr) return undefined;
    if (ts.isIdentifier(expr) && tableLocals.has(expr.text)) return expr.text;
    if (
      ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      schemaNamespaces.get(expr.expression.text)?.has(expr.name.text)
    ) {
      return `${expr.expression.text}.${expr.name.text}`;
    }
    return undefined;
  };

  // Walk once for table-as-builder-argument uses and mutating sql templates.
  let tableInBuilder = false;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const table = BUILDER_METHODS.has(method) ? tableRef(node.arguments[0]) : undefined;
      if (table) {
        tableInBuilder = true;
        if (readOnlyOptIn && MUTATION_METHODS.has(method)) {
          push(lineOf(node), 'plugin-mutation', `.${method}(${table}) query builder`);
        }
      }
    }
    // getClient reached through a storage-module namespace binding.
    const nsGetClient = (ns: ts.Expression, name: string | undefined) =>
      ts.isIdentifier(ns) && storageNamespaces.has(ns.text) && name === 'getClient' ? ns.text : undefined;
    let viaNs: string | undefined;
    if (ts.isPropertyAccessExpression(node)) viaNs = nsGetClient(node.expression, node.name.text);
    else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      viaNs = nsGetClient(node.expression, node.argumentExpression.text);
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectBindingPattern(node.name) &&
      node.name.elements.some((el) => ((el.propertyName ?? el.name) as ts.Identifier).text === 'getClient')
    ) {
      viaNs = nsGetClient(node.initializer, 'getClient');
    }
    if (viaNs) {
      const site = storageNamespaces.get(viaNs)!;
      push(lineOf(node), 'get-client', `getClient via namespace "${viaNs}" from "${site.spec}"`);
    }

    if (readOnlyOptIn) {
      // sql`…` / ns.sql`…` / an aliased drizzle sql tag.
      if (ts.isTaggedTemplateExpression(node)) {
        const tag = node.tag;
        const isSqlTag =
          (ts.isIdentifier(tag) && (sqlLocals.has(tag.text) || tag.text === 'sql')) ||
          (ts.isPropertyAccessExpression(tag) && tag.name.text === 'sql');
        if (isSqlTag) {
          const m = node.template.getText(sf).match(MUTATING_SQL);
          if (m) push(lineOf(node), 'plugin-mutation', `${tag.getText(sf)} template containing "${m[1]}"`);
        }
      }
      // sql.raw("…"), client.execute("…"), client.query("…") with SQL text.
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        RAW_SQL_CALLS.has(node.expression.name.text)
      ) {
        for (const arg of node.arguments) {
          if (ts.isStringLiteralLike(arg) || ts.isTemplateExpression(arg)) {
            const m = arg.getText(sf).match(MUTATING_SQL);
            if (m) push(lineOf(node), 'plugin-mutation', `.${node.expression.name.text}() SQL text containing "${m[1]}"`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // A table import is a query-building import when the table is handed to a
  // query builder, or the file builds queries some other way. A table passed
  // purely as a declaration to a framework (metadata contexts, token roots,
  // options registrations) is not a query and is allowed.
  if (!readOnlyOptIn && (tableInBuilder || violations.length > 0)) {
    for (const f of schemaFindings) push(f.line, 'schema-table', f.detail);
  }
  violations.sort((a, b) => a.line - b.line);

  // Plugins that reach for direct read-only DB access via
  // storage.readOnly.query(...) must opt in explicitly by declaring
  // `needsReadOnlyDb: true` in their metadata. This keeps the escape hatch
  // visible and auditable. Shared plugin-kind infrastructure is exempt via
  // READONLY_FLAG_EXEMPT_FILES.
  if (isPlugin && /readOnly\.query\s*\(/.test(content) && !readOnlyOptIn) {
    const lineIndex = lines.findIndex((l) => /readOnly\.query\s*\(/.test(l));
    push(
      lineIndex >= 0 ? lineIndex + 1 : 1,
      'readonly-flag',
      'storage.readOnly.query(...) without `needsReadOnlyDb: true` in the plugin metadata',
    );
  }

  return { violations };
}

function hintFor(pattern: Pattern): string {
  switch (pattern) {
    case 'readonly-flag':
      return 'Declare `needsReadOnlyDb: true` in the plugin metadata, or move the query into a storage method.';
    case 'plugin-mutation':
      return 'The plugin read-only opt-in covers reads only; mutations must go through a storage method. ' +
        'See replit.md "All database access MUST go through the storage layer".';
    default:
      return FIX_HINT;
  }
}

async function main() {
  console.log('Checking storage encapsulation...\n');

  // The rule checks itself first: a detector that silently stopped matching
  // would otherwise pass every file and "shrink" nothing.
  const selfTestFailures = await runSelfTest(checkSource);
  if (selfTestFailures.length) {
    console.log('✗ The storage-encapsulation detector failed its own fixtures:\n');
    for (const f of selfTestFailures) console.log(`  ${f}`);
    console.log('\n  Fix the detector in scripts/dev/check-storage-encapsulation.ts (fixtures in storage-encapsulation-fixtures.ts).');
    process.exit(2);
  }

  const files = findTsFiles(join(ROOT, 'server'));
  const componentsDir = join(ROOT, 'components');
  if (existsSync(componentsDir)) {
    for (const entry of readdirSync(componentsDir)) {
      const componentServer = join(componentsDir, entry, 'server');
      if (existsSync(componentServer) && statSync(componentServer).isDirectory()) findTsFiles(componentServer, files);
    }
  }

  const byFile = new Map<string, Violation[]>();
  for (const file of files) {
    const { violations } = await checkFile(file);
    if (violations.length) byFile.set(violations[0].file, violations);
  }

  const baseline = { ...STORAGE_ENCAPSULATION_BASELINE, ...readComponentDeveloperChecks().storageEncapsulationBaseline };
  const reported: Violation[] = [];
  for (const [file, violations] of byFile) {
    const baselined = Object.prototype.hasOwnProperty.call(baseline, file);
    // The missing-flag rule is not baselinable: it was clean when tightened.
    for (const v of violations) if (!baselined || v.pattern === 'readonly-flag') reported.push(v);
  }

  const stale: Array<{ file: string; why: string }> = [];
  for (const file of Object.keys(baseline)) {
    if (!existsSync(join(ROOT, file))) stale.push({ file, why: 'file no longer exists' });
    else if (!(byFile.get(file) ?? []).some((v) => v.pattern !== 'readonly-flag')) {
      stale.push({ file, why: 'file no longer violates the rule' });
    }
  }

  const baselinedCount = Object.keys(baseline).length - stale.length;

  if (reported.length === 0 && stale.length === 0) {
    console.log('✓ No new storage encapsulation violations found.');
    console.log(`  (${baselinedCount} pre-existing violator(s) remain in scripts/dev/storage-encapsulation-baseline.ts)`);
    process.exit(0);
  }

  if (reported.length) {
    console.log(`✗ Found ${reported.length} storage encapsulation violation(s):\n`);
    for (const v of reported) {
      console.log(`  ${v.file}:${v.line} [${v.pattern}]`);
      console.log(`    Matched: ${v.detail}`);
      console.log(`    Fix: ${hintFor(v.pattern)}`);
      console.log('');
    }
  }

  if (stale.length) {
    console.log(`✗ ${stale.length} stale baseline entr${stale.length === 1 ? 'y' : 'ies'} — the baseline only shrinks:\n`);
    for (const s of stale) {
      console.log(`  ${s.file} (${s.why})`);
      console.log('    Fix: delete this entry from scripts/dev/storage-encapsulation-baseline.ts.');
      console.log('');
    }
  }

  console.log('ARCHITECTURE RULE: All database access must go through the storage layer.');
  console.log('Do not add new files to the baseline; add a storage method instead.');
  console.log('See replit.md "All database access MUST go through the storage layer".');
  console.log('');
  process.exit(1);
}

main().catch((err) => {
  console.error('[storage-encapsulation] check crashed:', err);
  process.exit(2);
});
