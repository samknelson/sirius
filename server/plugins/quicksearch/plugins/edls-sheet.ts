import { and, asc, eq, gte, ne, or, sql, type SQL } from "drizzle-orm";
import {
  contacts,
  dispatchJobGroups,
  edlsAssignments,
  edlsCrews,
  edlsSheets,
  facilities,
  optionsDepartment,
  optionsWorkerIdType,
  workerIds,
  workers,
} from "@shared/schema";
import type { JsonSchema } from "@shared/json-schema-form";
import { formatYmd, getTodayYmd } from "@shared/utils/date";
import { createUnifiedOptionsStorage } from "../../../storage/unified-options";
import { isComponentEnabledSync } from "../../../services/component-cache";
import { registerQuicksearchPlugin } from "../registry";
import type { QuicksearchContext, QuicksearchPlugin, QuicksearchResult } from "../types";

/**
 * The wording the sheets list shows for a sheet's own status. Kept in step
 * with `client/src/pages/edls/sheets.tsx` so a result reports a sheet the same
 * way the list a user came from does.
 */
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  request: "Requested",
  lock: "Scheduled",
  reserved: "Reserved",
  trash: "Trash",
};

/**
 * What the typed string could plausibly BE for a sheet search.
 *
 * A title and a worker's name are prose: they always contains-match. A worker
 * identifier is not — it participates only when an administrator named the id
 * types to look in, and it is compared WHOLE. A partial identifier is not an
 * identifier, so typing digits can never walk the identifier column.
 */
export interface EdlsSheetSearchPlan {
  /** Contains-match on the sheet title. Always applies. */
  title: string;
  /** Contains-match on the name of a worker assigned to the sheet. Always applies. */
  workerName: string;
  /** Configured id types to look in — empty means the clause is dropped. */
  workerIdTypeIds: string[];
  /** The exact identifier to look for, or null when the clause is dropped. */
  workerIdValue: string | null;
}

export interface EdlsSheetSearchSettings {
  idTypeIds?: unknown;
}

/**
 * Decide which clauses the input could satisfy.
 *
 * `settings` arrives from the runner as plain configuration — nothing this
 * searcher reads is permission-gated, so there is nothing to re-derive here.
 */
export function planEdlsSheetSearch(
  rawQuery: string,
  settings: EdlsSheetSearchSettings,
): EdlsSheetSearchPlan {
  const query = rawQuery.trim();
  const idTypeIds = Array.isArray(settings.idTypeIds)
    ? settings.idTypeIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];

  // A worker ID matches exactly. There is deliberately no prefix search.
  const workerIdValue = idTypeIds.length > 0 && query.length > 0 ? query : null;

  return {
    title: query,
    workerName: query,
    workerIdTypeIds: idTypeIds,
    workerIdValue,
  };
}

/**
 * The worker id types an administrator may switch on, offered as a live enum
 * so the form lists the site's own id types rather than free text. Worded like
 * the worker searcher's equivalent, because it behaves the same way.
 */
async function settingsSchema(): Promise<JsonSchema> {
  const types = await createUnifiedOptionsStorage().list("worker-id-type");
  const idTypes = (Array.isArray(types) ? types : []) as Array<{ id: string; name: string }>;
  return {
    type: "object",
    properties: {
      idTypeIds: {
        type: "array",
        title: "Worker ID types to search",
        description:
          "A sheet is found when a worker on it carries one of these identifiers. Identifiers are matched exactly — a partial identifier finds nothing.",
        items: {
          type: "string",
          oneOf: idTypes.map((t) => ({ const: t.id, title: t.name })),
        },
        uniqueItems: true,
        default: [],
      },
    },
    additionalProperties: false,
  } as JsonSchema;
}

interface SheetRow {
  id: string;
  title: string;
  ymd: string;
  status: string;
  departmentName: string | null;
  jobGroupName: string | null;
  facilityName: string | null;
  matchedTitle: boolean;
  matchedWorkerName: boolean;
  matchedWorkerId: boolean;
  workerName: string | null;
  idTypeName: string | null;
}

/**
 * Which clause to report. A sheet can satisfy several at once; report the most
 * specific, because that is the one that explains a surprising hit.
 */
function describeMatch(row: SheetRow): string | undefined {
  if (row.matchedWorkerId) return row.idTypeName ?? "Worker ID";
  if (row.matchedWorkerName) return row.workerName ?? "Worker";
  if (row.matchedTitle) return "Title";
  return undefined;
}

export const edlsSheetQuicksearchPlugin: QuicksearchPlugin = {
  id: "edls-sheet",
  name: "EDLS Sheets",
  description:
    "Find an upcoming EDLS sheet by its title, by the name of a worker assigned to it, or by a configured worker ID type.",
  icon: "calendar-days",
  // EDLS is an optional component, and the sheets list itself is behind
  // `edls.any`: a config naming this searcher simply does not run where either
  // is missing.
  requiredComponent: "edls",
  requiredPolicy: "edls.any",
  needsReadOnlyDb: true,
  settingsSchema,

  async search(ctx: QuicksearchContext): Promise<QuicksearchResult[]> {
    const plan = planEdlsSheetSearch(ctx.query, ctx.settings as EdlsSheetSearchSettings);
    const contains = `%${plan.title}%`;

    const titleMatch = sql<boolean>`${edlsSheets.title} ILIKE ${contains}`;

    // Workers are reached through the sheet's crews and their assignments as
    // an EXISTS check, so a sheet comes back ONCE however many of its workers
    // match.
    const workerNameMatch = sql<boolean>`EXISTS (
      SELECT 1
      FROM ${edlsCrews} c
      JOIN ${edlsAssignments} a ON a.crew_id = c.id
      JOIN ${workers} w ON w.id = a.worker_id
      JOIN ${contacts} ct ON ct.id = w.contact_id
      WHERE c.sheet_id = ${edlsSheets.id}
        AND ct.display_name ILIKE ${contains}
    )`;

    const idTypeList =
      plan.workerIdTypeIds.length > 0
        ? sql.join(
            plan.workerIdTypeIds.map((id) => sql`${id}`),
            sql`, `,
          )
        : null;

    const workerIdMatch =
      plan.workerIdValue !== null && idTypeList !== null
        ? sql<boolean>`EXISTS (
            SELECT 1
            FROM ${edlsCrews} c
            JOIN ${edlsAssignments} a ON a.crew_id = c.id
            JOIN ${workerIds} wi ON wi.worker_id = a.worker_id
            WHERE c.sheet_id = ${edlsSheets.id}
              AND wi.type_id IN (${idTypeList})
              AND wi.value = ${plan.workerIdValue}
          )`
        : sql<boolean>`false`;

    // The name of a matching worker, so a "matched on worker" row says WHICH
    // worker it was.
    const matchedWorkerName = sql<string | null>`(
      SELECT ct.display_name
      FROM ${edlsCrews} c
      JOIN ${edlsAssignments} a ON a.crew_id = c.id
      JOIN ${workers} w ON w.id = a.worker_id
      JOIN ${contacts} ct ON ct.id = w.contact_id
      WHERE c.sheet_id = ${edlsSheets.id}
        AND ct.display_name ILIKE ${contains}
      ORDER BY ct.display_name
      LIMIT 1
    )`;

    const matchedIdTypeName =
      plan.workerIdValue !== null && idTypeList !== null
        ? sql<string | null>`(
            SELECT t.name
            FROM ${edlsCrews} c
            JOIN ${edlsAssignments} a ON a.crew_id = c.id
            JOIN ${workerIds} wi ON wi.worker_id = a.worker_id
            JOIN ${optionsWorkerIdType} t ON t.id = wi.type_id
            WHERE c.sheet_id = ${edlsSheets.id}
              AND wi.type_id IN (${idTypeList})
              AND wi.value = ${plan.workerIdValue}
            ORDER BY t.name
            LIMIT 1
          )`
        : sql<string | null>`NULL::text`;

    // The job group table belongs to the `dispatch.job_group` component and
    // may not exist at all when it is off, so it is only referenced when it is
    // on — the same rule the sheets storage follows.
    const jobGroupName = isComponentEnabledSync("dispatch.job_group")
      ? sql<string | null>`(
          SELECT jg.name FROM ${dispatchJobGroups} jg WHERE jg.id = ${edlsSheets.jobGroupId}
        )`
      : sql<string | null>`NULL::text`;

    const clauses: SQL[] = [titleMatch, workerNameMatch, workerIdMatch];

    // "Today or later" comes from the shared helper rather than the database's
    // `now()`, so the window is the application's day, not the server's.
    const today = getTodayYmd();

    const rows = await ctx.storage.readOnly.query(async (client) =>
      client
        .select({
          id: edlsSheets.id,
          title: edlsSheets.title,
          ymd: edlsSheets.ymd,
          status: edlsSheets.status,
          departmentName: optionsDepartment.name,
          facilityName: facilities.name,
          jobGroupName,
          matchedTitle: titleMatch,
          matchedWorkerName: workerNameMatch,
          matchedWorkerId: workerIdMatch,
          workerName: matchedWorkerName,
          idTypeName: matchedIdTypeName,
        })
        .from(edlsSheets)
        .leftJoin(optionsDepartment, eq(edlsSheets.departmentId, optionsDepartment.id))
        .leftJoin(facilities, eq(edlsSheets.facilityId, facilities.id))
        .where(
          and(
            or(...clauses),
            // Never a past sheet, whatever was typed.
            gte(edlsSheets.ymd, today),
            ne(edlsSheets.status, "trash"),
          ),
        )
        // Soonest first: the sheet a user is jumping to is the next one.
        .orderBy(asc(edlsSheets.ymd), asc(edlsSheets.title))
        // One more than the cap so the runner can report truncation.
        .limit(ctx.limit + 1),
    );

    return rows.map((r) => {
      const row: SheetRow = {
        id: r.id,
        title: r.title,
        ymd: r.ymd,
        status: r.status,
        departmentName: r.departmentName ?? null,
        jobGroupName: r.jobGroupName ?? null,
        facilityName: r.facilityName ?? null,
        matchedTitle: r.matchedTitle === true,
        matchedWorkerName: r.matchedWorkerName === true,
        matchedWorkerId: r.matchedWorkerId === true,
        workerName: r.workerName ?? null,
        idTypeName: r.idTypeName ?? null,
      };

      const subtitleParts: string[] = [formatYmd(row.ymd, "short")];
      if (row.departmentName) subtitleParts.push(row.departmentName);
      if (row.jobGroupName) subtitleParts.push(row.jobGroupName);
      if (row.facilityName) subtitleParts.push(row.facilityName);

      return {
        id: row.id,
        title: row.title,
        subtitle: subtitleParts.join(" · "),
        badges: [STATUS_LABELS[row.status] ?? row.status],
        href: `/edls/sheet/${row.id}`,
        matchedOn: describeMatch(row),
      };
    });
  },
};

registerQuicksearchPlugin(edlsSheetQuicksearchPlugin);
