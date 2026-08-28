#!/usr/bin/env npx tsx
/**
 * Author-time enforcement for the environment-variable registry (Task #1053).
 *
 * Fails when `process.env` appears anywhere in server/, shared/, or scripts/
 * outside the registry module itself. All environment access must go through
 * `getEnvironmentVariable()` (server/config/env-registry.ts) so that every
 * variable the application uses is declared with metadata and the env
 * contract cannot silently erode.
 *
 * Like scripts/check-migrations.ts, this scans the CURRENT working tree —
 * tracked AND untracked files — so a brand-new file cannot dodge the check
 * before its first commit.
 *
 * Run manually (or wire into CI):
 *
 *   npx tsx scripts/dev/check-env-registry.ts
 *
 * Client code (client/) is intentionally out of scope: it uses
 * `import.meta.env.VITE_*`, which Vite substitutes at compile time.
 *
 * Exits 0 on pass, 1 on violations.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** The one module allowed to touch process.env directly. */
const REGISTRY_MODULE = "server/config/env-registry.ts";

/**
 * Narrow, documented exemptions. Add entries ONLY with a justification —
 * every exemption is a hole in the environment contract.
 */
const EXEMPT_FILES = new Set<string>([
  // CommonJS git hook helper: cannot import the TypeScript registry, and its
  // only use is the sanctioned whole-environment passthrough to a spawned
  // child process (no individual variable reads).
  "scripts/post-merge-db-push.cjs",
  // This check script itself: needs the literal pattern to search for.
  "scripts/dev/check-env-registry.ts",
  // The ONE sanctioned resolver for (EXTERNAL_)DATABASE_URL. It lives in
  // shared/ (imported by drizzle.config.ts and client-adjacent tooling) so it
  // cannot import the server-side registry; its env parameter defaults to the
  // real process environment. Its exclusivity is separately enforced by
  // scripts/dev/check-db-url-resolution.ts.
  "shared/database-url.ts",
  // Plain-node .mjs profiler run outside tsx: cannot import the TypeScript
  // registry. Reads only its own S1URL / S1_PROFILE_OUT operator inputs.
  "scripts/oneoffs/s1-profile.mjs",
]);

const SCANNED_PREFIXES = ["server/", "shared/", "scripts/"];
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

function listWorkingTreeFiles(): string[] {
  // Tracked files plus untracked-but-not-ignored files, mirroring the
  // check-migrations approach so pre-commit files are covered.
  const tracked = execSync("git ls-files", { encoding: "utf8" });
  const untracked = execSync("git ls-files --others --exclude-standard", {
    encoding: "utf8",
  });
  return Array.from(
    new Set(
      (tracked + "\n" + untracked)
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

function isScanned(file: string): boolean {
  if (!SCANNED_PREFIXES.some((p) => file.startsWith(p))) return false;
  if (!SCANNED_EXTENSIONS.some((e) => file.endsWith(e))) return false;
  if (file === REGISTRY_MODULE) return false;
  if (EXEMPT_FILES.has(file)) return false;
  return true;
}

interface Violation {
  file: string;
  line: number;
  text: string;
}

export function findViolations(files: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue; // deleted-but-still-listed files
    }
    if (!content.includes("process.env")) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("process.env")) {
        violations.push({ file, line: i + 1, text: lines[i].trim() });
      }
    }
  }
  return violations;
}

function main(): void {
  const files = listWorkingTreeFiles().filter(isScanned);
  const violations = findViolations(files);

  if (violations.length === 0) {
    console.log(
      `[check-env-registry] OK — no process.env usage outside ${REGISTRY_MODULE} (${files.length} files scanned).`,
    );
    process.exit(0);
  }

  console.error(
    [
      "",
      "[check-env-registry] FAILED — direct process.env usage found.",
      "",
      "All environment variable access in server/, shared/, and scripts/ must go",
      "through getEnvironmentVariable() from server/config/env-registry.ts,",
      "with the variable registered (name, description, secret flag, category).",
      "",
      "Violations:",
      ...violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`),
      "",
      "Even mentioning `process.env` in a comment fails this check — reword it.",
      "For sanctioned whole-environment passthrough (child processes), use",
      "getRawProcessEnv(). Genuinely impossible cases may be added to the",
      "EXEMPT_FILES list in scripts/dev/check-env-registry.ts with a comment",
      "justifying the exemption.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Only run when executed directly (the test script imports findViolations).
if (process.argv[1] && /check-env-registry\.ts$/.test(process.argv[1])) {
  main();
}
