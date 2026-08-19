/**
 * Provision the approved, minimal BAO production component set.
 *
 * This is intentionally a positive allowlist. Every currently registered
 * component outside the allowlist is written as disabled, so adding a new
 * default-enabled component cannot silently expand the migration target.
 *
 * Usage: npx tsx scripts/s1-migration/enable-production-components.ts
 */
import { pool } from "../../server/storage/db";
import { storage } from "../../server/storage/database";
import {
  enableComponentSchema,
  reconcileComponentPluginConfigs,
} from "../../server/services/component-lifecycle";
import { loadComponentCache } from "../../server/services/component-cache";
import { componentRegistry } from "../../shared/components";
import {
  FORBIDDEN_PRODUCTION_COMPONENT_IDS,
  PRODUCTION_COMPONENT_IDS,
} from "./lib/production-baseline";
import { acquireMigrationSeedLock } from "./lib/migration-lock";

async function main() {
  const lockClient = await acquireMigrationSeedLock(pool);
  try {
    const allowed = new Set<string>(PRODUCTION_COMPONENT_IDS);
    const registered = new Set(componentRegistry.map((component) => component.id));
    const unknown = [...allowed].filter((id) => !registered.has(id));
    if (unknown.length > 0) {
      throw new Error(`production component allowlist contains unknown ids: ${unknown.join(", ")}`);
    }

    for (const forbidden of FORBIDDEN_PRODUCTION_COMPONENT_IDS) {
      if (allowed.has(forbidden)) {
        throw new Error(`forbidden component is present in production allowlist: ${forbidden}`);
      }
    }

    const desired = Object.fromEntries(
      componentRegistry.map((component) => [component.id, allowed.has(component.id)]),
    );
    const existing = await storage.variables.getByName("components");
    if (existing) {
      await storage.variables.update(existing.id, { value: desired });
    } else {
      await storage.variables.create({ name: "components", value: desired });
    }
    await loadComponentCache();
    console.log(`components variable set: ${allowed.size} enabled, ${componentRegistry.length - allowed.size} disabled`);

    const managed = componentRegistry.filter(
      (component) => component.managesSchema && allowed.has(component.id),
    );
    const pending = new Set(managed.map((component) => component.id));
    let progressed = true;
    const deferred = new Map<string, string>();
    while (pending.size > 0 && progressed) {
      progressed = false;
      for (const id of [...pending]) {
        const result = await enableComponentSchema(id);
        if (result.success) {
          console.log(`provisioned: ${id}`);
          pending.delete(id);
          deferred.delete(id);
          progressed = true;
        } else {
          deferred.set(id, String(result.error ?? result.message ?? "unknown lifecycle failure"));
        }
      }
    }
    if (pending.size > 0) {
      const details = [...pending].map((id) => `${id}: ${deferred.get(id) ?? "not provisioned"}`);
      throw new Error(`failed to provision production components:\n${details.join("\n")}`);
    }

    // Match the normal component route/app-boot lifecycle: materialize selected
    // component-owned configs and disable retained configs owned by excluded
    // components without overwriting their editable settings.
    for (const component of componentRegistry) {
      await reconcileComponentPluginConfigs(component.id, allowed.has(component.id));
    }

    const finalVariable = await storage.variables.getByName("components");
    const finalState =
      finalVariable?.value && typeof finalVariable.value === "object" && !Array.isArray(finalVariable.value)
        ? (finalVariable.value as Record<string, unknown>)
        : {};
    const mismatches = componentRegistry
      .filter((component) => finalState[component.id] !== allowed.has(component.id))
      .map((component) => component.id);
    if (mismatches.length > 0) {
      throw new Error(`component verification failed: ${mismatches.join(", ")}`);
    }
    console.log(JSON.stringify({
      loader: "enable-production-components",
      enabled: [...allowed].sort(),
      provisioned: managed.map((component) => component.id).sort(),
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
