#!/usr/bin/env tsx
/**
 * CI check: every DB consumer resolves the SAME effective connection string
 * when EXTERNAL_DATABASE_URL is set (split-brain guard, Task #169).
 *
 * Task #168 made EXTERNAL_DATABASE_URL authoritative for every DB consumer
 * (runtime pool, logger, drizzle-kit, db-push). A future regression where one
 * consumer silently falls back to DATABASE_URL while others honour
 * EXTERNAL_DATABASE_URL would mean the app runs against one database while
 * schema tooling diffs/mutates another. This script fails fast on any
 * divergence, in three layers:
 *
 *   1. UNIT — the shared resolver (shared/database-url.ts) precedence rules:
 *      EXTERNAL_DATABASE_URL wins, DATABASE_URL is the fallback, neither set
 *      throws.
 *
 *   2. STATIC SWEEP — no file outside a small allowlist may read
 *      process.env.EXTERNAL_DATABASE_URL / process.env.DATABASE_URL directly.
 *      Every consumer must go through the shared resolver, so a new consumer
 *      that hand-rolls its own (possibly wrong) resolution fails CI.
 *
 *   3. BANNERS — run the real entry points (drizzle.config.ts import,
 *      scripts/db-push.ts, server/storage/db.ts import) in subprocesses with
 *      BOTH env vars set to different fake databases, and assert every
 *      printed "Target database:" banner names the EXTERNAL host with
 *      "(from EXTERNAL_DATABASE_URL)". Also asserts the DATABASE_URL
 *      fallback banner when EXTERNAL is unset.
 *
 * Usage: npx tsx scripts/dev/check-db-url-resolution.ts
 * Exits 0 on pass, 1 on failure.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  resolveDatabaseUrl,
  resolveDatabaseUrlOptional,
  describeDatabaseTarget,
} from "../../shared/database-url";

const ROOT = process.cwd();
let failures = 0;

function check(ok: boolean, msg: string, detail?: string) {
  if (ok) {
    console.log(`  ok   ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL ${msg}${detail ? `\n       ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Resolver unit checks (injected env; process.env untouched).
// ---------------------------------------------------------------------------
console.log("[1/3] Resolver precedence");
{
  const both = resolveDatabaseUrl({
    EXTERNAL_DATABASE_URL: "postgresql://u:p@external.example.com:5432/extdb",
    DATABASE_URL: "postgresql://u:p@internal.example.com:5432/intdb",
  });
  check(
    both.url.includes("external.example.com") && both.source === "EXTERNAL_DATABASE_URL",
    "EXTERNAL_DATABASE_URL wins when both are set",
  );
  check(
    describeDatabaseTarget(both) === "external.example.com/extdb (from EXTERNAL_DATABASE_URL)",
    "banner format for EXTERNAL_DATABASE_URL",
    `got: ${describeDatabaseTarget(both)}`,
  );

  const fallback = resolveDatabaseUrl({
    DATABASE_URL: "postgresql://u:p@internal.example.com:5432/intdb",
  });
  check(
    fallback.url.includes("internal.example.com") && fallback.source === "DATABASE_URL",
    "DATABASE_URL is the fallback when EXTERNAL is unset",
  );

  // Empty string must not count as "set" (matches historical || semantics).
  const emptyExternal = resolveDatabaseUrl({
    EXTERNAL_DATABASE_URL: "",
    DATABASE_URL: "postgresql://u:p@internal.example.com:5432/intdb",
  });
  check(
    emptyExternal.source === "DATABASE_URL",
    "empty EXTERNAL_DATABASE_URL falls back to DATABASE_URL",
  );

  check(resolveDatabaseUrlOptional({}) === undefined, "optional resolver returns undefined when neither set");
  let threw = false;
  try {
    resolveDatabaseUrl({});
  } catch {
    threw = true;
  }
  check(threw, "strict resolver throws when neither set");
}

// ---------------------------------------------------------------------------
// 2. Static sweep: direct env reads only in the allowlist.
// ---------------------------------------------------------------------------
console.log("[2/3] Static sweep for direct env reads");
{
  // Files that legitimately touch the raw env vars:
  const ALLOWLIST = new Set([
    "shared/database-url.ts", // the resolver itself
    "server/config/assemble-database-url.ts", // assembles/sets DATABASE_URL pre-boot
    "scripts/dev/check-db-url-resolution.ts", // this script (subprocess env setup)
  ]);
  const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "attached_assets",
    ".local",
    ".agents",
    ".cache",
  ]);
  const pattern = /process\.env\.(EXTERNAL_DATABASE_URL|DATABASE_URL)\b/;

  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = relative(ROOT, full);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(entry) && !entry.startsWith(".")) walk(full);
      } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry) && !ALLOWLIST.has(rel)) {
        const content = readFileSync(full, "utf8");
        content.split("\n").forEach((line, i) => {
          // Ignore comment-only mentions.
          const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
          if (pattern.test(code)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
      }
    }
  };
  walk(ROOT);
  check(
    offenders.length === 0,
    "no direct process.env.(EXTERNAL_)DATABASE_URL reads outside the allowlist",
    offenders.length
      ? `Use resolveDatabaseUrl() from shared/database-url.ts instead:\n       ${offenders.join("\n       ")}`
      : undefined,
  );
}

// ---------------------------------------------------------------------------
// 3. Banner checks: run the real consumers in subprocesses.
// ---------------------------------------------------------------------------
console.log("[3/3] Consumer target banners (subprocesses)");

const EXTERNAL_FAKE = "postgresql://u:p@external.example.com:5432/extdb?sslmode=disable";
const INTERNAL_FAKE = "postgresql://u:p@internal.example.com:5432/intdb?sslmode=disable";
const EXPECT_EXTERNAL = "external.example.com/extdb (from EXTERNAL_DATABASE_URL)";
const EXPECT_INTERNAL = "internal.example.com/intdb (from DATABASE_URL)";

interface BannerCase {
  name: string;
  /** tsx source evaluated with -e, or argv for a script file */
  args: string[];
  banner: string; // prefix, e.g. "[drizzle]"
}

function runBanner(
  name: string,
  args: string[],
  env: Record<string, string | undefined>,
  bannerPrefix: string,
  expected: string,
) {
  const res = spawnSync("npx", ["tsx", ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: undefined,
      EXTERNAL_DATABASE_URL: undefined,
      ...env,
    } as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 120_000,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const bannerLine = out
    .split("\n")
    .find((l) => l.includes(`${bannerPrefix} Target database:`));
  check(
    bannerLine !== undefined && bannerLine.includes(expected),
    `${name} banner targets ${expected}`,
    bannerLine ? `got: ${bannerLine.trim()}` : `no "${bannerPrefix} Target database:" line in output:\n${out.slice(0, 2000)}`,
  );
}

const bothEnv = { EXTERNAL_DATABASE_URL: EXTERNAL_FAKE, DATABASE_URL: INTERNAL_FAKE };
const fallbackEnv = { DATABASE_URL: INTERNAL_FAKE };

// drizzle.config.ts — importing it prints the banner.
runBanner("drizzle.config.ts (both set)", ["-e", 'import("./drizzle.config.ts")'], bothEnv, "[drizzle]", EXPECT_EXTERNAL);
runBanner("drizzle.config.ts (fallback)", ["-e", 'import("./drizzle.config.ts")'], fallbackEnv, "[drizzle]", EXPECT_INTERNAL);

// server/storage/db.ts — importing it prints the banner (pool construction
// does not connect, so a fake host is safe).
runBanner("server/storage/db.ts (both set)", ["-e", 'import("./server/storage/db.ts")'], bothEnv, "[db]", EXPECT_EXTERNAL);
runBanner("server/storage/db.ts (fallback)", ["-e", 'import("./server/storage/db.ts")'], fallbackEnv, "[db]", EXPECT_INTERNAL);

// scripts/db-push.ts — banner prints before any DB query; the run then fails
// against the fake host, which is fine (we only assert the banner).
runBanner(
  "scripts/db-push.ts (both set)",
  ["scripts/db-push.ts", "--dry-run"],
  { ...bothEnv, ALLOW_DB_PUSH: "1" },
  "[db:push]",
  EXPECT_EXTERNAL,
);

console.log("");
if (failures > 0) {
  console.error(`check-db-url-resolution: ${failures} failure(s).`);
  process.exit(1);
}
console.log("check-db-url-resolution: all checks passed.");
