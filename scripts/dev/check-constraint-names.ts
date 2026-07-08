#!/usr/bin/env tsx
/**
 * Check Constraint Name Lengths
 *
 * Postgres truncates identifiers to 63 characters. drizzle-kit diffs
 * constraints by their FULL (untruncated) name, so any foreign key or
 * unique constraint whose drizzle-generated name exceeds 63 chars will
 * churn forever under `scripts/db-push.ts` (drop + re-add on every run,
 * never converging to "No changes"). See
 * `.agents/memory/drizzle-kit-push-hazards.md` for background.
 *
 * This script walks every pgTable exported from `shared/schema` (which
 * re-exports all of `shared/schema/**`, including component-owned tables),
 * computes the name drizzle would use for each foreign key, unique
 * constraint, index, and composite primary key, and fails if any name
 * exceeds 63 characters.
 *
 * How to fix a violation:
 * - Foreign keys: inline `.references()` cannot take a name — convert it
 *   to an extraConfig `foreignKey({ name, columns, foreignColumns })`
 *   builder with an explicit name <= 63 chars that matches the live DB
 *   conname exactly. This pattern is used throughout `shared/schema.ts`
 *   and `shared/schema/**`.
 * - Unique constraints: pin an explicit name via `unique("name").on(...)`
 *   (extraConfig) or `.unique("name")` (column-level), <= 63 chars,
 *   matching the live DB conname. Declare columns in TABLE order.
 * - Indexes: pass an explicit name to `index("name")` /
 *   `uniqueIndex("name")`.
 * - Primary keys: pass `name` to `primaryKey({ name, columns })`.
 *
 * Usage: npx tsx scripts/dev/check-constraint-names.ts
 *
 * Also invoked automatically by `scripts/check-migrations.ts` whenever a
 * `shared/schema*` file is touched.
 */
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as fullSchema from "../../shared/schema";

const PG_IDENTIFIER_MAX = 63;

interface Violation {
  table: string;
  kind: "foreign key" | "unique constraint" | "index" | "primary key";
  name: string;
  explicit: boolean;
  fix: string;
}

function fkFix(explicit: boolean): string {
  return explicit
    ? "Shorten the pinned name to <= 63 chars (it must match the live DB conname exactly)."
    : "Convert the inline .references() to an extraConfig foreignKey({ name, columns, foreignColumns }) builder with an explicit name <= 63 chars (pattern used throughout shared/schema.ts and shared/schema/**).";
}

function uniqueFix(explicit: boolean): string {
  return explicit
    ? "Shorten the pinned name to <= 63 chars (it must match the live DB conname exactly)."
    : 'Pin an explicit name <= 63 chars: unique("name").on(...) in extraConfig, or .unique("name") on the column. Declare columns in TABLE order.';
}

function collectViolations(): Violation[] {
  const violations: Violation[] = [];

  for (const exported of Object.values(fullSchema)) {
    if (!is(exported, PgTable)) continue;

    const config = getTableConfig(exported);
    const tableName = config.name;

    for (const fk of config.foreignKeys) {
      const { name: explicitName } = fk.reference();
      const name = fk.getName();
      if (name.length > PG_IDENTIFIER_MAX) {
        violations.push({
          table: tableName,
          kind: "foreign key",
          name,
          explicit: explicitName !== undefined,
          fix: fkFix(explicitName !== undefined),
        });
      }
    }

    for (const uc of config.uniqueConstraints) {
      const name = uc.getName();
      if (name && name.length > PG_IDENTIFIER_MAX) {
        // UniqueConstraint resolves name ?? auto in its constructor, so
        // recompute the auto name to tell explicit from generated.
        const autoName = `${tableName}_${uc.columns.map((c) => c.name).join("_")}_unique`;
        const explicit = name !== autoName;
        violations.push({
          table: tableName,
          kind: "unique constraint",
          name,
          explicit,
          fix: uniqueFix(explicit),
        });
      }
    }

    // Column-level .unique() constraints don't appear in uniqueConstraints;
    // the resolved name lives on the column itself.
    for (const column of config.columns) {
      if (!column.isUnique) continue;
      const name = column.uniqueName;
      if (name && name.length > PG_IDENTIFIER_MAX) {
        const autoName = `${tableName}_${column.name}_unique`;
        const explicit = name !== autoName;
        violations.push({
          table: tableName,
          kind: "unique constraint",
          name,
          explicit,
          fix: uniqueFix(explicit),
        });
      }
    }

    for (const index of config.indexes) {
      const name = index.config.name;
      if (name && name.length > PG_IDENTIFIER_MAX) {
        violations.push({
          table: tableName,
          kind: "index",
          name,
          explicit: true,
          fix: 'Shorten the explicit index("name") / uniqueIndex("name") to <= 63 chars.',
        });
      }
    }

    for (const pk of config.primaryKeys) {
      const name = pk.getName();
      if (name && name.length > PG_IDENTIFIER_MAX) {
        violations.push({
          table: tableName,
          kind: "primary key",
          name,
          explicit: false,
          fix: "Pass an explicit `name` to primaryKey({ name, columns }) <= 63 chars.",
        });
      }
    }
  }

  return violations;
}

function main(): void {
  console.log("Checking drizzle constraint name lengths...\n");

  const violations = collectViolations();

  if (violations.length === 0) {
    console.log(
      `✓ All foreign key, unique constraint, index, and primary key names are <= ${PG_IDENTIFIER_MAX} chars.`,
    );
    process.exit(0);
  }

  console.error(
    `✗ Found ${violations.length} constraint name(s) longer than ${PG_IDENTIFIER_MAX} chars:\n`,
  );

  for (const v of violations) {
    const origin = v.explicit ? "explicit" : "auto-generated";
    console.error(`  table "${v.table}" — ${v.kind} (${origin}, ${v.name.length} chars)`);
    console.error(`    ${v.name}`);
    console.error(`    Fix: ${v.fix}`);
    console.error("");
  }

  console.error(
    [
      `WHY THIS FAILS: Postgres truncates identifiers to ${PG_IDENTIFIER_MAX} characters,`,
      "but drizzle-kit diffs constraints by their FULL name. An over-length name",
      "makes `scripts/db-push.ts` drop and re-add the same constraint on every",
      "run, forever. Pin an explicit name that fits.",
      "",
      "See .agents/memory/drizzle-kit-push-hazards.md and replit.md for details.",
    ].join("\n"),
  );

  process.exit(1);
}

main();
