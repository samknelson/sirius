import { createHash } from "node:crypto";
import type { Wizard } from "@shared/schema";
import { parseSSN } from "../../../shared/utils/ssn";
import { storage } from "../../storage";
import type { GbhetLegalWorkersWizard } from "./engine/types/gbhet_legal_workers";
import { mergeEnabledChargeConfigs, toChargeConfig } from "../ledger/charge/charge-config-resolution";
import { legalBenefitPrice } from "../ledger/charge/gbhet-legal-pricing";
import { assertGbhetBenefitConfiguration } from "./gbhet-legal-benefits";

export function legalEligible(value: unknown): boolean {
  return value != null && !["", "0", "no", "n", "false"].includes(String(value).toLowerCase().trim());
}

export function legalBenefitMonth(year: number, month: number) {
  return { year: month > 9 ? year + 1 : year, month: month > 9 ? month - 9 : month + 3 };
}

/** A read-only, live estimate. Identity keys are hashed, never returned.
 * Approval binds both inputs and the current worker/grant/pricing resolution. */
export async function forecastLegalUpload(feed: GbhetLegalWorkersWizard, wizard: Wizard) {
  const data = (wizard.data ?? {}) as Record<string, any>;
  const validation = data.validationResults;
  if (!validation || validation.invalidRows || validation.unmappedStatuses?.length) {
    throw new Error("Successfully validate this upload before previewing or processing.");
  }
  if (!wizard.entityId) throw new Error("An employer is required");
  const year = Number(data.launchArguments?.year), month = Number(data.launchArguments?.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid reporting period");
  }
  await assertGbhetBenefitConfiguration(storage, feed.getFields(), data);
  const rows = await feed.readMappedRows(wizard);
  await feed.assertForecastRows(wizard, rows);
  const [globals, overrides] = await Promise.all([
    storage.pluginConfigs.search("charge", { pluginId: "gbhet-legal-benefit", enabled: true, scope: "global", employerId: null }),
    storage.pluginConfigs.search("charge", { pluginId: "gbhet-legal-benefit", enabled: true, scope: "employer", employerId: wizard.entityId }),
  ]);
  const configs = mergeEnabledChargeConfigs(globals.map(toChargeConfig), overrides.map(toChargeConfig));
  const period = legalBenefitMonth(year, month);
  const workers = new Map<string, Awaited<ReturnType<typeof storage.workers.getWorkerBySSN>>>();
  const newWorkers = new Set<string>(), grantedWorkers = new Set<string>(), grants = new Set<string>();
  const existing = new Set<string>();
  const groups = new Map<string, { accountId: string; year: number; month: number; amount: number }>();
  let unpriceableGrants = 0, excludedRows = 0, cents = 0;
  const resolution: unknown[] = [];
  for (const row of rows) {
    let identity: string;
    try { identity = parseSSN(String(row.ssn ?? "")); }
    catch { excludedRows++; continue; } // SSN-format warnings do not create workers.
    if (!workers.has(identity)) workers.set(identity, await storage.workers.getWorkerBySSN(identity));
    const worker = workers.get(identity);
    if (!worker && data.mode === "update") { excludedRows++; continue; }
    if (!worker) newWorkers.add(identity);
    resolution.push([identity, worker?.id ?? null]);
    for (const association of data.benefitConfig) {
      if (!legalEligible(row[association.fieldId])) continue;
      const key = `${identity}:${association.benefitId}`;
      if (grants.has(key) || existing.has(key)) continue;
      if (worker && await storage.trust.wmb.workerBenefitExists(worker.id, association.benefitId, period.month, period.year)) {
        existing.add(key);
        continue;
      }
      grants.add(key);
      grantedWorkers.add(identity);
      const matches = configs.filter(config => (config.settings as any)?.benefitId === association.benefitId);
      let unavailable = matches.length === 0;
      for (const config of matches) {
        const price = config.account && legalBenefitPrice(config.settings, period.year, period.month);
        if (!price || !config.account) { unavailable = true; continue; }
        let amount = Number(price.amount);
        // A surviving keyed charge can exist even when its grant has gone.
        // Billing reconciles that entry instead of inserting another one.
        const ea = worker && await storage.ledger.ea.getByEntityAndAccount("employer", wizard.entityId, config.account);
        const prior = ea && worker && await storage.ledger.entries.getByChargePluginKey(
          "gbhet-legal-benefit", `${config.id}:${ea.id}:${worker.id}:${period.year}:${period.month}`);
        if (prior) amount -= Number(prior.amount);
        const amountCents = Math.round(amount * 100);
        cents += amountCents;
        const groupKey = `${config.account}:${price.billingYear}:${price.billingMonth}`;
        const group = groups.get(groupKey) ?? { accountId: config.account, year: price.billingYear, month: price.billingMonth, amount: 0 };
        group.amount += amountCents / 100;
        groups.set(groupKey, group);
      }
      if (unavailable) unpriceableGrants++;
    }
  }
  const estimate = {
    workersWithNewGrants: grantedWorkers.size, newWorkers: newWorkers.size,
    newGrants: grants.size, existingGrantSkips: existing.size,
    knownChargeTotal: (cents / 100).toFixed(2), unpriceableGrants, excludedRows,
    chargeGroups: [...groups.values()],
  };
  const fingerprint = createHash("sha256").update(JSON.stringify({
    input: [wizard.entityId, data.uploadedFileId, data.columnMapping, data.hasHeaders, data.mode, data.benefitConfig, year, month],
    configs, estimate, resolution, grants: [...grants], existing: [...existing],
  })).digest("hex");
  return { ...estimate, fingerprint };
}
