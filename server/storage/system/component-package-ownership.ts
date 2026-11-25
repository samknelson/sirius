import { eq, like, or, sql } from "drizzle-orm";
import { variables } from "@shared/schema";
import { PACKAGE_OWNERSHIP_VARIABLE, parseComponentOwnership, type ComponentOwnership } from "@shared/component-package-ownership";
import { getClient } from "../transaction-context";
import { tableExists } from "../utils";

export const componentPackageOwnershipStorage = {
  async read(): Promise<ComponentOwnership> {
    if (!(await tableExists("variables"))) return {};
    const rows = await getClient().select({ name: variables.name, value: variables.value }).from(variables)
      .where(or(eq(variables.name, PACKAGE_OWNERSHIP_VARIABLE), like(variables.name, "component\\_schema\\_state\\_%")));
    const recorded = rows.find(row => row.name === PACKAGE_OWNERSHIP_VARIABLE);
    const ownership = recorded ? { ...parseComponentOwnership(recorded.value) } : {};
    // Existing deployments already recorded exact schema ownership here.
    // Honor that evidence even if the first package-aware build omits a package.
    for (const row of rows) {
      if (row.name === PACKAGE_OWNERSHIP_VARIABLE) continue;
      const id = row.name.slice("component_schema_state_".length);
      if (ownership[id]) continue;
      const state = row.value as { tables?: { tableName: string; status: string }[] } | null;
      if (!Array.isArray(state?.tables)) throw new Error(`Invalid retained component schema state: ${id}`);
      ownership[id] = {
        packageId: "legacy",
        definition: { id, name: id, description: "Retained component schema; package is not installed.", enabledByDefault: false },
        tables: state.tables.filter(table => table.status !== "dropped").map(table => table.tableName),
      };
    }
    return parseComponentOwnership(ownership);
  },
  async record(installed: ComponentOwnership): Promise<void> {
    if (!Object.keys(installed).length) return;
    const existing = await this.read();
    for (const [id, entry] of Object.entries(installed)) {
      if (existing[id] && existing[id].packageId !== "legacy" && existing[id].packageId !== entry.packageId) {
        throw new Error(`Component ${id} was previously owned by package ${existing[id].packageId}`);
      }
      entry.tables = [...new Set([...(existing[id]?.tables ?? []), ...entry.tables])];
      const others = Object.entries({ ...existing, ...installed }).filter(([other]) => other !== id);
      for (const table of entry.tables) {
        if (others.some(([, owner]) => owner.tables.includes(table))) {
          throw new Error(`Component table ${table} has multiple package owners`);
        }
      }
    }
    const patch = JSON.stringify(installed);
    await getClient().insert(variables).values({ name: PACKAGE_OWNERSHIP_VARIABLE, value: installed })
      .onConflictDoUpdate({
        target: variables.name,
        set: { value: sql`${variables.value} || ${patch}::jsonb` },
      });
  },
};
