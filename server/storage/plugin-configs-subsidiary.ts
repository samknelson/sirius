import { getClient } from './transaction-context';
import {
  pluginConfigsCharge,
  pluginConfigsBenefitEligibility,
  pluginConfigsDispatch,
  type PluginConfigCharge,
  type InsertPluginConfigCharge,
  type PluginConfigBenefitEligibility,
  type InsertPluginConfigBenefitEligibility,
  type PluginConfigDispatch,
  type InsertPluginConfigDispatch,
} from "@shared/schema";
import { eq, isNull, type SQL } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";

/**
 * Per-kind subsidiary storage namespaces (Task #353).
 *
 * Each subsidiary table (charge / benefit-eligibility / dispatch) gets its
 * own focused storage namespace owning exactly the queries for that one
 * table: a 1:1 read by base id, an idempotent upsert, and the WHERE
 * conditions the generic search dispatcher needs to filter the table.
 *
 * These namespaces are INTERNAL to `createPluginConfigStorage` — they are
 * composed by the base `storage.pluginConfigs` dispatcher and are never
 * exposed on the public storage interface or called directly from a route.
 * Adding a new kind with relational dimensions means adding one namespace
 * here and one entry in the dispatcher's subsidiary map — no route or
 * frontend change.
 */
export interface SubsidiaryStorage<TRow, TInsert> {
  /** The Drizzle table — used by the dispatcher to build its JOIN. */
  readonly table: AnyPgTable;
  /** Fetch the subsidiary row for a base config id, if present. */
  get(id: string): Promise<TRow | undefined>;
  /** Insert or update the subsidiary row keyed by the shared base id. */
  upsert(row: TInsert): Promise<TRow>;
  /** Translate generic search params into WHERE conditions for this table. */
  buildConditions(params: SubsidiarySearchParams): SQL[];
}

/** Superset of every subsidiary's filterable columns (all optional). */
export interface SubsidiarySearchParams {
  scope?: string;
  employerId?: string | null;
  account?: string | null;
  policy?: string | null;
  benefit?: string | null;
  appliesTo?: string | null;
  jobType?: string | null;
}

/** `col = val`, or `col IS NULL` when val is explicitly null; skip undefined. */
function eqOrNull(out: SQL[], col: any, val: string | null | undefined): void {
  if (val === undefined) return;
  out.push(val === null ? isNull(col) : eq(col, val));
}

export function createChargeSubsidiaryStorage(): SubsidiaryStorage<
  PluginConfigCharge,
  InsertPluginConfigCharge
> {
  return {
    table: pluginConfigsCharge,
    async get(id) {
      const client = getClient();
      const [row] = await client.select().from(pluginConfigsCharge).where(eq(pluginConfigsCharge.id, id));
      return row || undefined;
    },
    async upsert(row) {
      const client = getClient();
      const [result] = await client
        .insert(pluginConfigsCharge)
        .values(row)
        .onConflictDoUpdate({
          target: pluginConfigsCharge.id,
          set: {
            pluginId: row.pluginId,
            scope: row.scope,
            employerId: row.employerId ?? null,
            account: row.account ?? null,
          },
        })
        .returning();
      return result;
    },
    buildConditions(params) {
      const out: SQL[] = [];
      if (params.scope !== undefined) out.push(eq(pluginConfigsCharge.scope, params.scope));
      eqOrNull(out, pluginConfigsCharge.employerId, params.employerId);
      eqOrNull(out, pluginConfigsCharge.account, params.account);
      return out;
    },
  };
}

export function createBenefitEligibilitySubsidiaryStorage(): SubsidiaryStorage<
  PluginConfigBenefitEligibility,
  InsertPluginConfigBenefitEligibility
> {
  return {
    table: pluginConfigsBenefitEligibility,
    async get(id) {
      const client = getClient();
      const [row] = await client
        .select()
        .from(pluginConfigsBenefitEligibility)
        .where(eq(pluginConfigsBenefitEligibility.id, id));
      return row || undefined;
    },
    async upsert(row) {
      const client = getClient();
      const [result] = await client
        .insert(pluginConfigsBenefitEligibility)
        .values(row)
        .onConflictDoUpdate({
          target: pluginConfigsBenefitEligibility.id,
          set: {
            policy: row.policy ?? null,
            benefit: row.benefit ?? null,
            appliesTo: row.appliesTo ?? null,
          },
        })
        .returning();
      return result;
    },
    buildConditions(params) {
      const out: SQL[] = [];
      eqOrNull(out, pluginConfigsBenefitEligibility.policy, params.policy);
      eqOrNull(out, pluginConfigsBenefitEligibility.benefit, params.benefit);
      eqOrNull(out, pluginConfigsBenefitEligibility.appliesTo, params.appliesTo);
      return out;
    },
  };
}

export function createDispatchSubsidiaryStorage(): SubsidiaryStorage<
  PluginConfigDispatch,
  InsertPluginConfigDispatch
> {
  return {
    table: pluginConfigsDispatch,
    async get(id) {
      const client = getClient();
      const [row] = await client.select().from(pluginConfigsDispatch).where(eq(pluginConfigsDispatch.id, id));
      return row || undefined;
    },
    async upsert(row) {
      const client = getClient();
      const [result] = await client
        .insert(pluginConfigsDispatch)
        .values(row)
        .onConflictDoUpdate({
          target: pluginConfigsDispatch.id,
          set: { jobType: row.jobType ?? null },
        })
        .returning();
      return result;
    },
    buildConditions(params) {
      const out: SQL[] = [];
      eqOrNull(out, pluginConfigsDispatch.jobType, params.jobType);
      return out;
    },
  };
}
