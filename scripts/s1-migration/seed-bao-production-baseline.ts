/**
 * Seed the semantic BAO production ledger baseline:
 * - one active USD Employee Contributions account
 * - one active USD Employer Contributions account
 * - one enabled global BAO Hourly config targeting Employer Contributions
 * - billed/non-billed status ids resolved from target-owned names and codes
 *
 * Matching state is adopted. Ambiguous, inactive, differently-coded, or
 * differently-configured state fails loudly and is never overwritten.
 *
 * Usage: npx tsx scripts/s1-migration/seed-bao-production-baseline.ts
 */
import { pool } from "../../server/storage/db";
import { storage } from "../../server/storage/database";
import { runInTransaction } from "../../server/storage/transaction-context";
import { createUnifiedOptionsStorage } from "../../server/storage/unified-options";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { registerChargePluginKind } from "../../server/plugins/ledger/charge";
import {
  BAO_HOURLY_CONFIG,
  CONTRIBUTION_ACCOUNT_SPECS,
  EMPLOYMENT_STATUS_SPECS,
} from "./lib/production-baseline";
import { acquireMigrationSeedLock } from "./lib/migration-lock";

interface EmploymentStatusRow {
  id: string;
  name: string;
  code: string;
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function sameStringSet(actual: unknown, expected: string[]): boolean {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== "string")) return false;
  const actualValues = actual as string[];
  if (new Set(actualValues).size !== actualValues.length) return false;
  if (new Set(expected).size !== expected.length) return false;
  const a = [...actualValues].sort();
  const e = [...expected].sort();
  return a.length === e.length && a.every((value, index) => value === e[index]);
}

function assertExpectedSettings(data: unknown, billedIds: string[], nonBilledIds: string[]): void {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("existing BAO Hourly config has non-object settings");
  }
  const settings = data as Record<string, unknown>;
  const keys = Object.keys(settings).sort();
  const expectedKeys = ["billedEmploymentStatusIds", "nonBilledEmploymentStatusIds"];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`existing BAO Hourly config has unexpected settings keys: ${keys.join(", ")}`);
  }
  if (!sameStringSet(settings.billedEmploymentStatusIds, billedIds)) {
    throw new Error("existing BAO Hourly billed employment-status allowlist does not match the approved baseline");
  }
  if (!sameStringSet(settings.nonBilledEmploymentStatusIds, nonBilledIds)) {
    throw new Error("existing BAO Hourly non-billed employment-status list does not match the approved baseline");
  }
}

function resolveEmploymentStatuses(rows: EmploymentStatusRow[]): {
  billedIds: string[];
  nonBilledIds: string[];
} {
  const resolved = new Map<string, string>();
  for (const spec of EMPLOYMENT_STATUS_SPECS) {
    const byName = rows.filter((row) => normalized(row.name) === normalized(spec.name));
    if (byName.length !== 1) {
      throw new Error(`employment status "${spec.name}" resolved to ${byName.length} rows (expected exactly one)`);
    }
    const row = byName[0];
    if (row.name !== spec.name || row.code !== spec.code) {
      throw new Error(
        `employment status mismatch for "${spec.name}": found name="${row.name}" code="${row.code}", expected code="${spec.code}"`,
      );
    }
    const byCode = rows.filter((candidate) => normalized(candidate.code) === normalized(spec.code));
    if (byCode.length !== 1 || byCode[0].id !== row.id) {
      throw new Error(`employment status code "${spec.code}" is ambiguous or belongs to another status`);
    }
    resolved.set(spec.code, row.id);
  }
  return {
    billedIds: EMPLOYMENT_STATUS_SPECS
      .filter((spec) => spec.billed)
      .map((spec) => resolved.get(spec.code)!),
    nonBilledIds: EMPLOYMENT_STATUS_SPECS
      .filter((spec) => spec.explicitlyNonBilled)
      .map((spec) => resolved.get(spec.code)!),
  };
}

async function main() {
  const lockClient = await acquireMigrationSeedLock(pool);
  try {
    registerChargePluginKind();

    const statuses = (await createUnifiedOptionsStorage().list("employment-status")) as EmploymentStatusRow[];
    const { billedIds, nonBilledIds } = resolveEmploymentStatuses(statuses);

  const existingAccounts = await storage.ledger.accounts.getAll();
  const accountsByName = new Map<string, typeof existingAccounts>();
  for (const account of existingAccounts) {
    const key = normalized(account.name);
    accountsByName.set(key, [...(accountsByName.get(key) ?? []), account]);
  }
  const resolvedAccounts = new Map<string, { id: string }>();
  const missingAccountSpecs: Array<(typeof CONTRIBUTION_ACCOUNT_SPECS)[number]> = [];
  for (const spec of CONTRIBUTION_ACCOUNT_SPECS) {
    const matches = accountsByName.get(normalized(spec.name)) ?? [];
    if (matches.length > 1) {
      throw new Error(`multiple ledger accounts resolve to "${spec.name}"`);
    }
    if (matches.length === 0) {
      missingAccountSpecs.push(spec);
      continue;
    }
    const account = matches[0];
    if (account.name !== spec.name || !account.isActive || account.currencyCode !== "USD") {
      throw new Error(
        `ledger account "${spec.name}" conflicts with baseline (name="${account.name}", active=${account.isActive}, currency=${account.currencyCode})`,
      );
    }
    resolvedAccounts.set(spec.name, account);
  }

  const existingConfigs = await storage.pluginConfigs.getByKindAndPlugin(
    BAO_HOURLY_CONFIG.pluginKind,
    BAO_HOURLY_CONFIG.pluginId,
  );
  if (existingConfigs.length > 1) {
    throw new Error(`multiple BAO Hourly charge configs exist (${existingConfigs.length}); expected exactly one`);
  }
  const existingConfig = existingConfigs[0];
  if (existingConfig) {
    if (!existingConfig.enabled) {
      throw new Error("existing BAO Hourly charge config is disabled");
    }
    const composed = await storage.pluginConfigs.getWithSubsidiary(existingConfig.id);
    const subsidiary = composed?.subsidiary as {
      scope?: string;
      employerId?: string | null;
      account?: string | null;
    } | null;
    const employerAccount = resolvedAccounts.get(BAO_HOURLY_CONFIG.accountName);
    if (!employerAccount) {
      throw new Error("BAO Hourly config exists but the Employer Contributions account is missing");
    }
    if (
      subsidiary?.scope !== BAO_HOURLY_CONFIG.scope ||
      subsidiary.employerId != null ||
      subsidiary.account !== employerAccount.id
    ) {
      throw new Error("existing BAO Hourly config is not global or does not target Employer Contributions");
    }
    assertExpectedSettings(existingConfig.data, billedIds, nonBilledIds);
  }

  let createdAccounts = 0;
  let createdConfig = 0;
  await withNotificationsSuppressed(() =>
    runInTransaction(async () => {
      for (const spec of missingAccountSpecs) {
        const account = await storage.ledger.accounts.create({
          name: spec.name,
          description: spec.description,
          currencyCode: "USD",
          isActive: true,
        });
        resolvedAccounts.set(spec.name, account);
        createdAccounts++;
      }
      if (!existingConfig) {
        const account = resolvedAccounts.get(BAO_HOURLY_CONFIG.accountName);
        if (!account) throw new Error("Employer Contributions account was not resolved");
        const config = await storage.pluginConfigs.create({
          pluginKind: BAO_HOURLY_CONFIG.pluginKind,
          pluginId: BAO_HOURLY_CONFIG.pluginId,
          enabled: true,
          name: BAO_HOURLY_CONFIG.name,
          siriusId: BAO_HOURLY_CONFIG.siriusId,
          ordering: 0,
          data: {
            billedEmploymentStatusIds: billedIds,
            nonBilledEmploymentStatusIds: nonBilledIds,
          },
        });
        await storage.pluginConfigs.upsertSubsidiary("charge", {
          id: config.id,
          scope: BAO_HOURLY_CONFIG.scope,
          employerId: null,
          account: account.id,
        });
        createdConfig = 1;
      }
    }),
  );

  const finalAccounts = await storage.ledger.accounts.getAll();
  for (const spec of CONTRIBUTION_ACCOUNT_SPECS) {
    const matches = finalAccounts.filter((account) => normalized(account.name) === normalized(spec.name));
    if (matches.length !== 1) throw new Error(`post-seed verification found ${matches.length} "${spec.name}" accounts`);
  }
  const finalConfigs = await storage.pluginConfigs.getByKindAndPlugin("charge", "bao-hourly");
  if (finalConfigs.length !== 1 || !finalConfigs[0].enabled) {
    throw new Error("post-seed verification did not find exactly one enabled BAO Hourly config");
  }

    console.log(JSON.stringify({
      loader: "seed-bao-production-baseline",
      accounts: {
        created: createdAccounts,
        adopted: CONTRIBUTION_ACCOUNT_SPECS.length - createdAccounts,
      },
      baoHourlyConfig: createdConfig === 1 ? "created" : "adopted",
      billedEmploymentStatuses: EMPLOYMENT_STATUS_SPECS.filter((spec) => spec.billed).map((spec) => spec.name),
      explicitlyNonBilledEmploymentStatuses: EMPLOYMENT_STATUS_SPECS
        .filter((spec) => spec.explicitlyNonBilled)
        .map((spec) => spec.name),
      outsideBilledAllowlist: EMPLOYMENT_STATUS_SPECS
        .filter((spec) => !spec.billed && !spec.explicitlyNonBilled)
        .map((spec) => spec.name),
    }, null, 2));
  } finally {
    lockClient?.release();
  }
}

main()
  .then(async () => {
    await pool.end();
    console.log("DONE");
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
