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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

/**
 * Core migration versions live in ONE numbering space (`migrations_version`
 * is a single high-water mark, and baseline scripts are registered as core
 * migrations too). Two migrations sharing a version means the runner applies
 * whichever sorts first and then stamps past the other, which never runs
 * again anywhere — a silent, permanent skip whose only symptom is a schema
 * drift report months later.
 *
 * Three core migrations share version 2 from before this check existed. They
 * are grandfathered by name; nothing else may collide.
 */
const GRANDFATHERED_DUPLICATE_VERSIONS: Record<number, string[]> = {
  2: [
    "002_wizard_employment_status_mappings.ts",
    "002_create_ledger_table.ts",
    "002_drop_replit_user_id.ts",
  ],
};

/** The `version:` of the registered migration, resolving a local const. */
function migrationVersionOf(source: string): number | null {
  const direct = source.match(/^\s*version:\s*(\d+)\s*,/m);
  if (direct) return Number(direct[1]);
  const viaConst = source.match(/^\s*version:\s*([A-Za-z_$][\w$]*)\s*,/m);
  if (viaConst) {
    const decl = source.match(
      new RegExp(`const\\s+${viaConst[1]}\\s*(?::\\s*number\\s*)?=\\s*(\\d+)`),
    );
    if (decl) return Number(decl[1]);
  }
  return null;
}

function checkCoreVersionsUnique(): void {
  const dirs = ["scripts/migrate/core", "scripts/migrate/baseline"];
  const byVersion = new Map<number, string[]>();
  const unresolved: string[] = [];

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    } catch {
      continue;
    }
    for (const file of entries) {
      const version = migrationVersionOf(readFileSync(join(dir, file), "utf8"));
      if (version === null) {
        unresolved.push(`${dir}/${file}`);
        continue;
      }
      const list = byVersion.get(version) ?? [];
      list.push(file);
      byVersion.set(version, list);
    }
  }

  if (unresolved.length > 0) {
    console.error(
      [
        "",
        "[check-migrations] FAILED — could not read the version of these migration file(s):",
        ...unresolved.map((f) => `  - ${f}`),
        "",
        "Every core/baseline migration must declare `version: <number>,` (or a local",
        "`const X = <number>` referenced by it) so duplicate versions can be detected.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  const collisions: string[] = [];
  for (const [version, files] of byVersion) {
    if (files.length < 2) continue;
    const allowed = GRANDFATHERED_DUPLICATE_VERSIONS[version];
    if (allowed && files.every((f) => allowed.includes(f))) continue;
    collisions.push(`  version ${version}: ${files.sort().join(", ")}`);
  }

  if (collisions.length > 0) {
    console.error(
      [
        "",
        "[check-migrations] FAILED — duplicate core migration version(s).",
        "",
        ...collisions,
        "",
        "`migrations_version` is a single high-water mark: once the runner stamps a",
        "version, every migration at or below it is retired. A second migration sharing",
        "a version therefore never runs on any database that already passed it, and the",
        "only symptom is a schema drift report with no explanation.",
        "",
        "Renumber the new migration to the next unused version.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(
    `[check-migrations] core migration versions unique (${byVersion.size} version(s)) — OK`,
  );
}

function main(): void {
  if (process.argv.includes("--skip")) {
    console.log("[check-migrations] skipped via --skip flag");
    process.exit(0);
  }

  // Runs on EVERY invocation, not only when shared/schema* changed: a
  // duplicate version is a hazard whether or not the schema moved with it.
  checkCoreVersionsUnique();

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
