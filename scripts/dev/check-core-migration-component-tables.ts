#!/usr/bin/env tsx
/**
 * Check Core Migrations Against Component-Owned Tables
 *
 * A core migration (`scripts/migrate/core/`) runs on EVERY deployment, in
 * order, and the runner stops the boot at the first failure. A table listed in
 * a component's `schemaManifest` only exists where that component has been
 * enabled — components are opt-in, and most default to off.
 *
 * So a core migration that names a component-owned table without checking for
 * it first bricks the boot of every deployment where the component is off:
 * the database is left half-migrated at the failing version, every later
 * migration stays pending behind it, and the app refuses to serve traffic.
 * That failure only shows up on the deploy that has the component disabled,
 * which is usually not the one the migration was written on.
 *
 * WHAT IT SEES. Only the SQL a migration executes — the contents of its `sql`
 * tagged templates. Core migrations issue raw DDL, so that is where the risk
 * is; a table name in a doc comment, a log message or the migration's own
 * description is prose about a table, not access to it. Two consequences worth
 * knowing: a migration that reaches the database some other way (a Drizzle
 * query builder over an imported table, SQL assembled from a variable) is
 * outside what this rule can see, and the check is textual, so it proves a
 * guard is *present and positioned* to protect the first use — not that the
 * code branches on its result. It closes the copy-paste failure that keeps
 * recurring; it is not a proof of correctness.
 *
 * WHAT COUNTS AS GUARDED, per referenced table:
 *
 *   1. A check NAMES the table — either the name is quoted inside a catalog
 *      query (`table_name = 'dispatches'`, `to_regclass('public.dispatches')`)
 *      or it is the argument of an existence-check call, i.e. one whose name
 *      says so: `tableExists("dispatches")`. A quoted name in a log line or a
 *      description is prose, not a check; and
 *   2. that check sits BEFORE the first SQL statement using the table (a check
 *      after the fact protects nothing); and
 *   3. there is a conditional between the two, so the check is being branched
 *      on rather than merely performed.
 *
 * A probe for some OTHER table does not count — that was the hole that let the
 * original failure through in review.
 *
 * Usage: npx tsx scripts/dev/check-core-migration-component-tables.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAllComponents } from "../../shared/components";

const CORE_DIR = "scripts/migrate/core";

const PROBE = /information_schema\.(tables|columns)|to_regclass/;

/** A call whose name claims to answer "is it there?" — `tableExists(...)`. */
const CHECK_CALLEE = /exist|has|present|check/i;

export interface UnguardedReference {
  table: string;
  componentId: string;
  reason: string;
}

/** Every table owned by a component's schema manifest → the owning component. */
export function componentOwnedTables(): Map<string, string> {
  const owned = new Map<string, string>();
  for (const component of getAllComponents()) {
    for (const table of component.schemaManifest?.tables ?? []) {
      owned.set(table, component.id);
    }
  }
  return owned;
}

/**
 * Blank out comments, preserving length so every offset below still lines up.
 * A table name in a doc comment must not read as a check OR as a use.
 */
function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`\\])\/\/[^\n]*/g, (match, prefix) => {
    const keep = typeof prefix === "string" ? prefix : "";
    return keep + " ".repeat(match.length - keep.length);
  });
}

/** Source offsets of every `sql` tagged template's contents. */
function sqlTemplateRanges(source: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const opener = /\bsql`/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    const start = match.index + match[0].length;
    const end = source.indexOf("`", start);
    if (end === -1) break;
    ranges.push({ start, end });
    opener.lastIndex = end + 1;
  }
  return ranges;
}

/** A template's contents split into statements, with their source offsets. */
function statementsIn(source: string, range: { start: number; end: number }) {
  const statements: { start: number; end: number }[] = [];
  let cursor = range.start;
  while (cursor < range.end) {
    const semicolon = source.indexOf(";", cursor);
    const stop = semicolon === -1 || semicolon > range.end ? range.end : semicolon;
    statements.push({ start: cursor, end: stop });
    cursor = stop + 1;
  }
  return statements;
}

/** Every SQL statement a migration executes, catalog queries kept separate. */
function sqlStatements(source: string): { start: number; end: number; isProbe: boolean }[] {
  const statements: { start: number; end: number; isProbe: boolean }[] = [];
  for (const range of sqlTemplateRanges(source)) {
    for (const statement of statementsIn(source, range)) {
      statements.push({
        ...statement,
        isProbe: PROBE.test(source.slice(statement.start, statement.end)),
      });
    }
  }
  return statements;
}

/**
 * Offset of the first use of `table` inside executed SQL, or -1. A statement
 * that only asks the catalog whether the table exists is a check, not a use —
 * but only that statement is excused, not the rest of a template that happens
 * to contain one.
 */
function firstSqlUse(source: string, table: string): number {
  const word = new RegExp(`\\b${table}\\b`, "g");
  for (const { start, end, isProbe } of sqlStatements(source)) {
    if (isProbe) continue;
    word.lastIndex = start;
    const match = word.exec(source);
    if (match && match.index < end) return match.index;
  }
  return -1;
}

/**
 * Offset of the first place the table is named BY A CHECK, or -1: quoted
 * inside a catalog query, or passed to a call that says it tests existence.
 * A quoted name in a log line, a description or a comment is prose.
 */
function firstNamedCheck(source: string, table: string): number {
  const quoted = new RegExp(`["'\`]${table}["'\`]`, "g");
  const probeStatements = sqlStatements(source).filter((s) => s.isProbe);
  const callArgument = new RegExp(
    `\\b([A-Za-z_$][\\w$]*)\\s*\\(\\s*["'\`]${table}["'\`]\\s*[,)]`,
    "g",
  );

  const offsets: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(source)) !== null) {
    if (probeStatements.some((s) => match!.index >= s.start && match!.index < s.end)) {
      offsets.push(match.index);
    }
  }
  while ((match = callArgument.exec(source)) !== null) {
    if (CHECK_CALLEE.test(match[1])) offsets.push(match.index);
  }
  return offsets.length > 0 ? Math.min(...offsets) : -1;
}

/** Start of the line containing `offset` — a guard's `if` may precede it. */
function lineStart(source: string, offset: number): number {
  return source.lastIndexOf("\n", offset) + 1;
}

/**
 * Component-owned tables a migration's SQL touches without a guard that could
 * protect the first use. Pure — the caller supplies the source and the
 * ownership map, so this is exercised directly by its test fixtures.
 */
export function unguardedReferences(
  raw: string,
  owned: Map<string, string>,
): UnguardedReference[] {
  const found: UnguardedReference[] = [];
  const source = blankComments(raw);

  for (const [table, componentId] of owned) {
    const use = firstSqlUse(source, table);
    if (use === -1) continue;

    const named = firstNamedCheck(source, table);
    if (named === -1 || !PROBE.test(source)) {
      found.push({
        table,
        componentId,
        reason: "nothing checks whether the table exists before the migration uses it",
      });
      continue;
    }
    if (named > use) {
      found.push({
        table,
        componentId,
        reason: "the existence check for it comes after the first statement that uses it",
      });
      continue;
    }
    const between = source.slice(lineStart(source, named), use);
    if (!/\bif\s*\(/.test(between)) {
      found.push({
        table,
        componentId,
        reason:
          "the table is named in a check, but nothing branches on the result before it is used",
      });
    }
  }

  return found;
}

export function describeViolation(file: string, violation: UnguardedReference): string {
  return (
    `${file}: uses "${violation.table}", owned by the "${violation.componentId}" component's ` +
    `schema manifest — ${violation.reason}. On a deployment where that component is disabled ` +
    `the table is absent, this core migration throws, and the boot stops with the database ` +
    `half-migrated. Fix it one of two ways: probe for the table by name and return early when ` +
    `it is absent, before any statement that uses it (see ` +
    `scripts/migrate/core/1052_add_dispatch_is_primary.ts), or move the migration to ` +
    `scripts/migrate/components/${violation.componentId}/ if the work only makes sense where ` +
    `the component is on.`
  );
}

function main(): void {
  const owned = componentOwnedTables();
  const files = readdirSync(CORE_DIR)
    .filter((f) => f.endsWith(".ts"))
    .sort();

  const errors: string[] = [];
  let referenceCount = 0;

  for (const file of files) {
    const source = readFileSync(join(CORE_DIR, file), "utf8");
    const scannable = blankComments(source);
    for (const table of owned.keys()) {
      if (firstSqlUse(scannable, table) !== -1) referenceCount++;
    }
    for (const violation of unguardedReferences(source, owned)) {
      errors.push(describeViolation(`${CORE_DIR}/${file}`, violation));
    }
  }

  if (errors.length > 0) {
    console.error("Core-migration component-table check FAILED:\n");
    for (const err of errors) {
      console.error(`  ✗ ${err}\n`);
    }
    console.error(
      `${errors.length} unguarded reference(s). A core migration runs everywhere; a ` +
        `component-owned table does not exist everywhere.`,
    );
    process.exit(1);
  }

  console.log(
    `✓ Core-migration component-table check passed: ${files.length} core migration(s), ` +
      `${referenceCount} use(s) of component-owned tables, each behind an existence check.`,
  );
}

// Only run as a script; the test suite imports the pure helpers above.
if (process.argv[1] && process.argv[1].endsWith("check-core-migration-component-tables.ts")) {
  main();
}
