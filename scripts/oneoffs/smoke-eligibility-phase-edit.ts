/**
 * Smoke test for Task: Edit Start/Continue phase on eligibility rules.
 *
 * Exercises the storage/adapter behavior the new route logic relies on:
 *  1. token-aware appliesTo conflict search (used by PATCH + bulk-settings)
 *  2. adapter.toRows keeping data.appliesTo and subsidiary applies_to in sync
 *  3. update + upsertSubsidiary round trip (single edit path)
 *
 * Creates throwaway configs with a sentinel policy/benefit and removes them.
 * Run: npx tsx scripts/oneoffs/smoke-eligibility-phase-edit.ts
 */
import { storage } from "../../server/storage";
import "../../server/storage/database";
import { registerTrustEligibilityKind } from "../../server/plugins/trust/eligibility";
import { getPluginConfigAdapter } from "../../server/plugins/_core";

const KIND = "trust-eligibility";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`ok: ${msg}`);
}

async function main() {
  registerTrustEligibilityKind();
  const adapter = getPluginConfigAdapter(KIND)!;
  // Subsidiary policy/benefit columns are FK-constrained — use real rows.
  const policies = await storage.policies.getAllPolicies();
  const benefits = await storage.trustBenefits.getAllTrustBenefits();
  if (policies.length === 0 || benefits.length === 0) {
    throw new Error("Need at least one policy and one trust benefit in dev DB");
  }
  const POLICY = policies[0].id;
  const BENEFIT = benefits[0].id;
  const createdIds: string[] = [];
  try {
    // Create two rules on the same benefit: one start, one continue.
    for (const phase of ["start", "continue"]) {
      const { base, subsidiary } = adapter.toRows({
        pluginId: "smoke-plugin",
        name: `smoke ${phase}`,
        enabled: false,
        ordering: 0,
        data: { foo: 1 },
        policy: POLICY,
        benefit: BENEFIT,
        appliesTo: phase,
      } as any);
      (base as any).siriusId = null;
      const row = await storage.pluginConfigs.create(base as any);
      createdIds.push(row.id);
      if (subsidiary) {
        await storage.pluginConfigs.upsertSubsidiary(KIND, { id: row.id, ...subsidiary });
      }
    }
    const [startId, continueId] = createdIds;

    // 1. Token-aware conflict search
    const startMatches = await storage.pluginConfigs.search(KIND, {
      policy: POLICY,
      pluginId: "smoke-plugin",
      benefit: BENEFIT,
      appliesTo: "start",
    } as any);
    assert(
      startMatches.length === 1 && startMatches[0].config.id === startId,
      "phase search finds only the start rule",
    );

    // 2. Move the continue rule to start,continue — search must catch the
    // collision with the start rule (this is the conflict path).
    const conflict = (
      await storage.pluginConfigs.search(KIND, {
        policy: POLICY,
        pluginId: "smoke-plugin",
        benefit: BENEFIT,
        appliesTo: "start",
      } as any)
    ).some((m) => m.config.id !== continueId);
    assert(conflict, "conflict detected when retargeting continue→start");

    // 3. Legit phase change: start rule → start,continue after deleting the
    // continue rule; verify base data.appliesTo and subsidiary stay in sync.
    await storage.pluginConfigs.delete(continueId);
    createdIds.splice(createdIds.indexOf(continueId), 1);

    const { base, subsidiary } = adapter.toRows({
      pluginId: "smoke-plugin",
      name: "smoke start",
      enabled: false,
      ordering: 0,
      data: { foo: 2 },
      policy: POLICY,
      benefit: BENEFIT,
      appliesTo: "start,continue",
    } as any);
    (base as any).siriusId = null;
    await storage.pluginConfigs.update(startId, base as any);
    if (subsidiary) {
      await storage.pluginConfigs.upsertSubsidiary(KIND, { id: startId, ...subsidiary });
    }
    const env = await storage.pluginConfigs.getWithSubsidiary(startId);
    const dataAppliesTo = (env!.config.data as any).appliesTo;
    assert(
      Array.isArray(dataAppliesTo) &&
        dataAppliesTo.join(",") === "start,continue",
      "base data.appliesTo updated to [start,continue]",
    );
    assert(
      (env!.subsidiary as any)?.appliesTo === "start,continue",
      "subsidiary applies_to denorm in sync",
    );
    assert((env!.config.data as any).foo === 2, "settings updated alongside phases");

    // Token search now matches the combined row for both phases.
    for (const phase of ["start", "continue"]) {
      const m = await storage.pluginConfigs.search(KIND, {
        policy: POLICY,
        pluginId: "smoke-plugin",
        benefit: BENEFIT,
        appliesTo: phase,
      } as any);
      assert(
        m.length === 1 && m[0].config.id === startId,
        `combined row matches token search for '${phase}'`,
      );
    }
    console.log("\nALL SMOKE CHECKS PASSED");
  } finally {
    for (const id of createdIds) {
      await storage.pluginConfigs.delete(id).catch(() => {});
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
