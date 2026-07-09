import { getClient } from '../../transaction-context';
import { and, eq, asc, sql, getTableName, inArray } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  sitespecificBaoRateSources,
  sitespecificBaoRateSourceEmployers,
  sitespecificBaoEmployerRates,
  type BaoRateSource,
  type InsertBaoRateSource,
  type BaoRateSourceWithDetails,
} from "../../../../shared/schema/sitespecific/bao/schema";
import { employers } from "../../../../shared/schema";
import type { StorageLoggingConfig } from "../../middleware/logging";

export type { BaoRateSource, InsertBaoRateSource };

/** A source plus its employers and calculated per-employer active status
 *  (attachmentCount is composed by the caller from storage.files). */
export type BaoRateSourceListing = Omit<BaoRateSourceWithDetails, "attachmentCount">;

export interface BaoRateSourcesStorage {
  list(): Promise<BaoRateSourceListing[]>;
  get(id: string): Promise<BaoRateSourceListing | undefined>;
  create(
    record: Omit<InsertBaoRateSource, "id">,
    employerIds: string[],
  ): Promise<BaoRateSourceListing>;
  update(
    id: string,
    record: Partial<Pick<InsertBaoRateSource, "name" | "type" | "startYmd">>,
    employerIds?: string[],
  ): Promise<BaoRateSourceListing | undefined>;
  /**
   * Delete a source. Refuses (returns { deleted: false, referenced: true })
   * when any rate row still references it, so history is never silently
   * reactivated by a source deletion.
   */
  delete(id: string): Promise<{ deleted: boolean; referenced: boolean }>;
  /**
   * Of the given employer ids, return those NOT associated with the source.
   * Used by rate write paths to enforce that a rate row's sourceId belongs
   * to that row's employer. Returns all ids when the source does not exist.
   */
  missingEmployerAssociations(sourceId: string, employerIds: string[]): Promise<string[]>;
  tableExists(): Promise<boolean>;
}

const tableName = getTableName(sitespecificBaoRateSources);

function todayYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Enrich raw source rows with employer associations and calculated status.
 * A source is active for an employer when no other source associated with
 * that employer has a strictly later start date that is on/before today.
 */
async function enrich(sources: BaoRateSource[]): Promise<BaoRateSourceListing[]> {
  if (sources.length === 0) return [];
  const client = getClient();
  const sourceIds = sources.map((s) => s.id);

  const assocRows = await client
    .select({
      sourceId: sitespecificBaoRateSourceEmployers.sourceId,
      employerId: sitespecificBaoRateSourceEmployers.employerId,
      employerName: employers.name,
    })
    .from(sitespecificBaoRateSourceEmployers)
    .innerJoin(employers, eq(employers.id, sitespecificBaoRateSourceEmployers.employerId))
    .where(inArray(sitespecificBaoRateSourceEmployers.sourceId, sourceIds))
    .orderBy(asc(employers.name));

  // For status we need ALL associations touching the employers involved, not
  // just the requested sources (a source outside `sources` can supersede).
  const employerIds = Array.from(new Set(assocRows.map((r) => r.employerId)));
  const allAssoc = employerIds.length
    ? await client
        .select({
          sourceId: sitespecificBaoRateSourceEmployers.sourceId,
          employerId: sitespecificBaoRateSourceEmployers.employerId,
          startYmd: sitespecificBaoRateSources.startYmd,
        })
        .from(sitespecificBaoRateSourceEmployers)
        .innerJoin(
          sitespecificBaoRateSources,
          eq(sitespecificBaoRateSources.id, sitespecificBaoRateSourceEmployers.sourceId),
        )
        .where(inArray(sitespecificBaoRateSourceEmployers.employerId, employerIds))
    : [];

  const byEmployer = new Map<string, { sourceId: string; startYmd: string }[]>();
  for (const row of allAssoc) {
    const list = byEmployer.get(row.employerId) ?? [];
    list.push({ sourceId: row.sourceId, startYmd: row.startYmd });
    byEmployer.set(row.employerId, list);
  }

  const today = todayYmd();
  return sources.map((source) => {
    const myAssoc = assocRows.filter((r) => r.sourceId === source.id);
    const activeForEmployerIds: string[] = [];
    for (const a of myAssoc) {
      const others = byEmployer.get(a.employerId) ?? [];
      const superseded = others.some(
        (o) =>
          o.sourceId !== source.id &&
          o.startYmd > source.startYmd &&
          o.startYmd <= today,
      );
      if (!superseded) activeForEmployerIds.push(a.employerId);
    }
    return {
      ...source,
      employers: myAssoc.map((a) => ({ id: a.employerId, name: a.employerName })),
      activeForEmployerIds,
      isActive: activeForEmployerIds.length > 0,
    };
  });
}

export function createBaoRateSourcesStorage(): BaoRateSourcesStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async list(): Promise<BaoRateSourceListing[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const sources = await client
        .select()
        .from(sitespecificBaoRateSources)
        .orderBy(asc(sitespecificBaoRateSources.startYmd), asc(sitespecificBaoRateSources.name));
      return enrich(sources);
    },

    async get(id: string): Promise<BaoRateSourceListing | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const sources = await client
        .select()
        .from(sitespecificBaoRateSources)
        .where(eq(sitespecificBaoRateSources.id, id));
      if (sources.length === 0) return undefined;
      const [result] = await enrich(sources);
      return result;
    },

    async create(
      record: Omit<InsertBaoRateSource, "id">,
      employerIds: string[],
    ): Promise<BaoRateSourceListing> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const [source] = await client
        .insert(sitespecificBaoRateSources)
        .values(record)
        .returning();
      if (employerIds.length > 0) {
        await client
          .insert(sitespecificBaoRateSourceEmployers)
          .values(employerIds.map((employerId) => ({ sourceId: source.id, employerId })))
          .onConflictDoNothing();
      }
      const [result] = await enrich([source]);
      return result;
    },

    async update(
      id: string,
      record: Partial<Pick<InsertBaoRateSource, "name" | "type" | "startYmd">>,
      employerIds?: string[],
    ): Promise<BaoRateSourceListing | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      let source: BaoRateSource | undefined;
      if (Object.keys(record).length > 0) {
        const results = await client
          .update(sitespecificBaoRateSources)
          .set(record)
          .where(eq(sitespecificBaoRateSources.id, id))
          .returning();
        source = results[0];
      } else {
        const results = await client
          .select()
          .from(sitespecificBaoRateSources)
          .where(eq(sitespecificBaoRateSources.id, id));
        source = results[0];
      }
      if (!source) return undefined;

      if (employerIds) {
        const wanted = new Set(employerIds);
        const existing = await client
          .select({ employerId: sitespecificBaoRateSourceEmployers.employerId })
          .from(sitespecificBaoRateSourceEmployers)
          .where(eq(sitespecificBaoRateSourceEmployers.sourceId, id));
        const existingIds = new Set(existing.map((r) => r.employerId));
        const toAdd = employerIds.filter((e) => !existingIds.has(e));
        const toRemove = Array.from(existingIds).filter((e) => !wanted.has(e));
        if (toAdd.length > 0) {
          await client
            .insert(sitespecificBaoRateSourceEmployers)
            .values(toAdd.map((employerId) => ({ sourceId: id, employerId })))
            .onConflictDoNothing();
        }
        if (toRemove.length > 0) {
          await client
            .delete(sitespecificBaoRateSourceEmployers)
            .where(
              and(
                eq(sitespecificBaoRateSourceEmployers.sourceId, id),
                inArray(sitespecificBaoRateSourceEmployers.employerId, toRemove),
              ),
            );
        }
      }

      const [result] = await enrich([source]);
      return result;
    },

    async missingEmployerAssociations(
      sourceId: string,
      employerIds: string[],
    ): Promise<string[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      if (employerIds.length === 0) return [];
      const client = getClient();
      const rows = await client
        .select({ employerId: sitespecificBaoRateSourceEmployers.employerId })
        .from(sitespecificBaoRateSourceEmployers)
        .where(
          and(
            eq(sitespecificBaoRateSourceEmployers.sourceId, sourceId),
            inArray(sitespecificBaoRateSourceEmployers.employerId, employerIds),
          ),
        );
      const associated = new Set(rows.map((r) => r.employerId));
      return employerIds.filter((id) => !associated.has(id));
    },

    async delete(id: string): Promise<{ deleted: boolean; referenced: boolean }> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const refs = await client
        .select({ count: sql<number>`count(*)::int` })
        .from(sitespecificBaoEmployerRates)
        .where(eq(sitespecificBaoEmployerRates.sourceId, id));
      if ((refs[0]?.count ?? 0) > 0) {
        return { deleted: false, referenced: true };
      }
      const results = await client
        .delete(sitespecificBaoRateSources)
        .where(eq(sitespecificBaoRateSources.id, id))
        .returning({ id: sitespecificBaoRateSources.id });
      return { deleted: results.length > 0, referenced: false };
    },
  };
}

export const baoRateSourcesLoggingConfig: StorageLoggingConfig<BaoRateSourcesStorage> = {
  module: 'sitespecific.bao.rate-sources',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id,
      getDescription: (args, result) =>
        `Created BAO rate source "${result?.name}" (${result?.type}) starting ${result?.startYmd}`,
    },
    update: {
      enabled: true,
      before: async (args, storage) => storage.get(args[0]),
      getEntityId: (args) => args[0],
      getDescription: (args, result) =>
        `Updated BAO rate source "${result?.name}"`,
    },
    delete: {
      enabled: true,
      before: async (args, storage) => storage.get(args[0]),
      getEntityId: (args) => args[0],
      getDescription: () => `Deleted BAO rate source`,
    },
  },
};
