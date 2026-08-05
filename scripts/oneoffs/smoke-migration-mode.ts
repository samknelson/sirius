/**
 * Regression test for the T20 charge-plugin migration mode:
 *  1. The charge package barrel registers plugins (empty registry would make
 *     the loader's preflight vacuously pass — the exact bug this guards).
 *  2. hasRunnableChargePlugins() reports runnable=true when an hour-driven
 *     plugin has an enabled config (storage stubbed on the singleton), so a
 *     non-migration-mode T20 run would abort BEFORE any worker-hours upsert.
 *  3. withChargePluginsSuppressed makes executeChargePlugins return an empty
 *     result (no transactions) even with plugins registered.
 *  4. Suppression does not leak outside the scope.
 *
 * Run: npx tsx scripts/oneoffs/smoke-migration-mode.ts
 */
import { storage } from "../../server/storage/database";
import {
  withChargePluginsSuppressed,
  areChargePluginsSuppressed,
} from "../../server/middleware/request-context";
// Barrel import — side effects register all charge plugins.
import {
  executeChargePlugins,
  hasRunnableChargePlugins,
  getAllChargePlugins,
  getAllEnabledChargePlugins,
} from "../../server/plugins/ledger/charge";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

async function main() {
  // 1. Registry populated via barrel import.
  const all = getAllChargePlugins();
  assert(all.length > 0, `charge plugin registry populated via barrel (${all.length} plugins)`);

  // 2. Preflight detects an enabled config for a component-enabled plugin.
  const enabledPlugins = await getAllEnabledChargePlugins();
  if (enabledPlugins.length === 0) {
    console.log("note: no component-enabled charge plugins in this environment; skipping runnable=true assertion");
  } else {
    const target = enabledPlugins[0].metadata.id;
    const realSearch = storage.pluginConfigs.search.bind(storage.pluginConfigs);
    // Stub with the REAL storage envelope shape: { config, subsidiary }.
    (storage.pluginConfigs as any).search = async (kind: string, opts: any) => {
      if (kind === "charge" && opts?.enabled === true && !opts.pluginId) {
        return [
          {
            config: {
              id: "stub-config",
              pluginKind: "charge",
              pluginId: target,
              enabled: true,
              scope: "global",
            },
            subsidiary: { pluginConfigId: "stub-config" },
          },
        ];
      }
      return realSearch(kind, opts);
    };
    try {
      const pre = await hasRunnableChargePlugins();
      assert(pre.runnable === true, `preflight reports runnable=true for enabled config (${pre.pluginIds.join(",")})`);
      assert(pre.pluginIds.includes(target), "preflight names the configured plugin");
    } finally {
      (storage.pluginConfigs as any).search = realSearch;
    }
  }

  // 3. Suppressed executor produces no transactions.
  assert(!areChargePluginsSuppressed(), "not suppressed outside scope (before)");
  await withChargePluginsSuppressed(async () => {
    assert(areChargePluginsSuppressed(), "suppressed inside scope");
    const res = await executeChargePlugins({ trigger: "HOURS_SAVED", workerId: "smoke", employerId: null } as any);
    assert(res.executed.length === 0 && res.totalTransactions.length === 0, "suppressed executor returns empty result");
  });

  // 4. No leak.
  assert(!areChargePluginsSuppressed(), "not suppressed outside scope (after)");

  console.log("ALL PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
