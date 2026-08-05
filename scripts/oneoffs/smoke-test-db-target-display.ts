#!/usr/bin/env npx tsx
/**
 * Regression test: the System Status "Database Connection" card must derive
 * its reported target from the boot-resolved `databaseSourceInfo` singleton
 * (server/storage/db.ts) — never from a direct process.env read.
 *
 * Historical regression: the card reported the raw Replit-injected
 * DATABASE_URL even when the app was actually connected to the database
 * named by EXTERNAL_DATABASE_URL.
 *
 * The parent process spawns child tsx processes with synthetic env vars
 * (no connection is ever opened — the pools are created lazily) and asserts:
 *
 *   A) EXTERNAL_DATABASE_URL (Neon pooler URL) + a different DATABASE_URL:
 *      - source = EXTERNAL_DATABASE_URL, driver = neon
 *      - host is the pooler-REWRITTEN direct endpoint (poolerRewritten=true,
 *        neonEndpointId derived)
 *      - the DATABASE_URL host appears nowhere
 *      - the Database Connection card's details string is built exactly from
 *        databaseSourceInfo (host, driver, database, source)
 *   B) DATABASE_URL only (plain Postgres):
 *      - source = DATABASE_URL, driver = pg, poolerRewritten = false,
 *        neonEndpointId = null
 *
 * Run: npx tsx scripts/oneoffs/smoke-test-db-target-display.ts
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);

const EXTERNAL_URL =
  "postgresql://user:secretpw@ep-test-target-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const EXTERNAL_DIRECT_HOST = "ep-test-target-123456.us-east-2.aws.neon.tech";
const REPLIT_URL =
  "postgresql://user:otherpw@replit-injected.internal.example.com:5432/replitdb";
const REPLIT_HOST = "replit-injected.internal.example.com";
const PLAIN_URL =
  "postgresql://user:pw@plain-db.example.com:5432/appdb?sslmode=disable";

// ---------------------------------------------------------------------------
// Child modes — print a single JSON line the parent asserts on.
// ---------------------------------------------------------------------------
const mode = process.argv[2];

if (mode === "info") {
  // Print the boot-resolved databaseSourceInfo.
  const { databaseSourceInfo } = await import("../../server/storage/db");
  console.log("RESULT:" + JSON.stringify(databaseSourceInfo));
  process.exit(0);
}

if (mode === "card") {
  // Exercise the actual Database Connection status plugin: import the app's
  // module graph the way the app boots (storage first — see
  // smoke-test-election.ts), stub the read-only query so no connection is
  // opened, and capture the card's details string.
  const { storage } = await import("../../server/storage/database");
  (storage as any).readOnly = {
    query: async (fn: any) =>
      fn({ execute: async () => ({ rows: [{ "?column?": 1 }] }) }),
  };
  const { databaseSourceInfo } = await import("../../server/storage/db");
  const { systemStatusPluginRegistry } = await import(
    "../../server/plugins/system/status/registry"
  );
  await import(
    "../../server/plugins/system/status/plugins/database-connection"
  );
  const plugin = systemStatusPluginRegistry.get("database.connection");
  if (!plugin) {
    console.log("RESULT:" + JSON.stringify({ error: "plugin not registered" }));
    process.exit(0);
  }
  const messages = await plugin.scan();
  console.log(
    "RESULT:" +
      JSON.stringify({ info: databaseSourceInfo, messages }),
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Parent: spawn children with synthetic env and assert.
// ---------------------------------------------------------------------------
let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}`, detail !== undefined ? detail : "");
  }
}

function runChild(childMode: string, envOverrides: Record<string, string | undefined>): any {
  const env: Record<string, string | undefined> = { ...process.env };
  // Never inherit real DB targeting from the workspace env.
  delete env.EXTERNAL_DATABASE_URL;
  delete env.DATABASE_URL;
  delete env.DATABASE_DRIVER;
  Object.assign(env, envOverrides);
  const res = spawnSync("npx", ["tsx", SELF, childMode], {
    env: env as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 120_000,
  });
  const line = (res.stdout || "")
    .split("\n")
    .find((l) => l.startsWith("RESULT:"));
  if (!line) {
    throw new Error(
      `child (${childMode}) produced no RESULT line.\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
    );
  }
  return { parsed: JSON.parse(line.slice("RESULT:".length)), stdout: res.stdout };
}

console.log("Scenario A: EXTERNAL_DATABASE_URL (Neon pooler) wins over DATABASE_URL");
{
  const { parsed: info, stdout } = runChild("info", {
    EXTERNAL_DATABASE_URL: EXTERNAL_URL,
    DATABASE_URL: REPLIT_URL,
  });
  check("source is EXTERNAL_DATABASE_URL", info.source === "EXTERNAL_DATABASE_URL", info);
  check("driver is neon", info.driver === "neon", info);
  check(
    "host is the pooler-rewritten direct endpoint",
    info.host === EXTERNAL_DIRECT_HOST,
    info.host,
  );
  check("database parsed from EXTERNAL url", info.database === "neondb", info.database);
  check("poolerRewritten flag set", info.poolerRewritten === true, info);
  check(
    "neonEndpointId derived from direct host",
    info.neonEndpointId === "ep-test-target-123456",
    info.neonEndpointId,
  );
  check(
    "raw DATABASE_URL host leaks nowhere in databaseSourceInfo",
    !JSON.stringify(info).includes(REPLIT_HOST),
    info,
  );
  check(
    "no credentials in databaseSourceInfo or banner output",
    !JSON.stringify(info).includes("secretpw") && !stdout.includes("secretpw"),
  );
}

console.log("Scenario B: DATABASE_URL fallback (plain Postgres, no rewrite)");
{
  const { parsed: info } = runChild("info", { DATABASE_URL: PLAIN_URL });
  check("source is DATABASE_URL", info.source === "DATABASE_URL", info);
  check("driver is pg", info.driver === "pg", info);
  check("host parsed", info.host === "plain-db.example.com", info.host);
  check("database parsed", info.database === "appdb", info.database);
  check("poolerRewritten is false", info.poolerRewritten === false, info);
  check("neonEndpointId is null", info.neonEndpointId === null, info);
}

console.log("Scenario C: Database Connection card derives from databaseSourceInfo");
{
  const { parsed } = runChild("card", {
    EXTERNAL_DATABASE_URL: EXTERNAL_URL,
    DATABASE_URL: REPLIT_URL,
  });
  check("plugin registered and scanned", !parsed.error && Array.isArray(parsed.messages), parsed);
  if (!parsed.error) {
    const info = parsed.info;
    const msg = parsed.messages[0] ?? {};
    const expectedDetails = `driver=${info.driver}, host=${info.host}, database=${info.database} (from ${info.source})`;
    check("card reports Connected", msg.title === "Connected", msg);
    check(
      "card details built exactly from boot-resolved databaseSourceInfo",
      msg.details === expectedDetails,
      { details: msg.details, expectedDetails },
    );
    check(
      "card names the resolved EXTERNAL target host (post pooler-rewrite)",
      typeof msg.details === "string" && msg.details.includes(EXTERNAL_DIRECT_HOST),
      msg.details,
    );
    check(
      "card does NOT report the raw Replit-injected DATABASE_URL host",
      typeof msg.details === "string" && !msg.details.includes(REPLIT_HOST),
      msg.details,
    );
    check(
      "card details are credential-free",
      typeof msg.details === "string" && !msg.details.includes("secretpw"),
      msg.details,
    );
  }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
