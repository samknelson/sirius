/**
 * Executable integration coverage for the production bootstrap baseline.
 *
 * Creates and drops a throwaway database on the DATABASE_URL host. The shared
 * database and EXTERNAL_DATABASE_URL target are never modified.
 *
 * Usage: npx tsx scripts/oneoffs/s1-production-bootstrap-seed-tests.ts
 *        (optional: --keep-db)
 */
import { readFileSync } from "fs";
import { spawn, spawnSync } from "child_process";
import pg from "pg";
import {
  getEnvironmentVariable,
  getRawProcessEnv,
} from "../../server/config/env-registry";
import { componentRegistry } from "../../shared/components";
import {
  BAO_HOURLY_CONFIG,
  CONTRIBUTION_ACCOUNT_SPECS,
  EMPLOYMENT_STATUS_SPECS,
  FORBIDDEN_PRODUCTION_COMPONENT_IDS,
  POLICY_SIRIUS_IDS,
  PRODUCTION_COMPONENT_IDS,
} from "../s1-migration/lib/production-baseline";
import {
  cronPluginRegistry,
  initializeCronPluginSystem,
} from "../../server/plugins/system/cron";

const KEEP_DB = process.argv.includes("--keep-db");
const baseUrl = getEnvironmentVariable("DATABASE_URL");
if (!baseUrl) {
  console.error("FAIL: DATABASE_URL must point at a development Postgres host with CREATEDB.");
  process.exit(1);
}

const dbName = `s1_prod_seed_test_${Date.now()}`;
const throwawayUrl = (() => {
  const url = new URL(baseUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
})();
const adminClient = () => new pg.Client({ connectionString: baseUrl });
const testClient = () => new pg.Client({ connectionString: throwawayUrl });

const BOOTSTRAP = "scripts/s1-migration/bootstrap-target.ts";
const COMPONENTS = "scripts/s1-migration/enable-production-components.ts";
const CRON_LOCKOUT = "scripts/s1-migration/lockout-bootstrap-crons.ts";
const BAO_BASELINE = "scripts/s1-migration/seed-bao-production-baseline.ts";
const SEED_TRUST = "scripts/s1-migration/seed-trust-config.ts";
const SEED_POLICY_BENEFITS = "scripts/s1-migration/seed-policy-benefits.ts";

interface RunResult {
  status: number | null;
  out: string;
  spawnError: string | null;
}

function run(
  script: string,
  args: string[] = [],
  env: Record<string, string> = {},
): RunResult {
  const result = spawnSync("npx", ["tsx", script, ...args], {
    env: {
      ...getRawProcessEnv(),
      EXTERNAL_DATABASE_URL: throwawayUrl,
      DATABASE_URL: throwawayUrl,
      ...env,
    },
    encoding: "utf8",
    timeout: 15 * 60 * 1000,
  });
  return {
    status: result.status,
    out: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    spawnError: result.error ? String(result.error) : null,
  };
}

async function runBootstrapRace(): Promise<{ first: RunResult; second: RunResult }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", BOOTSTRAP, "--wipe"], {
      env: {
        ...getRawProcessEnv(),
        EXTERNAL_DATABASE_URL: throwawayUrl,
        DATABASE_URL: throwawayUrl,
        S1_BOOTSTRAP_TEST_PAUSE_BEFORE_CHILDREN_MS: "4000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let second: RunResult | null = null;
    let markerSeen = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("timed out waiting for paused bootstrap race"));
    }, 3 * 60 * 1000);
    const onData = (chunk: Buffer | string) => {
      out += String(chunk);
      if (!markerSeen && out.includes("TEST PAUSE: retaining advisory lock")) {
        markerSeen = true;
        second = run(BOOTSTRAP, ["--wipe"]);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      if (!markerSeen || !second) {
        reject(new Error(`first bootstrap exited before race marker (status=${status})\n${out.slice(-1200)}`));
        return;
      }
      resolve({
        first: { status, out, spawnError: null },
        second,
      });
    });
  });
}

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function rows<T = Record<string, unknown>>(
  client: pg.Client,
  text: string,
  params?: unknown[],
): Promise<T[]> {
  return (await client.query(text, params)).rows as T[];
}

async function main() {
  initializeCronPluginSystem();
  const expectedSingletonCronIds = cronPluginRegistry
    .list()
    .filter((plugin) => cronPluginRegistry.getMetadata(plugin).singleton === true)
    .map((plugin) => cronPluginRegistry.getMetadata(plugin).id)
    .sort();

  const admin = adminClient();
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  console.log(`throwaway target created: ${dbName}`);

  try {
    console.log("\n== fresh production bootstrap ==");
    const bootstrap = run(BOOTSTRAP);
    check("fresh bootstrap exits 0", bootstrap.status === 0 && !bootstrap.spawnError, bootstrap.out.slice(-1500));
    if (bootstrap.status !== 0 || bootstrap.spawnError) throw new Error("fresh bootstrap failed");

    const client = testClient();
    await client.connect();
    try {
      const [componentVariable] = await rows<{ value: Record<string, boolean> }>(
        client,
        `SELECT value FROM variables WHERE name = 'components'`,
      );
      const expectedEnabled = new Set<string>(PRODUCTION_COMPONENT_IDS);
      const componentMismatches = componentRegistry.filter(
        (component) => componentVariable?.value?.[component.id] !== expectedEnabled.has(component.id),
      );
      check(
        "component variable is the exact positive allowlist",
        componentMismatches.length === 0,
        componentMismatches.map((component) => component.id).join(", "),
      );
      check(
        "debug, dummy gateway, facility, and staging dashboard are disabled",
        FORBIDDEN_PRODUCTION_COMPONENT_IDS.every((id) => componentVariable?.value?.[id] === false),
      );
      check(
        "cardcheck and payment batches are enabled",
        componentVariable?.value?.cardcheck === true &&
          componentVariable?.value?.["ledger.payment.batch"] === true,
      );

      const accounts = await rows<{
        id: string;
        name: string;
        currency_code: string;
        is_active: boolean;
      }>(
        client,
        `SELECT id, name, currency_code, is_active
           FROM ledger_accounts
          WHERE lower(name) = ANY($1::text[])
          ORDER BY name`,
        [CONTRIBUTION_ACCOUNT_SPECS.map((spec) => spec.name.toLowerCase())],
      );
      check(
        "both contribution accounts exist exactly once",
        accounts.length === 2 &&
          CONTRIBUTION_ACCOUNT_SPECS.every(
            (spec) => accounts.filter((account) => account.name === spec.name).length === 1,
          ),
        JSON.stringify(accounts),
      );
      check(
        "contribution accounts are active USD accounts",
        accounts.every((account) => account.is_active && account.currency_code === "USD"),
      );

      const configs = await rows<{
        id: string;
        enabled: boolean;
        data: Record<string, unknown>;
        scope: string;
        employer_id: string | null;
        account_name: string;
      }>(
        client,
        `SELECT pc.id, pc.enabled, pc.data, pcc.scope, pcc.employer_id, la.name AS account_name
           FROM plugin_configs pc
           JOIN plugin_configs_charge pcc ON pcc.id = pc.id
           JOIN ledger_accounts la ON la.id = pcc.account
          WHERE pc.plugin_kind = 'charge' AND pc.plugin_id = 'bao-hourly'`,
      );
      check(
        "exactly one enabled global BAO Hourly config targets Employer Contributions",
        configs.length === 1 &&
          configs[0].enabled &&
          configs[0].scope === "global" &&
          configs[0].employer_id == null &&
          configs[0].account_name === BAO_HOURLY_CONFIG.accountName,
        JSON.stringify(configs),
      );

      const statusRows = await rows<{ id: string; name: string; code: string }>(
        client,
        `SELECT id, name, code FROM options_employment_status`,
      );
      const nameById = new Map(statusRows.map((row) => [row.id, row.name]));
      const billedNames = ((configs[0]?.data?.billedEmploymentStatusIds ?? []) as string[])
        .map((id) => nameById.get(id))
        .sort();
      const nonBilledNames = ((configs[0]?.data?.nonBilledEmploymentStatusIds ?? []) as string[])
        .map((id) => nameById.get(id))
        .sort();
      check(
        "BAO Hourly billed allowlist is exact (Disability remains outside)",
        JSON.stringify(billedNames) ===
          JSON.stringify(EMPLOYMENT_STATUS_SPECS.filter((spec) => spec.billed).map((spec) => spec.name).sort()),
        JSON.stringify(billedNames),
      );
      check(
        "BAO Hourly explicit non-billed list is exact",
        JSON.stringify(nonBilledNames) ===
          JSON.stringify(
            EMPLOYMENT_STATUS_SPECS.filter((spec) => spec.explicitlyNonBilled)
              .map((spec) => spec.name)
              .sort(),
          ),
        JSON.stringify(nonBilledNames),
      );

      const cronRows = await rows<{ plugin_id: string; enabled: boolean }>(
        client,
        `SELECT plugin_id, enabled FROM plugin_configs WHERE plugin_kind = 'cron' ORDER BY plugin_id`,
      );
      check(
        "every registered singleton cron was materialized",
        JSON.stringify(cronRows.map((row) => row.plugin_id).sort()) ===
          JSON.stringify(expectedSingletonCronIds),
        `expected=${expectedSingletonCronIds.length} actual=${cronRows.length}`,
      );
      check("all cron configurations are disabled", cronRows.every((row) => !row.enabled));

      console.log("\n== repeat runs adopt and re-lock ==");
      const componentsAgain = run(COMPONENTS);
      check("component seed repeat exits 0", componentsAgain.status === 0, componentsAgain.out.slice(-800));
      const baoAgain = run(BAO_BASELINE);
      check("BAO baseline repeat exits 0", baoAgain.status === 0, baoAgain.out.slice(-800));
      check(
        "BAO repeat reports adoption rather than creation",
        /"created":\s*0/.test(baoAgain.out) && /"baoHourlyConfig":\s*"adopted"/.test(baoAgain.out),
        baoAgain.out.slice(-1000),
      );
      await client.query(
        `UPDATE plugin_configs
            SET enabled = true
          WHERE plugin_kind = 'cron'
            AND id = (SELECT id FROM plugin_configs WHERE plugin_kind = 'cron' ORDER BY id LIMIT 1)`,
      );
      const cronAgain = run(CRON_LOCKOUT);
      check("cron lockout repeat exits 0", cronAgain.status === 0, cronAgain.out.slice(-800));
      const enabledCronCount = await rows<{ n: number }>(
        client,
        `SELECT count(*)::int AS n FROM plugin_configs WHERE plugin_kind = 'cron' AND enabled`,
      );
      check("cron repeat disables a manually re-enabled job", Number(enabledCronCount[0]?.n ?? -1) === 0);
      const lockHolder = testClient();
      await lockHolder.connect();
      await lockHolder.query(`SELECT pg_advisory_lock(727001)`);
      try {
        const refusedStandalone = run(BAO_BASELINE);
        check(
          "standalone baseline seed refuses a concurrent migration lock",
          refusedStandalone.status === 1 && /advisory lock/i.test(refusedStandalone.out),
          refusedStandalone.out.slice(-500),
        );
      } finally {
        await lockHolder.query(`SELECT pg_advisory_unlock(727001)`);
        await lockHolder.end();
      }

      console.log("\n== post-stage policy benefit seed ==");
      await client.query(`CREATE SCHEMA IF NOT EXISTS s1_staging`);
      await client.query(`CREATE TABLE IF NOT EXISTS s1_staging.records (
        bundle text NOT NULL, nid bigint NOT NULL, vid bigint, title text, uid bigint,
        status integer, created bigint, changed bigint,
        fields jsonb NOT NULL DEFAULT '{}'::jsonb,
        content_hash text,
        extracted_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (bundle, nid))`);
      for (const [nid, title] of [[9701, "Production Seed Medical"], [9702, "Production Seed Dental"]] as const) {
        await client.query(
          `INSERT INTO s1_staging.records (bundle, nid, title, status)
           VALUES ('sirius_trust_benefit', $1, $2, 1)`,
          [nid, title],
        );
      }
      const trust = run(SEED_TRUST);
      check("seed-trust-config fixture exits 0", trust.status === 0, trust.out.slice(-1200));
      if (trust.status !== 0) throw new Error("seed-trust-config fixture failed");
      const policySeed = run(SEED_POLICY_BENEFITS);
      check("post-stage policy seed exits 0", policySeed.status === 0, policySeed.out.slice(-1000));
      if (policySeed.status !== 0) throw new Error("post-stage policy seed failed");
      const mappedBenefits = await rows<{ s2_id: string }>(
        client,
        `SELECT s2_id FROM s1_staging.id_map WHERE entity = 'benefit' ORDER BY s1_id`,
      );
      const policyRows = await rows<{ sirius_id: string; data: Record<string, unknown> }>(
        client,
        `SELECT sirius_id, data FROM policies WHERE sirius_id = ANY($1::text[]) ORDER BY sirius_id`,
        [[...POLICY_SIRIUS_IDS]],
      );
      const expectedBenefitIds = mappedBenefits.map((row) => row.s2_id).sort();
      check(
        "EC and UH both receive every target-resolved staged benefit",
        policyRows.length === 2 &&
          policyRows.every(
            (policy) =>
              JSON.stringify([...(policy.data.benefitIds as string[])].sort()) === JSON.stringify(expectedBenefitIds),
          ),
        JSON.stringify(policyRows),
      );
      check(
        "policy seed preserves unrelated policy metadata",
        policyRows.every((policy) => typeof policy.data.migrationNote === "string"),
      );
      const policyAgain = run(SEED_POLICY_BENEFITS);
      check("policy seed repeat exits 0", policyAgain.status === 0, policyAgain.out.slice(-800));
      check(
        "policy repeat adopts both assignments",
        /"policiesCreatedAssignments":\s*0/.test(policyAgain.out) &&
          /"policiesAdoptedAssignments":\s*2/.test(policyAgain.out),
        policyAgain.out.slice(-800),
      );

      console.log("\n== mismatches fail loudly without overwrite ==");
      const originalConfigData = configs[0].data;
      await client.query(`UPDATE plugin_configs SET data = $1::jsonb WHERE id = $2`, [
        JSON.stringify({ billedEmploymentStatusIds: [], nonBilledEmploymentStatusIds: [] }),
        configs[0].id,
      ]);
      const badConfig = run(BAO_BASELINE);
      check("BAO settings mismatch exits 1", badConfig.status === 1 && /allowlist|non-billed/i.test(badConfig.out));
      const [stillBadConfig] = await rows<{ data: Record<string, unknown> }>(
        client,
        `SELECT data FROM plugin_configs WHERE id = $1`,
        [configs[0].id],
      );
      check(
        "BAO mismatch is not overwritten",
        Array.isArray(stillBadConfig.data.billedEmploymentStatusIds) &&
          (stillBadConfig.data.billedEmploymentStatusIds as unknown[]).length === 0,
      );
      await client.query(`UPDATE plugin_configs SET data = $1::jsonb WHERE id = $2`, [
        JSON.stringify(originalConfigData),
        configs[0].id,
      ]);
      const billedIds = originalConfigData.billedEmploymentStatusIds as string[];
      await client.query(`UPDATE plugin_configs SET data = $1::jsonb WHERE id = $2`, [
        JSON.stringify({
          ...originalConfigData,
          billedEmploymentStatusIds: [...billedIds, billedIds[0]],
        }),
        configs[0].id,
      ]);
      const duplicateConfigId = run(BAO_BASELINE);
      check(
        "duplicate BAO status id is rejected as a mismatch",
        duplicateConfigId.status === 1 && /allowlist/i.test(duplicateConfigId.out),
      );
      await client.query(`UPDATE plugin_configs SET data = $1::jsonb WHERE id = $2`, [
        JSON.stringify(originalConfigData),
        configs[0].id,
      ]);

      const disability = statusRows.find((row) => row.name === "Disability")!;
      await client.query(`UPDATE options_employment_status SET code = 'WRONG' WHERE id = $1`, [disability.id]);
      const badStatus = run(BAO_BASELINE);
      check("required status code mismatch exits 1", badStatus.status === 1 && /employment status mismatch/i.test(badStatus.out));
      await client.query(`UPDATE options_employment_status SET code = $1 WHERE id = $2`, [disability.code, disability.id]);

      await client.query(
        `INSERT INTO ledger_accounts (name, description) VALUES ('Employer Contributions', 'intentional duplicate')`,
      );
      const duplicateAccount = run(BAO_BASELINE);
      check("ambiguous contribution account exits 1", duplicateAccount.status === 1 && /multiple ledger accounts/i.test(duplicateAccount.out));
      await client.query(`DELETE FROM ledger_accounts WHERE description = 'intentional duplicate'`);

      const ec = policyRows.find((policy) => policy.sirius_id === "EC")!;
      const ecOriginalData = ec.data;
      await client.query(`UPDATE policies SET data = $1::jsonb WHERE sirius_id = 'EC'`, [
        JSON.stringify({ ...ec.data, benefitIds: [expectedBenefitIds[0]] }),
      ]);
      const badPolicy = run(SEED_POLICY_BENEFITS);
      check("policy assignment mismatch exits 1", badPolicy.status === 1 && /differs from the staged target set/i.test(badPolicy.out));
      const [stillBadPolicy] = await rows<{ data: Record<string, unknown> }>(
        client,
        `SELECT data FROM policies WHERE sirius_id = 'EC'`,
      );
      check(
        "policy mismatch is not overwritten",
        JSON.stringify(stillBadPolicy.data.benefitIds) === JSON.stringify([expectedBenefitIds[0]]),
      );
      await client.query(`UPDATE policies SET data = $1::jsonb WHERE sirius_id = 'EC'`, [
        JSON.stringify(ecOriginalData),
      ]);
      await client.query(`UPDATE policies SET data = $1::jsonb WHERE sirius_id = 'EC'`, [
        JSON.stringify({
          ...ecOriginalData,
          benefitIds: [...expectedBenefitIds, expectedBenefitIds[0]],
        }),
      ]);
      const duplicatePolicyId = run(SEED_POLICY_BENEFITS);
      check(
        "duplicate policy benefit id is rejected as a mismatch",
        duplicatePolicyId.status === 1 && /differs from the staged target set/i.test(duplicatePolicyId.out),
      );
      await client.query(`UPDATE policies SET data = $1::jsonb WHERE sirius_id = 'EC'`, [
        JSON.stringify(ecOriginalData),
      ]);

      console.log("\n== source-copy guard ==");
      const guardedFiles = [
        "scripts/s1-migration/bootstrap-target.ts",
        "scripts/s1-migration/enable-production-components.ts",
        "scripts/s1-migration/lockout-bootstrap-crons.ts",
        "scripts/s1-migration/seed-bao-production-baseline.ts",
        "scripts/s1-migration/seed-policy-benefits.ts",
        "scripts/s1-migration/lib/production-baseline.ts",
      ];
      const guardedText = guardedFiles.map((file) => readFileSync(file, "utf8")).join("\n");
      check("production baseline contains no UUID literals", !/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(guardedText));
      check("production baseline never reads a source config database", !/SOURCE_CONFIG_DATABASE_URL|copy-fund-config/i.test(guardedText));
      check("bootstrap never invokes a development component helper", !/dev\/enable-components/.test(guardedText));

      console.log("\n== full bootstrap lock spans child seeds ==");
      const race = await runBootstrapRace();
      check("first paused bootstrap completes", race.first.status === 0, race.first.out.slice(-1000));
      check(
        "second bootstrap is refused while first is between parent and child steps",
        race.second.status === 1 && /advisory lock/i.test(race.second.out),
        race.second.out.slice(-800),
      );
    } finally {
      await client.end();
    }
  } finally {
    if (KEEP_DB) {
      console.log(`\n--keep-db: ${dbName}`);
    } else {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      console.log(`\nthrowaway DB dropped: ${dbName}`);
    }
    await admin.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error("FATAL:", error);
  try {
    const admin = adminClient();
    await admin.connect();
    if (!KEEP_DB) await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  } catch {
    // best effort cleanup
  }
  process.exit(1);
});
