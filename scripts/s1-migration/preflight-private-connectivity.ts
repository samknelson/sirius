/**
 * No-write production launch-path proof for the S1 migration task.
 *
 * Uses the unchanged task-definition secrets, resolves both database hosts,
 * and runs read-only session probes. Output is deliberately sanitized: no
 * hostnames, addresses, credentials, database names, or source rows.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import mysql from "mysql2/promise";
import {
  resolveDatabaseUrl,
  rewriteNeonPoolerUrl,
} from "../../shared/database-url";
import { getEnvironmentVariable } from "./lib/script-env";

type ResolutionEvidence = {
  addressCount: number;
  families: number[];
  allPrivate: boolean;
};

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10
      || a === 127
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254);
  }
  const normalized = address.toLowerCase();
  return normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb");
}

async function resolvePrivately(urlString: string): Promise<ResolutionEvidence> {
  const hostname = new URL(urlString).hostname;
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("DNS returned no addresses");
  return {
    addressCount: addresses.length,
    families: [...new Set(addresses.map(({ family }) => family))].sort(),
    allPrivate: addresses.every(({ address }) => isPrivateAddress(address)),
  };
}

function printResolution(label: string, evidence: ResolutionEvidence): void {
  console.log(
    `[private-connectivity] ${label} dns: addresses=${evidence.addressCount} `
      + `families=${evidence.families.join(",")} allPrivate=${evidence.allPrivate}`,
  );
  if (!evidence.allPrivate) {
    throw new Error(`${label} did not resolve exclusively to private addresses`);
  }
}

async function connectToS2Silently() {
  // db.ts prints its credential-free target identity both at import and first
  // connection. Those banners are useful normally but are outside this
  // preflight's stricter evidence contract, so suppress informational output
  // only while the application pool initializes and connects.
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => undefined;
  console.warn = () => undefined;
  try {
    const { pool } = await import("../../server/storage/db");
    const client = await pool.connect();
    return { pool, client };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

async function main(): Promise<void> {
  const s1Url = getEnvironmentVariable("S1_DATABASE_URL");
  if (!s1Url) throw new Error("S1_DATABASE_URL is not set");
  const s2Url = rewriteNeonPoolerUrl(resolveDatabaseUrl().url);

  printResolution("S1", await resolvePrivately(s1Url));
  printResolution("S2", await resolvePrivately(s2Url));

  const s1 = await mysql.createConnection(s1Url);
  try {
    await s1.query("SET SESSION TRANSACTION READ ONLY");
    await s1.query("SELECT 1");
    console.log("[private-connectivity] S1 database: reachable readOnlySession=true");
  } finally {
    await s1.end();
  }

  // The application pool proves the exact driver, pooler rewrite, TLS, and
  // PrivateLink path used by the unchanged loader fleet.
  const { pool: pgPool, client } = await connectToS2Silently();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT 1");
    await client.query("ROLLBACK");
    console.log("[private-connectivity] S2 database: reachable readOnlyTransaction=true");
  } finally {
    client.release(true);
    await pgPool.end();
  }

  console.log("[private-connectivity] PASS");
}

main().catch((error) => {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const name = typeof record.name === "string" ? record.name : "Error";
  const code = typeof record.code === "string" ? record.code : "unspecified";
  console.error(`[private-connectivity] FAIL: class=${name} code=${code}`);
  process.exitCode = 1;
});