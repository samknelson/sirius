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

/**
 * Files ADDED relative to the base (or untracked) — used to identify brand-new
 * core migration files for the version-collision check.
 */
function addedFiles(base: string | undefined): string[] {
  let output = "";
  try {
    if (base) {
      output += execSync(`git diff --name-only --diff-filter=A ${base}...HEAD`, { encoding: "utf8" });
    }
    output += "\n" + execSync("git diff --name-only --diff-filter=A HEAD", { encoding: "utf8" });
  } catch {
    // ignore — fall through to untracked
  }
  try {
    output += "\n" + execSync("git ls-files --others --exclude-standard", { encoding: "utf8" });
  } catch {
    // ignore
  }
  return Array.from(new Set(output.split("\n").map(s => s.trim()).filter(Boolean)));
}

function coreVersionOf(file: string): number | null {
  const m = /^scripts\/migrate\/core\/(\d+)_/.exec(file);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Version-counter collision guard (the 1117/1120 incident).
 *
 * All core migrations share ONE `migrations_version` counter, and the runner
 * only applies migrations with `version > counter`. If a branch merges in a
 * core migration whose version is at or below the highest version already on
 * the target branch, a deployed database whose counter has passed that number
 * SILENTLY SKIPS it — and prod then refuses to boot at the drift gate.
 *
 * So: every NEWLY ADDED core migration must be numbered strictly above the
 * max version already present, and new versions must not collide with each
 * other. Exits the process on failure.
 */
function checkCoreVersionCollisions(base: string | undefined): void {
  const added = addedFiles(base);
  const newCore = added
    .map(f => ({ file: f, version: coreVersionOf(f) }))
    .filter((x): x is { file: string; version: number } => x.version !== null);
  if (newCore.length === 0) return;

  // Existing = every core migration in the current tree that is NOT new,
  // UNION every core migration on the base ref. The base-tree side matters in
  // the divergent-branch case: the target branch may have gained a HIGHER
  // version (e.g. 1121) that this branch's tree does not contain — a new
  // migration here numbered at or below it would be silently skipped after
  // merge, so the floor must account for both trees.
  const newSet = new Set(newCore.map(x => x.file));
  let allCore: string[] = [];
  try {
    allCore = execSync("git ls-files scripts/migrate/core", { encoding: "utf8" })
      .split("\n").map(s => s.trim()).filter(Boolean);
  } catch {
    // ignore
  }
  let baseCore: string[] = [];
  if (base) {
    try {
      baseCore = execSync(`git ls-tree -r --name-only ${base} scripts/migrate/core`, { encoding: "utf8" })
        .split("\n").map(s => s.trim()).filter(Boolean);
    } catch {
      // base unreachable — fall back to current-tree accounting only
    }
  }
  const existingVersions = [
    ...allCore.filter(f => !newSet.has(f)),
    ...baseCore,
  ]
    .map(coreVersionOf)
    .filter((v): v is number => v !== null);
  const maxExisting = existingVersions.length > 0 ? Math.max(...existingVersions) : 0;

  const problems: string[] = [];
  const seenNew = new Map<number, string>();
  for (const { file, version } of newCore) {
    if (version <= maxExisting) {
      problems.push(
        `  - ${file}: version ${version} is <= the max existing core migration version (${maxExisting}).`,
      );
    }
    const dup = seenNew.get(version);
    if (dup) {
      problems.push(`  - ${file}: duplicates version ${version} also used by new file ${dup}.`);
    } else {
      seenNew.set(version, file);
    }
  }

  if (problems.length > 0) {
    console.error(
      [
        "",
        "[check-migrations] FAILED — core migration version-counter collision.",
        "",
        ...problems,
        "",
        "Why this matters: all core migrations share the single `migrations_version`",
        "counter, and the runner only applies versions ABOVE it. On any database whose",
        "counter has already passed your migration's number (e.g. because another",
        "branch merged first), your migration is treated as already-applied and",
        "SILENTLY SKIPPED — prod then fails to boot at the schema drift gate.",
        "(This is exactly the 1117/1120 incident.)",
        "",
        `Fix: renumber the new migration(s) strictly above ${maxExisting} (and above each`,
        "other), update the filename, the `version:` field inside the file, and the",
        "import in scripts/migrate/index.ts, then re-run this check.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(
    `[check-migrations] core migration versions OK — ${newCore.length} new file(s), all above max existing version ${maxExisting}`,
  );
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
  // The version-collision guard runs even with --skip / [skip-migration-check]:
  // those escape hatches cover pure type refactors, not a mis-numbered
  // migration that would be silently skipped on deployed databases.
  checkCoreVersionCollisions(arg("base"));

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
