#!/usr/bin/env npx tsx
/**
 * Author-time enforcement: refuses to pass if a working-tree change touches
 * `shared/schema*` without also adding/modifying a migration file under
 * `scripts/migrate/core/` or `scripts/migrate/components/<id>/`.
 *
 * Run manually before committing schema changes:
 *
 *   npx tsx scripts/check-migrations.ts
 *
 * Or against a specific git range:
 *
 *   npx tsx scripts/check-migrations.ts --base=origin/main
 *
 * Escape hatch: if a schema change is genuinely a pure type/comment refactor
 * with NO runtime DDL impact, add the marker `[skip-migration-check]` to
 * the commit message or pass `--skip` on the command line. Use sparingly —
 * if the marker appears in a PR description without justification, reviewers
 * should push back.
 *
 * Exits 0 on pass, 1 on failure.
 */
import { execSync } from "node:child_process";

const SCHEMA_PREFIX = /^shared\/schema(\.ts|\/)/;
const CORE_MIGRATION_PREFIX = /^scripts\/migrate\/core\//;
const COMPONENT_MIGRATION_PREFIX = /^scripts\/migrate\/components\//;
const BASELINE_PREFIX = /^scripts\/migrate\/baseline\//;
const SKIP_MARKER = "[skip-migration-check]";

function arg(name: string): string | undefined {
  const found = process.argv.find(a => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : undefined;
}

function changedFiles(base: string | undefined): string[] {
  const range = base ? `${base}...HEAD` : "HEAD";
  let output: string;
  try {
    // Include both committed-vs-base and uncommitted (staged + working tree)
    // changes so the check fires during local iteration, not just on push.
    const committed = execSync(`git diff --name-only ${range}`, { encoding: "utf8" });
    const uncommitted = execSync(`git diff --name-only HEAD`, { encoding: "utf8" });
    output = committed + "\n" + uncommitted;
  } catch (err) {
    // Fall back to uncommitted changes only if the base isn't reachable.
    output = execSync(`git diff --name-only HEAD`, { encoding: "utf8" });
  }
  // Also include untracked files: a brand-new migration file (or schema
  // file) is invisible to `git diff` until it is committed, which used to
  // make this check false-fail ("schema change without migration") even
  // though the migration existed, and false-pass on untracked schema files.
  let untracked = "";
  try {
    untracked = execSync("git ls-files --others --exclude-standard", { encoding: "utf8" });
  } catch {
    // If git is unavailable for listing untracked files, proceed with diffs only.
  }
  output = output + "\n" + untracked;
  return Array.from(new Set(output.split("\n").map(s => s.trim()).filter(Boolean)));
}

function commitMessagesContain(marker: string, base: string | undefined): boolean {
  if (!base) return false;
  try {
    const out = execSync(`git log --format=%B ${base}..HEAD`, { encoding: "utf8" });
    return out.includes(marker);
  } catch {
    return false;
  }
}

function main(): void {
  if (process.argv.includes("--skip")) {
    console.log("[check-migrations] skipped via --skip flag");
    process.exit(0);
  }

  const base = arg("base");
  const files = changedFiles(base);

  const schemaTouched = files.filter(f => SCHEMA_PREFIX.test(f));
  if (schemaTouched.length === 0) {
    console.log("[check-migrations] no schema changes detected — OK");
    process.exit(0);
  }

  // Schema files were touched — also enforce the 63-char constraint-name
  // limit. Over-length drizzle auto-generated FK/unique names churn forever
  // under scripts/db-push.ts (Postgres truncates identifiers to 63 chars but
  // drizzle-kit diffs by the full name). This runs regardless of the
  // [skip-migration-check] marker: that escape hatch covers pure type
  // refactors, not naming hazards.
  try {
    execSync("npx tsx scripts/dev/check-constraint-names.ts", {
      stdio: "inherit",
    });
  } catch {
    console.error("[check-migrations] FAILED — over-length constraint name(s) detected (see above).");
    process.exit(1);
  }

  const migrationsTouched = files.filter(
    f =>
      CORE_MIGRATION_PREFIX.test(f) ||
      COMPONENT_MIGRATION_PREFIX.test(f) ||
      BASELINE_PREFIX.test(f),
  );

  if (migrationsTouched.length > 0) {
    console.log("[check-migrations] schema change accompanied by migration(s):");
    for (const f of migrationsTouched) console.log(`  + ${f}`);
    process.exit(0);
  }

  if (commitMessagesContain(SKIP_MARKER, base)) {
    console.log(`[check-migrations] schema change accepted: commit message contains ${SKIP_MARKER}`);
    process.exit(0);
  }

  console.error(
    [
      "",
      "[check-migrations] FAILED — schema change without migration.",
      "",
      "These shared/schema* files were modified:",
      ...schemaTouched.map(f => `  - ${f}`),
      "",
      "But no new file under one of these directories was added:",
      "  - scripts/migrate/core/                  (for global schema changes)",
      "  - scripts/migrate/components/<id>/       (for changes to a component's manifest tables)",
      "  - scripts/migrate/baseline/              (for per-deployment baseline scripts)",
      "",
      "Author a migration file, register it in scripts/migrate/index.ts, and re-run this check.",
      "",
      `Pure-type-refactor escape hatch: add ${SKIP_MARKER} to the commit message, or pass --skip.`,
      "",
    ].join("\n"),
  );
  process.exit(1);
}

main();
