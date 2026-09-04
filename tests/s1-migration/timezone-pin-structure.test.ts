/**
 * Structural guarantees of the migration time zone pin — what the gate
 * cannot prove at run time because it is about which code paths exist:
 *
 *   1. every entrypoint that WRITES migrated timestamps passes through the
 *      gate (ensureStagingSchema or assertMigrationTimeZone) — a new loader
 *      that skips it fails here, not in a rehearsal;
 *   2. the staged per-USER zone is never read by a loader or a resolver —
 *      user zones are display preferences and must not influence the ETL or
 *      any fund-calendar computation;
 *   3. the migration container image bakes the pin in;
 *   4. the pinned zone name is written once (lib/timezone-pin.ts) — no
 *      loader carries its own copy that could drift.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATION_SYSTEM_TIME_ZONE } from "../../scripts/s1-migration/lib/timezone-pin";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "scripts/s1-migration");
const read = (rel: string) => fs.readFileSync(path.join(MIG, rel), "utf8");
const topLevel = () => fs.readdirSync(MIG).filter((f) => f.endsWith(".ts"));
const libFiles = () => fs.readdirSync(path.join(MIG, "lib")).filter((f) => f.endsWith(".ts")).map((f) => `lib/${f}`);

/**
 * Entrypoints that never write migrated (S1-derived) timestamps: fund config
 * copies/seeds keyed by natural ids, component enables, the write-fence
 * preflight, the pure config module. Adding a name here is a claim that the
 * script writes no S1-derived instant — say why in the commit.
 */
const NO_S1_TIMESTAMPS = new Set([
  "cleanup-contact-type-options.ts",
  "copy-fund-config.ts",
  "enable-production-components.ts",
  "lockout-bootstrap-crons.ts",
  "preflight-write-fence.ts",
  "seed-bao-production-baseline.ts",
  "seed-employment-statuses.ts",
  "seed-migration-policies.ts",
  "seed-policy-benefits.ts",
  "seed-trust-config.ts",
  "sync-config.ts",
]);

describe("1. every writing entrypoint runs the gate", () => {
  it("stage, loaders, verifiers, sync and bootstrap all call ensureStagingSchema() or assertMigrationTimeZone()", () => {
    const missing = topLevel()
      .filter((f) => !NO_S1_TIMESTAMPS.has(f))
      .filter((f) => !/\b(ensureStagingSchema|assertMigrationTimeZone)\(/.test(read(f)));
    expect(missing).toEqual([]);
  });

  it("ensureStagingSchema itself gates before its first statement", () => {
    const src = read("lib/staging.ts");
    const body = src.slice(src.indexOf("export async function ensureStagingSchema"));
    expect(body.indexOf("await assertMigrationTimeZone()")).toBeLessThan(body.indexOf("CREATE SCHEMA"));
  });

  it("the orchestrator refuses a loader envelope without time zone evidence", () => {
    const src = read("sync.ts");
    expect(src).toContain("runtime.timeZone evidence missing");
    expect(src).toContain("MIGRATION_SYSTEM_TIME_ZONE");
  });
});

describe("2. user time zones are isolated from the ETL", () => {
  // The only files allowed to mention the staged users.timezone column: the
  // stager (extracts + counts it), the staging schema (stores it) and the
  // contract itself (documents why nobody else may).
  const ALLOWED = new Set(["stage.ts", "lib/staging.ts", "lib/timezone-contract.ts"]);

  it("no loader, resolver or verifier reads a per-user timezone", () => {
    const offenders = [...topLevel(), ...libFiles()]
      .filter((f) => !ALLOWED.has(f))
      // lowercase `timezone` = the S1 column / staged property (camelCase
      // `timeZone` is the SYSTEM-zone evidence; hyphenated names are modules).
      .filter((f) => /(?<![\w/-])timezone(?![\w-])/.test(read(f).replace(/^\s*(\/\/|\*|\/\*\*?).*$/gm, "")));
    expect(offenders).toEqual([]);
  });

  it("load-users does not carry the S1 zone onto the S2 user (no display-zone migration)", () => {
    expect(read("load-users.ts")).not.toMatch(/timezone/i);
  });

  it("nothing in the pipeline consults the S2 user-zone policy or display-zone helpers", () => {
    const offenders = [...topLevel(), ...libFiles()].filter((f) =>
      /resolveEffectiveTimeZone|allowUserTimezones|display-timezone|getBrowserTimeZone/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });
});

describe("3. the migration image bakes the pin in", () => {
  it("Dockerfile migration target sets ENV TZ to the pinned zone", () => {
    const docker = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
    const target = docker.slice(docker.indexOf("FROM deps AS migration"), docker.indexOf("# Stage 4"));
    expect(target).toContain(`ENV TZ=${MIGRATION_SYSTEM_TIME_ZONE}`);
  });
});

describe("4. one source for the zone name; no host-zone parsing of S1 strings", () => {
  it("the literal zone name appears only in the pin leaf (plus prose)", () => {
    const codeOnly = (src: string) => src.replace(/^\s*(\/\/|\*|\/\*\*?).*$/gm, "");
    const offenders = [...topLevel(), ...libFiles()]
      .filter((f) => f !== "lib/timezone-pin.ts")
      .filter((f) => codeOnly(read(f)).includes(`"${MIGRATION_SYSTEM_TIME_ZONE}"`));
    expect(offenders).toEqual([]);
  });

  it("no loader hands a staged S1 string to new Date()/Date.parse() (host-zone interpretation)", () => {
    // Heuristic on purpose: catches `new Date(strOf(...))`, `new Date(f.field_...)`,
    // `Date.parse(raw...)`. Instants built from epochs (`* 1000`) or explicit
    // UTC strings (`...Z\``) are the sanctioned forms.
    const bad = /\b(?:new Date|Date\.parse)\(\s*(?:strOf\(|String\(|raw\.|f\.field_|fields\.field_|r\.field_)/;
    const offenders = topLevel().filter((f) => f.startsWith("load-") && bad.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
