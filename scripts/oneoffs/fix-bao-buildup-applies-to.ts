/**
 * One-off: correct the "BAO - Buildup" trust-eligibility rule so it applies
 * ONLY to first-time / after-a-break eligibility ("start" scans), not to the
 * ongoing cycle.
 *
 * Background: the executor ANDs every applicable rule, so while Buildup was
 * configured with appliesTo = ["start", "continue"] a worker had to satisfy
 * BOTH Buildup and Threshold on every ongoing month. Per the BAO rules,
 * Buildup governs first-time eligibility only; Threshold owns the ongoing
 * cycle (it is already appliesTo = ["continue"]).
 *
 * This writes the authoritative `data.appliesTo` array on the base config AND
 * keeps the denormalized `applies_to` column on the trust-eligibility
 * subsidiary row in sync (preserving its existing policy/benefit values).
 *
 * Everything goes through the storage layer (no raw SQL), as required by the
 * project rules. The script is idempotent — re-running sets the same values.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/fix-bao-buildup-applies-to.ts
 */

import { storage } from "../../server/storage/database";

const PLUGIN_KIND = "trust-eligibility";
const PLUGIN_ID = "sitespecific-bao-buildup";
const TARGET_APPLIES_TO = ["start"];

async function main() {
  const configs = await storage.pluginConfigs.getByKindAndPlugin(
    PLUGIN_KIND,
    PLUGIN_ID,
  );

  if (configs.length === 0) {
    console.log(`No '${PLUGIN_ID}' rule configured — nothing to do.`);
    return;
  }

  for (const config of configs) {
    const data = (config.data ?? {}) as Record<string, unknown>;
    const before = JSON.stringify(data.appliesTo ?? null);

    const newData = { ...data, appliesTo: [...TARGET_APPLIES_TO] };
    await storage.pluginConfigs.update(config.id, { data: newData });

    // Keep the denormalized subsidiary column in sync, preserving policy/benefit.
    const composed = await storage.pluginConfigs.getWithSubsidiary(config.id);
    const subsidiary = (composed?.subsidiary ?? {}) as {
      policy?: string | null;
      benefit?: string | null;
    };
    await storage.pluginConfigs.upsertSubsidiary(PLUGIN_KIND, {
      id: config.id,
      policy: subsidiary.policy ?? null,
      benefit: subsidiary.benefit ?? null,
      appliesTo: TARGET_APPLIES_TO.join(","),
    });

    console.log(
      `Updated ${config.id}: data.appliesTo ${before} -> ${JSON.stringify(
        TARGET_APPLIES_TO,
      )}; subsidiary.applies_to -> "${TARGET_APPLIES_TO.join(",")}".`,
    );
  }

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
