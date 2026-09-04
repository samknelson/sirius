import { or, sql, type SQL } from "drizzle-orm";
import { contacts, workers } from "@shared/schema";
import { grievances, grievanceWorkers } from "@shared/schema/grievance/schema";
import { registerQuicksearchPlugin } from "../registry";
import { correlated, type QuicksearchDb } from "../sql";
import type { QuicksearchContext, QuicksearchPlugin, QuicksearchResult } from "../types";

/**
 * A grievance sirius id starts with the filing date, so a short numeric string
 * is a date fragment far more often than it is an identifier. Requiring the
 * full leading date before the clause participates is what keeps typing a year
 * from returning every grievance filed in it.
 */
const MIN_SIRIUS_ID_DIGITS = 8;

/**
 * What the typed string could plausibly BE. Extracted from the query building
 * so the "is this an identifier or just digits?" decision — the one that keeps
 * a year from listing every grievance filed in it — can be pinned by a test.
 */
export interface GrievanceSearchPlan {
  /** Contains-match on the class description. Always applies. */
  classDescription: string;
  /** Contains-match on the name of a worker on the grievance. Always applies. */
  workerName: string;
  /** The whole grievance number, or null when the input is not one. */
  siriusId: string | null;
}

export function planGrievanceSearch(rawQuery: string): GrievanceSearchPlan {
  const query = rawQuery.trim();
  const digits = query.replace(/\D/g, "");
  return {
    classDescription: query,
    workerName: query,
    siriusId: digits.length >= MIN_SIRIUS_ID_DIGITS ? query : null,
  };
}

interface GrievanceRow {
  id: string;
  siriusId: string;
  classDescription: string | null;
  matchedSiriusId: boolean;
  matchedClass: boolean;
  matchedWorker: boolean;
  workerName: string | null;
}

function describeMatch(row: GrievanceRow): string | undefined {
  if (row.matchedSiriusId) return "Grievance number";
  if (row.matchedWorker) return "Worker";
  if (row.matchedClass) return "Class description";
  return undefined;
}

/**
 * The grievance search statement, separated from the plugin so its generated
 * SQL can be asserted on without a database. Correlated references to the
 * grievance being selected go through {@link correlated} — see that helper for
 * why interpolating the column directly is not safe in a select list.
 */
export function buildGrievanceSearchQuery(
  client: QuicksearchDb,
  plan: GrievanceSearchPlan,
  limit: number,
) {
  const query = plan.classDescription;
  const grievanceId = correlated(grievances.id);

  // The whole identifier, never a prefix of one.
  const siriusIdMatch =
    plan.siriusId !== null
      ? sql<boolean>`${grievances.siriusId} = ${plan.siriusId}`
      : sql<boolean>`false`;

  const classMatch = sql<boolean>`${grievances.classDescription} ILIKE ${`%${query}%`}`;

  const workerMatch = sql<boolean>`EXISTS (
    SELECT 1
    FROM ${grievanceWorkers} gw
    JOIN ${workers} w ON w.id = gw.worker_id
    JOIN ${contacts} c ON c.id = w.contact_id
    WHERE gw.grievance_id = ${grievanceId}
      AND c.display_name ILIKE ${`%${plan.workerName}%`}
  )`;

  const clauses: SQL[] = [siriusIdMatch, classMatch, workerMatch];

  return client
    .select({
      id: grievances.id,
      siriusId: grievances.siriusId,
      classDescription: grievances.classDescription,
      matchedSiriusId: siriusIdMatch,
      matchedClass: classMatch,
      matchedWorker: workerMatch,
      // The name of a worker on the grievance, preferring the primary one,
      // so a "matched on worker" row says WHICH worker.
      workerName: sql<string | null>`(
        SELECT c.display_name
        FROM ${grievanceWorkers} gw
        JOIN ${workers} w ON w.id = gw.worker_id
        JOIN ${contacts} c ON c.id = w.contact_id
        WHERE gw.grievance_id = ${grievanceId}
        ORDER BY gw."primary" DESC NULLS LAST, c.display_name
        LIMIT 1
      )`,
    })
    .from(grievances)
    .where(or(...clauses))
    .orderBy(sql`${grievances.siriusId} DESC`)
    // One more than the cap so the runner can report truncation.
    .limit(limit + 1);
}

export const grievanceQuicksearchPlugin: QuicksearchPlugin = {
  id: "grievance",
  name: "Grievances",
  description:
    "Find a grievance by its number, by the name of a worker on it, or by its class description.",
  icon: "gavel",
  // Grievances are an optional component and staff-only: a config naming this
  // searcher simply does not run where either is missing.
  requiredComponent: "grievance",
  requiredPolicy: "staff",
  needsReadOnlyDb: true,

  async search(ctx: QuicksearchContext): Promise<QuicksearchResult[]> {
    const plan = planGrievanceSearch(ctx.query);

    const rows = await ctx.storage.readOnly.query(async (client) =>
      buildGrievanceSearchQuery(client, plan, ctx.limit),
    );

    return rows.map((r) => {
      const row: GrievanceRow = {
        id: r.id,
        siriusId: r.siriusId,
        classDescription: r.classDescription,
        matchedSiriusId: r.matchedSiriusId === true,
        matchedClass: r.matchedClass === true,
        matchedWorker: r.matchedWorker === true,
        workerName: r.workerName ?? null,
      };
      const subtitleParts: string[] = [];
      if (row.workerName) subtitleParts.push(row.workerName);
      if (row.classDescription) subtitleParts.push(row.classDescription);
      return {
        id: row.id,
        title: row.siriusId,
        subtitle: subtitleParts.join(" · ") || null,
        href: `/grievance/${row.id}`,
        matchedOn: describeMatch(row),
      };
    });
  },
};

registerQuicksearchPlugin(grievanceQuicksearchPlugin);
