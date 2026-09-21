import { getClient } from "../transaction-context";
import { sql } from "drizzle-orm";
import { getAvailableWorkersForSheetQuery } from "./available-workers-query";

export interface EdlsWorkerDirectoryParams {
  page?: number;
  pageSize?: number;
  name?: string;
  active?: boolean;
  memberStatusId?: string;
  idTypeId?: string;
  idValue?: string;
  ratingId?: string;
  ratingValue?: number;
  currentAssignment?: "include" | "exclude";
  nextAssignment?: "include" | "exclude";
  industryId?: string | null;
  referenceYmd: string;
}

export interface EdlsWorkerDirectoryIdType {
  id: string;
  name: string;
}

export interface EdlsWorkerDirectoryRow {
  id: string;
  siriusId: number | null;
  displayName: string | null;
  given: string | null;
  family: string | null;
  active: boolean;
  memberStatusId: string | null;
  memberStatusCode: string | null;
  memberStatusName: string | null;
  memberStatusSequence: number | null;
  priorStatus: string | null;
  currentStatus: string | null;
  nextStatus: string | null;
  ratingValue: number | null;
  ids: Record<string, string>;
}

export interface EdlsWorkerDirectoryResult {
  rows: EdlsWorkerDirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  idTypes: EdlsWorkerDirectoryIdType[];
}

export interface EdlsWorkerDirectoryStorage {
  list(params: EdlsWorkerDirectoryParams): Promise<EdlsWorkerDirectoryResult>;
}

export function createEdlsWorkerDirectoryStorage(): EdlsWorkerDirectoryStorage {
  return {
    async list(params) {
      const client = getClient();
      const page = Math.max(1, params.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
      const offset = (page - 1) * pageSize;
      const conditions = [];

      if (params.name?.trim()) {
        const name = `%${params.name.trim()}%`;
        conditions.push(sql`(c.display_name ILIKE ${name} OR c.given ILIKE ${name} OR c.family ILIKE ${name})`);
      }
      if (params.active !== undefined) conditions.push(sql`COALESCE(we.active, false) = ${params.active}`);
      if (params.memberStatusId && params.industryId) {
        conditions.push(sql`member_status.id = ${params.memberStatusId}`);
      }
      if (params.idTypeId || params.idValue?.trim()) {
        conditions.push(sql`EXISTS (
          SELECT 1 FROM worker_ids filter_wi
          INNER JOIN options_worker_id_type filter_wit ON filter_wit.id = filter_wi.type_id
          WHERE filter_wi.worker_id = w.id
            AND (filter_wit.data->>'showOnLists')::boolean = true
            ${params.idTypeId ? sql`AND filter_wi.type_id = ${params.idTypeId}` : sql``}
            ${params.idValue?.trim() ? sql`AND filter_wi.value ILIKE ${`%${params.idValue.trim()}%`}` : sql``}
        )`);
      }
      if (params.ratingId && params.ratingValue !== undefined) {
        conditions.push(sql`selected_rating.value >= ${params.ratingValue}`);
      }
      if (params.currentAssignment) {
        const exists = sql`EXISTS (
          SELECT 1
          FROM edls_assignments filter_ea
          WHERE filter_ea.worker_id = w.id AND filter_ea.ymd = ${params.referenceYmd}
        )`;
        conditions.push(params.currentAssignment === "include" ? exists : sql`NOT ${exists}`);
      }
      if (params.nextAssignment) {
        const exists = sql`EXISTS (
          SELECT 1
          FROM edls_assignments filter_ea
          WHERE filter_ea.worker_id = w.id AND filter_ea.ymd > ${params.referenceYmd}
        )`;
        conditions.push(params.nextAssignment === "include" ? exists : sql`NOT ${exists}`);
      }
      const where = conditions.length
        ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
        : sql``;
      const ratingJoin = params.ratingId
        ? sql`LEFT JOIN worker_ratings selected_rating
             ON selected_rating.worker_id = w.id AND selected_rating.rating_id = ${params.ratingId}`
        : sql``;
      const ratingSelect = params.ratingId
        ? sql`selected_rating.value`
        : sql`NULL::integer`;
      const memberStatusJoin = params.industryId
        ? sql`LEFT JOIN LATERAL (
            SELECT ms.id, ms.code, ms.name, ms.sequence
            FROM worker_msh_denorm wmd
            INNER JOIN options_worker_ms ms
              ON ms.id = wmd.ms_id AND ms.industry_id = ${params.industryId}
            WHERE wmd.worker_id = w.id
            LIMIT 1
          ) member_status ON true`
        : sql``;
      const memberStatusSelect = params.industryId
        ? sql`member_status.id AS "memberStatusId", member_status.code AS "memberStatusCode",
              member_status.name AS "memberStatusName", member_status.sequence AS "memberStatusSequence"`
        : sql`NULL::varchar AS "memberStatusId", NULL::varchar AS "memberStatusCode",
              NULL::varchar AS "memberStatusName", NULL::integer AS "memberStatusSequence"`;
      const countResult = await client.execute(sql`
        SELECT COUNT(*)::integer AS count
        FROM workers w
        INNER JOIN contacts c ON c.id = w.contact_id
        LEFT JOIN worker_edls we ON we.worker_id = w.id
        ${ratingJoin}
        ${memberStatusJoin}
        ${where}
      `);
      const total = Number((countResult.rows[0] as { count?: number } | undefined)?.count ?? 0);

      const result = await client.execute(sql`
        SELECT
          w.id,
          w.sirius_id AS "siriusId",
          c.display_name AS "displayName",
          c.given,
          c.family,
          COALESCE(we.active, false) AS active,
          ${memberStatusSelect},
          ${ratingSelect} AS "ratingValue",
          COALESCE((
            SELECT jsonb_object_agg(wi.type_id, wi.value)
            FROM worker_ids wi
            INNER JOIN options_worker_id_type wit ON wit.id = wi.type_id
            WHERE wi.worker_id = w.id
              AND (wit.data->>'showOnLists')::boolean = true
          ), '{}'::jsonb) AS ids
        FROM workers w
        INNER JOIN contacts c ON c.id = w.contact_id
        LEFT JOIN worker_edls we ON we.worker_id = w.id
        ${ratingJoin}
        ${memberStatusJoin}
        ${where}
        ORDER BY c.family NULLS LAST, c.given NULLS LAST, w.id
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      const workersWithAssignments = await getAvailableWorkersForSheetQuery(
        params.referenceYmd,
        null,
        undefined,
        true,
      );
      const assignmentStatuses = new Map(
        workersWithAssignments.map((worker) => [worker.id, worker] as const),
      );

      const idTypesResult = await client.execute(sql`
        SELECT id, name
        FROM options_worker_id_type
        WHERE (data->>'showOnLists')::boolean = true
        ORDER BY sequence, name
      `);
      const idTypes = idTypesResult.rows as unknown as EdlsWorkerDirectoryIdType[];
      const rows = result.rows.map((row) => {
        const value = row as unknown as EdlsWorkerDirectoryRow;
        const statuses = assignmentStatuses.get(value.id);
        return {
          id: value.id,
          siriusId: value.siriusId,
          displayName: value.displayName,
          given: value.given,
          family: value.family,
          active: Boolean(value.active),
          memberStatusId: value.memberStatusId ?? null,
          memberStatusCode: value.memberStatusCode ?? null,
          memberStatusName: value.memberStatusName ?? null,
          memberStatusSequence: value.memberStatusSequence ?? null,
          priorStatus: statuses?.priorStatus ?? null,
          currentStatus: statuses?.currentStatus ?? null,
          nextStatus: statuses?.nextStatus ?? null,
          ratingValue: value.ratingValue,
          ids: (value.ids ?? {}) as Record<string, string>,
        };
      });
      return {
        rows,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        idTypes,
      };
    },
  };
}