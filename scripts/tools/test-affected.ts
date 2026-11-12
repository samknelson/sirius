#!/usr/bin/env npx tsx
/**
 * Run only tests Vitest can reach from changed files. A small, explicit set of
 * repository-wide inputs falls back to the full suite because static imports
 * cannot describe their runtime impact.
 */
import { spawnSync } from "node:child_process";
import { getRawProcessEnv } from "../../server/config/env-registry";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const base = args.find((arg) => arg !== "--dry-run") ?? "origin/main";

const BROAD_IMPACT = [
  /^(package(?:-lock)?\.json|vitest\.config\.ts|vite\.config\.ts|tsconfig(?:\.[^.]+)?\.json)$/,
  /^shared\/schema(?:\/|\.|$)/,
  /^server\/plugins\/_core\//,
  /^server\/app-init\.ts$/,
  /^server\/storage\/database(?:\/|\.|$)/,
  /^server\/storage\/transaction-context(?:\/|\.|$)/,
  /^tests\/(?:setup|helpers)(?:\/|\.|$)/,
];

function gitLines(args: string[]): string[] {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

let changed: string[];
try {
  changed = [
    ...gitLines(["diff", "--name-only", `${base}...HEAD`]),
    ...gitLines(["diff", "--name-only"]),
    ...gitLines(["diff", "--name-only", "--cached"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ];
} catch (error) {
  console.error(`[test:affected] ${error instanceof Error ? error.message : String(error)}`);
  console.error("[test:affected] Refusing to guess. Pass a valid base ref.");
  process.exit(2);
}

changed = [...new Set(changed)].sort();
if (changed.length === 0) {
  console.log(`[test:affected] No changes relative to ${base}; no tests to run.`);
  process.exit(0);
}

const broad = changed.filter((file) => BROAD_IMPACT.some((pattern) => pattern.test(file)));
const vitestArgs = broad.length > 0
  ? ["run"]
  : ["run", "--changed", base];

if (broad.length > 0) {
  console.log("[test:affected] Broad-impact change; running the full suite:");
  for (const file of broad) console.log(`  - ${file}`);
} else {
  console.log(`[test:affected] Running tests affected since ${base} (${changed.length} changed files).`);
}

if (dryRun) {
  console.log(`[test:affected] Dry run: vitest ${vitestArgs.join(" ")}`);
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", ...vitestArgs],
  { stdio: "inherit", env: getRawProcessEnv() },
);
process.exit(result.status ?? 1);