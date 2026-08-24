#!/usr/bin/env npx tsx
/**
 * Author-time enforcement that package-lock.json resolves every tarball from
 * the public npm registry.
 *
 * Any `npm install` run inside this Replit workspace goes through Replit's
 * internal npm proxy (package-firewall.replit.local) and rewrites the
 * `resolved` URLs of the packages it touches to point at that proxy. The host
 * only exists inside Replit, so GitHub Actions runners and the Docker build
 * die on `npm ci` with `EAI_AGAIN package-firewall.replit.local`. Versions and
 * integrity hashes are unaffected — only the URL host is wrong — so the repair
 * is a pure host rewrite.
 *
 * Run manually:
 *
 *   npx tsx scripts/dev/check-lockfile-registry.ts
 *
 * Exits 0 on pass, 1 on violations.
 */
import { readFileSync } from "node:fs";

/** The only host a resolved tarball URL may point at. */
const PUBLIC_REGISTRY_HOST = "registry.npmjs.org";

const LOCKFILE = "package-lock.json";

/** The one-line repair for the known Replit-proxy poisoning. */
const FIX_COMMAND =
  "sed -i 's#https\\?://package-firewall\\.replit\\.local/npm/#https://registry.npmjs.org/#g' package-lock.json";

interface Violation {
  /** The lockfile's package path, e.g. "node_modules/vite". */
  pkg: string;
  host: string;
  url: string;
}

interface LockfileEntry {
  resolved?: unknown;
}

interface Lockfile {
  packages?: Record<string, LockfileEntry>;
  dependencies?: Record<string, LockfileEntry>;
}

/**
 * Collects every http(s) `resolved` URL that does not point at the public
 * registry. Non-HTTP resolutions (git+ssh:, file:, link:) are out of scope —
 * they are deliberate, not proxy poisoning.
 */
export function findViolations(lock: Lockfile): Violation[] {
  const violations: Violation[] = [];

  const visit = (entries: Record<string, LockfileEntry> | undefined): void => {
    if (!entries) return;
    for (const [pkg, entry] of Object.entries(entries)) {
      const resolved = entry?.resolved;
      if (typeof resolved !== "string") continue;
      if (!/^https?:\/\//i.test(resolved)) continue;

      let host: string;
      try {
        host = new URL(resolved).host;
      } catch {
        violations.push({ pkg, host: "(unparseable)", url: resolved });
        continue;
      }
      if (host !== PUBLIC_REGISTRY_HOST) {
        violations.push({ pkg, host, url: resolved });
      }
    }
  };

  // lockfileVersion 2/3 use `packages`; `dependencies` is the v1 shape kept
  // for compatibility in v2 lockfiles.
  visit(lock.packages);
  visit(lock.dependencies);
  return violations;
}

function main(): void {
  let lock: Lockfile;
  try {
    lock = JSON.parse(readFileSync(LOCKFILE, "utf8")) as Lockfile;
  } catch (err) {
    console.error(
      `[check-lockfile-registry] FAILED — could not read/parse ${LOCKFILE}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  const violations = findViolations(lock);
  const scanned =
    Object.keys(lock.packages ?? {}).length +
    Object.keys(lock.dependencies ?? {}).length;

  if (violations.length === 0) {
    console.log(
      `[check-lockfile-registry] OK — every resolved tarball URL points at ` +
        `${PUBLIC_REGISTRY_HOST} (${scanned} lockfile entries scanned).`,
    );
    process.exit(0);
  }

  const hosts = Array.from(new Set(violations.map((v) => v.host)));

  console.error(
    [
      "",
      `[check-lockfile-registry] FAILED — ${violations.length} resolved URL(s) in ` +
        `${LOCKFILE} do not point at ${PUBLIC_REGISTRY_HOST}.`,
      "",
      "Cause: an `npm install` was run inside this Replit workspace. Installs here",
      "go through Replit's internal npm proxy, which rewrites the `resolved` URLs of",
      "the packages it touches. That host does not resolve outside Replit, so CI and",
      "the Docker build fail at `npm ci` with EAI_AGAIN. Versions and integrity",
      "hashes are unaffected — only the URL host is wrong.",
      "",
      `Offending host(s): ${hosts.join(", ")}`,
      "",
      "Offending packages:",
      ...violations.map((v) => `  ${v.pkg}  ${v.url}`),
      "",
      "Fix (rewrites the host only, leaves versions and integrity hashes alone):",
      "",
      `  ${FIX_COMMAND}`,
      "",
      "Then re-run this check. If the host above is not the Replit proxy, do not",
      "blind-rewrite it — work out where it came from first.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Only run when executed directly (tests may import findViolations).
if (process.argv[1] && /check-lockfile-registry\.ts$/.test(process.argv[1])) {
  main();
}
