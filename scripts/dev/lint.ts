#!/usr/bin/env npx tsx
/**
 * The architecture-lint suite — the single entry point for every repo-wide
 * architecture rule.
 *
 * These rules are cheap, need no database, and enforce project-wide
 * invariants that hold across the whole codebase (see the "Non-Negotiable
 * Rules" section of replit.md). They are registered as ONE validation, so a
 * new rule is added to the RULES table below rather than to `.replit`.
 *
 * Every rule runs, even after one fails, so a single run reports every
 * violation instead of stopping at the first. Each rule keeps its own
 * scanning logic and its own actionable message; this file only sequences
 * them and summarizes.
 *
 * Usage:
 *
 *   npx tsx scripts/dev/lint.ts              # every rule
 *   npx tsx scripts/dev/lint.ts env-registry # one rule (or several)
 *   npx tsx scripts/dev/lint.ts --list       # show the rule ids
 *
 * Exits 0 when every selected rule passes, 1 otherwise.
 *
 * NOT for behavioral tests. Those belong in a Vitest suite under `tests/`
 * (`npm test`).
 */
import { spawnSync } from "node:child_process";

interface Rule {
  /** Stable id used to select the rule on the command line. */
  id: string;
  /** The rule script, run as its own process. */
  script: string;
  /** One line, shown in the summary and by --list. */
  summary: string;
}

const RULES: Rule[] = [
  {
    id: "env-registry",
    script: "scripts/dev/check-env-registry.ts",
    summary: "every environment variable is read through the registry",
  },
  {
    id: "storage-encapsulation",
    script: "scripts/dev/check-storage-encapsulation.ts",
    summary: "all database access goes through the storage layer",
  },
  {
    id: "denorm-declarations",
    script: "scripts/dev/check-denorm-declarations.ts",
    summary: "denorm plugins declare the storage they read and write",
  },
  {
    id: "html-utils",
    script: "scripts/dev/check-html-utils.ts",
    summary: "HTML escaping/sanitizing lives in the one shared library",
  },
  {
    id: "constraint-names",
    script: "scripts/dev/check-constraint-names.ts",
    summary: "no generated constraint name exceeds Postgres's 63-char limit",
  },
  {
    id: "component-table-order",
    script: "scripts/dev/check-component-table-order.ts",
    summary: "component manifest tables sort into a valid FK creation order",
  },
  {
    id: "core-migration-component-tables",
    script: "scripts/dev/check-core-migration-component-tables.ts",
    summary: "core migrations guard every component-owned table they touch",
  },
  {
    id: "lockfile-registry",
    script: "scripts/dev/check-lockfile-registry.ts",
    summary: "lockfile tarball URLs point at the public npm registry",
  },
  {
    id: "main-branch-files",
    script: "scripts/dev/check-main-branch-files.ts",
    summary: "deployment config is tracked on carrying branches, never on main",
  },
  {
    id: "carrying-branch-drift",
    script: "scripts/dev/check-carrying-branch-drift.ts",
    summary: "carrying branches hold no application work that is missing from main",
  },
  {
    id: "maintenance-guards",
    script: "scripts/dev/check-maintenance-guards.ts",
    summary: "outbound vendor calls are refused during maintenance mode",
  },
  {
    id: "theme-color-vars",
    script: "scripts/dev/check-theme-color-vars.ts",
    summary: "theme colour variables are named as-is, never wrapped in hsl()",
  },
  {
    id: "date-formatting",
    script: "scripts/dev/check-date-formatting.ts",
    summary: "browser code formats dates through the zone-aware wrapper",
  },
  {
    id: "browser-timezone",
    script: "scripts/dev/check-browser-timezone.ts",
    summary: "only the resolver plumbing asks what zone the browser is in",
  },
];

function usage(): void {
  console.log("Architecture lint rules:\n");
  for (const rule of RULES) {
    console.log(`  ${rule.id.padEnd(24)} ${rule.summary}`);
  }
  console.log("\nRun all:      npx tsx scripts/dev/lint.ts");
  console.log("Run one:      npx tsx scripts/dev/lint.ts <rule-id> [<rule-id> …]");
}

function selectRules(args: string[]): Rule[] {
  if (args.length === 0) return RULES;

  const selected: Rule[] = [];
  for (const arg of args) {
    const rule = RULES.find((r) => r.id === arg);
    if (!rule) {
      console.error(
        `[lint] unknown rule "${arg}". Known rules: ${RULES.map((r) => r.id).join(", ")}`,
      );
      process.exit(2);
    }
    selected.push(rule);
  }
  return selected;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--list") || args.includes("-l")) {
    usage();
    process.exit(0);
  }

  const rules = selectRules(args);
  const failed: Rule[] = [];

  for (const rule of rules) {
    console.log(`\n──────── ${rule.id} — ${rule.summary}`);
    // A separate process per rule: each rule script calls process.exit(), and
    // one failing rule must not stop the rules after it from running.
    const result = spawnSync("npx", ["tsx", rule.script], {
      stdio: "inherit",
      encoding: "utf8",
    });

    if (result.error) {
      console.error(`[lint] could not run ${rule.script}: ${result.error.message}`);
      failed.push(rule);
      continue;
    }
    if (result.status !== 0) failed.push(rule);
  }

  console.log("\n════════ architecture lint summary");
  for (const rule of rules) {
    const ok = !failed.includes(rule);
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${rule.id}`);
  }

  if (failed.length === 0) {
    console.log(`\n[lint] OK — ${rules.length} rule(s) passed.\n`);
    process.exit(0);
  }

  console.error(
    `\n[lint] FAILED — ${failed.length} of ${rules.length} rule(s): ` +
      `${failed.map((r) => r.id).join(", ")}. ` +
      `Each rule's own output above says how to fix it.\n`,
  );
  process.exit(1);
}

main();
