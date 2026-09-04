#!/usr/bin/env tsx
/**
 * Check Component Manifest Coverage
 *
 * Every `pgTable` declared in a schema-managing component's `schemaPath`
 * file must be listed in that component's `schemaManifest.tables`
 * (`shared/components.ts`). The manifest is the ONLY thing the runtime
 * consults for a component's schema:
 *
 *   - the enable-path push (`server/services/component-schema-push.ts`)
 *     creates manifest tables and nothing else, and
 *   - the startup drift gate (`server/services/schema-drift-check.ts`)
 *     compares manifest tables per component; a table it cannot attribute
 *     to a component but finds exported through `shared/schema` is judged
 *     as CORE — expected on every deployment, whether or not the component
 *     is enabled.
 *
 * So a table added to the schema file but not to the manifest is invisible
 * to the fresh-enable path, has no drift check on a database where it does
 * exist, and refuses boot on every database where it does not. The Benefit
 * Appeal tables shipped exactly that way; this rule makes the omission a
 * lint failure instead of a runtime "relation does not exist".
 *
 * The scan is textual and deliberately so: it reads the declarations in the
 * file (comments blanked), not the module's exports, so a table re-exported
 * from elsewhere is not attributed to the component, and a table declared
 * here but not exported is still caught. A `pgTable(` call whose table name
 * is not a plain string literal cannot be verified and fails the rule.
 *
 * Coverage is one-directional on purpose. The reverse — a manifest table
 * with no Drizzle definition — is what `component-table-order` fails on.
 *
 * Usage: npx tsx scripts/dev/check-component-manifest-coverage.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSchemaManagingComponents } from "../../shared/components";

/** Blank out comments, preserving length; a table name in prose is not a declaration. */
function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`\\])\/\/[^\n]*/g, (match, prefix) => {
    const keep = typeof prefix === "string" ? prefix : "";
    return keep + " ".repeat(match.length - keep.length);
  });
}

/** `pgTable("name", …)` / `pgTable('name', …)`, with any whitespace after the paren. */
const PG_TABLE_CALL = /\bpgTable\s*\(\s*(?:(["'])([^"'\n]+)\1|([^\s"']))/g;

interface Declaration {
  tableName: string;
  line: number;
}

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

/**
 * Every table declared in the file. Throws (with the offending line) when a
 * declaration's name is not a string literal, because a name the rule cannot
 * read is a name it cannot vouch for.
 */
function declaredTables(source: string, file: string): Declaration[] {
  const scannable = blankComments(source);
  const found: Declaration[] = [];
  for (const match of scannable.matchAll(PG_TABLE_CALL)) {
    const line = lineOf(scannable, match.index ?? 0);
    if (match[2] === undefined) {
      throw new Error(
        `${file}:${line}: pgTable(...) is called with a table name that is not a string ` +
          `literal, so its manifest coverage cannot be checked. Declare the table with a ` +
          `literal name: pgTable("<table_name>", { ... }).`,
      );
    }
    found.push({ tableName: match[2], line });
  }
  return found;
}

function main(): void {
  const cwd = process.cwd();
  const errors: string[] = [];
  let componentCount = 0;
  let declarationCount = 0;

  for (const component of getSchemaManagingComponents()) {
    if (!component.managesSchema || !component.schemaManifest) continue;
    componentCount++;
    const { schemaPath, tables } = component.schemaManifest;
    const file = schemaPath.replace(/^\.\//, "");
    const absPath = join(cwd, file);
    if (!existsSync(absPath)) {
      errors.push(
        `Component "${component.id}": schemaManifest.schemaPath "${schemaPath}" does not exist, ` +
          `so nothing can be checked against its manifest. Point schemaPath at the component's ` +
          `schema module.`,
      );
      continue;
    }

    let declared: Declaration[];
    try {
      declared = declaredTables(readFileSync(absPath, "utf8"), file);
    } catch (e: any) {
      errors.push(`Component "${component.id}": ${e.message}`);
      continue;
    }
    declarationCount += declared.length;

    const manifest = new Set(tables);
    const migrationsDir = `scripts/migrate/components/${component.id}/`;
    for (const { tableName, line } of declared) {
      if (manifest.has(tableName)) continue;
      errors.push(
        `Component "${component.id}": ${file}:${line} declares pgTable "${tableName}" but the ` +
          `component's schemaManifest.tables in shared/components.ts does not list it. The ` +
          `enable-path push never creates it, the drift gate never checks it where it exists ` +
          `and reports it as a missing CORE table where it does not, and the app fails at first ` +
          `use with "relation does not exist". Add "${tableName}" to the manifest in FK creation ` +
          `order (after every table it references), bump the manifest version, and ship a ` +
          `component migration under ${migrationsDir} that creates it on databases already ` +
          `brought up.`,
      );
    }
  }

  if (errors.length > 0) {
    console.error("Component manifest-coverage check FAILED:\n");
    for (const err of errors) {
      console.error(`  ✗ ${err}\n`);
    }
    console.error(
      `${errors.length} problem(s). Every pgTable declared in a component's schema module must ` +
        `appear in that component's schemaManifest.tables.`,
    );
    process.exit(1);
  }

  console.log(
    `✓ Component manifest-coverage check passed: ${declarationCount} pgTable declaration(s) across ` +
      `${componentCount} schema-managing component(s) are all listed in their component's manifest.`,
  );
}

try {
  main();
} catch (e: any) {
  console.error(`Component manifest-coverage check crashed: ${e?.stack ?? e}`);
  process.exit(1);
}
