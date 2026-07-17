import { getClient } from '../transaction-context';
import {
  pluginConfigsCharge,
  pluginConfigsBenefitEligibility,
  pluginConfigsDispatch,
  pluginConfigsDashboard,
  pluginConfigsPaymentGateway,
  pluginConfigsEventNotifier,
  type PluginConfigCharge,
  type InsertPluginConfigCharge,
  type PluginConfigBenefitEligibility,
  type InsertPluginConfigBenefitEligibility,
  type PluginConfigDispatch,
  type InsertPluginConfigDispatch,
  type PluginConfigDashboard,
  type InsertPluginConfigDashboard,
  type PluginConfigPaymentGateway,
  type InsertPluginConfigPaymentGateway,
  type PluginConfigEventNotifier,
  type InsertPluginConfigEventNotifier,
  pluginConfigsCron,
  type PluginConfigCron,
  type InsertPluginConfigCron,
} from "@shared/schema";
import { eq, isNull, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgTable, PgColumn } from "drizzle-orm/pg-core";

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
  // Dashboard: the admin "this exact role" filter (`role`) and the render-side
  // "role is one of the viewer's roles" filter (`roleIn`).
  role?: string | null;
  roleIn?: string[];
  // Event-notifier: a single active medium (token-matched against the
  // comma-joined `media` list).
  media?: string | null;
  // Cron: exact cron-expression match (rarely filtered on; present for
  // completeness so the schedule is a real, searchable column).
  schedule?: string;
}

/** `col = val`, or `col IS NULL` when val is explicitly null; skip undefined. */
function eqOrNull(out: SQL[], col: any, val: string | null | undefined): void {
  if (val === undefined) return;
  out.push(val === null ? isNull(col) : eq(col, val));
}

/**
 * Token-aware filter for a comma-joined multi-value column (e.g.
 * `applies_to` storing "start", "continue", or "start,continue"). A
 * single-value filter must match any row whose list *contains* the token,
 * so a plain `eq` would wrongly skip combined-value rows. Comma-wrapping
 * both sides makes the LIKE token-safe (no substring false positives).
 * `null` filters on the absence of any value; `undefined` is skipped.
 */
function containsToken(
  out: SQL[],
  col: PgColumn,
  val: string | null | undefined,
): void {
  if (val === undefined) return;
  if (val === null) {
    out.push(isNull(col));
    return;
  }
  out.push(sql`',' || ${col} || ',' LIKE ${`%,${val},%`}`);
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
      containsToken(out, pluginConfigsBenefitEligibility.appliesTo, params.appliesTo);
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

export function createDashboardSubsidiaryStorage(): SubsidiaryStorage<
  PluginConfigDashboard,
  InsertPluginConfigDashboard
> {
  return {
    table: pluginConfigsDashboard,
    async get(id) {
      const client = getClient();
      const [row] = await client.select().from(pluginConfigsDashboard).where(eq(pluginConfigsDashboard.id, id));
      return row || undefined;
    },
    async upsert(row) {
      const client = getClient();
      const [result] = await client
        .insert(pluginConfigsDashboard)
        .values(row)
        .onConflictDoUpdate({
          target: pluginConfigsDashboard.id,
          set: { role: row.role },
        })
        .returning();
      return result;
    },
    buildConditions(params) {
      const out: SQL[] = [];
      // Admin "this exact role" filter. `role` is NOT NULL, so a null filter is
      // never meaningful — treat only a defined, non-null value as a filter.
      if (params.role !== undefined && params.role !== null) {
        out.push(eq(pluginConfigsDashboard.role, params.role));
      }
      // Render-side "role is one of the viewer's roles". An empty set matches no
      // rows (a user with no roles sees no role-gated widgets).
      if (params.roleIn !== undefined) {
        out.push(
          params.roleIn.length > 0
            ? inArray(pluginConfigsDashboard.role, params.roleIn)
            : sql`false`,
        );
      }
      return out;
    },
  };
}

export function createPaymentGatewaySubsidiaryStorage(): SubsidiaryStorage<
  PluginConfigPaymentGateway,
  InsertPluginConfigPaymentGateway
> {
  return {
    table: pluginConfigsPaymentGateway,
    async get(id) {
      const client = getClient();
      const [row] = await client
        .select()
        .from(pluginConfigsPaymentGateway)
        .where(eq(pluginConfigsPaymentGateway.id, id));
      return row || undefined;
    },
    async upsert(row) {
      const client = getClient();
      // The table has no columns beyond the shared `id` FK, so there is nothing
      // to update on conflict — insert-if-absent, then read the row back.
      await client
        .insert(pluginConfigsPaymentGateway)
        .values(row)
        .onConflictDoNothing();
      const [result] = await client
        .select()
        .from(pluginConfigsPaymentGateway)
        .where(eq(pluginConfigsPaymentGateway.id, row.id));
      return result;
    },
    buildConditions() {
      // No filterable columns yet — the subsidiary exists only as an FK target.
      // The dispatcher still inner-joins it, which is exactly what guarantees a
      // payment-gateway config is returned only once it has a subsidiary row.
      return [];
    },
  };
}

export function createEventNotifierSubsidiaryStorage(): SubsidiaryStorage<
  PluginConfigEventNotifier,
  InsertPluginConfigEventNotifier
> {
  return {
    table: pluginConfigsEventNotifier,
    async get(id) {
      const client = getClient();
      const [row] = await client
        .select()
        .from(pluginConfigsEventNotifier)
        .where(eq(pluginConfigsEventNotifier.id, id));
      return row || undefined;
    },
    async upsert(row) {
      const client = getClient();
      const [result] = await client
        .insert(pluginConfigsEventNotifier)
        .values(row)
        .onConflictDoUpdate({
          target: pluginConfigsEventNotifier.id,
          set: { media: row.media ?? null },
        })
        .returning();
      return result;
    },
    buildConditions(params) {
      const out: SQL[] = [];
      // `media` is a comma-joined multi-value list, so a single-value filter
      // must match any row whose list *contains* the token (token-safe LIKE).
      containsToken(out, pluginConfigsEventNotifier.media, params.media);
      return out;
    },
  };
}

export function createCronSubsidiaryStorage(): SubsidiaryStorage<
  PluginConfigCron,
  InsertPluginConfigCron
> {
  return {
    table: pluginConfigsCron,
    async get(id) {
      const client = getClient();
      const [row] = await client
        .select()
        .from(pluginConfigsCron)
        .where(eq(pluginConfigsCron.id, id));
      return row || undefined;
    },
    async upsert(row) {
      const client = getClient();
      const [result] = await client
        .insert(pluginConfigsCron)
        .values(row)
        .onConflictDoUpdate({
          target: pluginConfigsCron.id,
          set: { schedule: row.schedule },
        })
        .returning();
      return result;
    },
    buildConditions(params) {
      const out: SQL[] = [];
      if (params.schedule !== undefined) out.push(eq(pluginConfigsCron.schedule, params.schedule));
      return out;
    },
  };
}
