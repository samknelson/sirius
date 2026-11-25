import { eq, like, or, sql } from "drizzle-orm";
import { variables } from "@shared/schema";
import {
  COMPONENT_OWNERSHIP_VARIABLE, LEGACY_COMPONENT_OWNERSHIP_VARIABLE, parseComponentOwnership, type ComponentOwnership,
} from "@shared/component-ownership";
import { getClient } from "../transaction-context";
import { tableExists } from "../utils";

export const componentOwnershipStorage = {
  async read(): Promise<ComponentOwnership> {
    if (!(await tableExists("variables"))) return {};
    const rows = await getClient().select({ name: variables.name, value: variables.value }).from(variables)
      .where(or(
        eq(variables.name, COMPONENT_OWNERSHIP_VARIABLE),
        eq(variables.name, LEGACY_COMPONENT_OWNERSHIP_VARIABLE),
        like(variables.name, "component\\_schema\\_state\\_%"),
      ));
    const legacy = rows.find(row => row.name === LEGACY_COMPONENT_OWNERSHIP_VARIABLE);
    const recorded = rows.find(row => row.name === COMPONENT_OWNERSHIP_VARIABLE);
    // Current records win; legacy entries fill in components recorded only by older builds.
    const ownership: ComponentOwnership = {
      ...(legacy ? parseComponentOwnership(legacy.value) : {}),
      ...(recorded ? parseComponentOwnership(recorded.value) : {}),
    };
    // Existing deployments already recorded exact schema ownership here.
    // Honor that evidence even if the first build without a component omits it.
    for (const row of rows) {
      if (!row.name.startsWith("component_schema_state_")) continue;
      const id = row.name.slice("component_schema_state_".length);
      if (ownership[id]) continue;
      const state = row.value as { tables?: { tableName: string; status: string }[] } | null;
      if (!Array.isArray(state?.tables)) throw new Error(`Invalid retained component schema state: ${id}`);
      ownership[id] = {
        definition: { id, name: id, description: "Retained component schema; component source is not present.", enabledByDefault: false },
        tables: state.tables.filter(table => table.status !== "dropped").map(table => table.tableName),
      };
    }
    return parseComponentOwnership(ownership);
  },
  async record(installed: ComponentOwnership): Promise<void> {
    if (!Object.keys(installed).length) return;
    const existing = await this.read();
    for (const [id, entry] of Object.entries(installed)) {
      entry.tables = [...new Set([...(existing[id]?.tables ?? []), ...entry.tables])];
      const others = Object.entries({ ...existing, ...installed }).filter(([other]) => other !== id);
      for (const table of entry.tables) {
        if (others.some(([, owner]) => owner.tables.includes(table))) {
          throw new Error(`Component table ${table} is owned by more than one component`);
        }
      }
    }
    const patch = JSON.stringify(installed);
    await getClient().insert(variables).values({ name: COMPONENT_OWNERSHIP_VARIABLE, value: installed })
      .onConflictDoUpdate({
        target: variables.name,
        set: { value: sql`${variables.value} || ${patch}::jsonb` },
      });
  },
};
