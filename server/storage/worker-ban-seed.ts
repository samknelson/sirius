import { sql } from "drizzle-orm";
import { db } from "./db";
import { logger } from "../logger";
import {
  DISPATCH_BAN_TYPE_SIRIUS_ID,
  LEGACY_DISPATCH_TYPE,
} from "../plugins/worker-bans/service";

const SEED_LOCK_KEY = 8_402_026_091_701;
const SERVICE = "worker-ban-seed";
const APPROVED_TYPE_FORMATS = new Set([
  "character varying",
  "text",
]);

export interface WorkerBanSeedPreflight {
  typeColumn: {
    dataType: string;
    udtName: string;
    nullable: boolean;
    maxLength: number | null;
  } | null;
  constraints: Array<{ name: string; definition: string }>;
  triggers: Array<{ name: string; definition: string }>;
  dispatchOptions: Array<{ id: string; name: string; data: unknown }>;
  legacyDispatchCount: number;
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

function countOf(result: unknown): number {
  const value = rowsOf<{ count: string | number }>(result)[0]?.count ?? 0;
  return Number(value);
}

/** Read-only live-schema evidence used by startup and the recovery runbook. */
export async function preflightWorkerBanSeed(
  client: Pick<typeof db, "execute"> = db,
): Promise<WorkerBanSeedPreflight> {
  const columnResult = await client.execute(sql`
    SELECT data_type AS "dataType", udt_name AS "udtName",
           is_nullable = 'YES' AS nullable,
           character_maximum_length AS "maxLength"
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'worker_bans'
       AND column_name = 'type'
  `);
  const constraintResult = await client.execute(sql`
    SELECT c.conname AS name, pg_get_constraintdef(c.oid, true) AS definition
      FROM pg_constraint c
     WHERE c.conrelid = to_regclass('public.worker_bans')
     ORDER BY c.conname
  `);
  const triggerResult = await client.execute(sql`
    SELECT t.tgname AS name, pg_get_triggerdef(t.oid, true) AS definition
      FROM pg_trigger t
     WHERE t.tgrelid = to_regclass('public.worker_bans')
       AND NOT t.tgisinternal
     ORDER BY t.tgname
  `);
  const optionResult = await client.execute(sql`
    SELECT id, name, data
      FROM options_worker_ban_type
     WHERE sirius_id = ${DISPATCH_BAN_TYPE_SIRIUS_ID}
     ORDER BY id
  `);
  const typeColumn =
    rowsOf<WorkerBanSeedPreflight["typeColumn"]>(columnResult)[0] ?? null;
  const legacyResult = typeColumn
    ? await client.execute(sql`
        SELECT count(*)::text AS count
          FROM worker_bans
         WHERE type::text = ${LEGACY_DISPATCH_TYPE}
      `)
    : null;

  return {
    typeColumn,
    constraints: rowsOf<WorkerBanSeedPreflight["constraints"][number]>(constraintResult),
    triggers: rowsOf<WorkerBanSeedPreflight["triggers"][number]>(triggerResult),
    dispatchOptions: rowsOf<WorkerBanSeedPreflight["dispatchOptions"][number]>(optionResult),
    legacyDispatchCount: legacyResult ? countOf(legacyResult) : 0,
  };
}

function hasCanonicalDispatchBehavior(option: { data: unknown }): boolean {
  const pluginIds = (option.data as { pluginIds?: unknown } | null)?.pluginIds;
  return (
    Array.isArray(pluginIds) &&
    pluginIds.includes("all-dispatch")
  );
}

function remediationFor(report: WorkerBanSeedPreflight): string | null {
  if (!report.typeColumn) {
    return "worker_bans.type is missing. Restore it as nullable varchar before retrying; do not rerun or roll back the Sirius ID migration.";
  }
  if (!APPROVED_TYPE_FORMATS.has(report.typeColumn.dataType)) {
    return `worker_bans.type is ${report.typeColumn.dataType} (${report.typeColumn.udtName}), not the declared soft-reference varchar model. Review its values, constraints, and triggers, then alter it to nullable varchar in a separately approved repair; do not coerce values during startup.`;
  }
  if (
    report.typeColumn.maxLength !== null &&
    Math.max(36, ...report.dispatchOptions.map((option) => option.id.length)) >
      report.typeColumn.maxLength
  ) {
    return `worker_bans.type varchar(${report.typeColumn.maxLength}) cannot hold the canonical Dispatch option ID. Widen it to varchar in a separately approved repair.`;
  }
  if (report.dispatchOptions.length > 1) {
    return "More than one option has sirius_id DISPATCH. Select one canonical row and repair duplicates in a separately approved data change.";
  }
  if (
    report.dispatchOptions.length === 1 &&
    !hasCanonicalDispatchBehavior(report.dispatchOptions[0])
  ) {
    return "The canonical DISPATCH option does not include the all-dispatch behavior. Repair that option in a separately approved data change before converting legacy rows.";
  }
  return null;
}

function databaseErrorDetails(error: unknown): Record<string, unknown> {
  const e = error as Record<string, unknown> | null;
  return {
    message: error instanceof Error ? error.message : String(error),
    code: e?.code,
    detail: e?.detail,
    hint: e?.hint,
    constraint: e?.constraint,
    table: e?.table,
    column: e?.column,
    dataType: e?.dataType,
    where: e?.where,
  };
}

/**
 * Best-effort boot cleanup. Legacy literal `dispatch` remains enforced by
 * resolveBanType throughout recovery, so an incompatible historical schema
 * is diagnosed but does not take the otherwise healthy application offline.
 */
export async function seedWorkerBanTypes(): Promise<void> {
  let lastReport: WorkerBanSeedPreflight | undefined;
  try {
    const completed = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY})`);
      lastReport = await preflightWorkerBanSeed(tx as Pick<typeof db, "execute">);

      const remediation = remediationFor(lastReport);
      if (remediation) {
        logger.error("Worker-ban legacy conversion skipped: incompatible live schema or data", {
          service: SERVICE,
          preflight: lastReport,
          remediation,
        });
        return null;
      }

      let dispatchTypeId = lastReport.dispatchOptions[0]?.id;
      if (!dispatchTypeId) {
        const created = await tx.execute(sql`
          INSERT INTO options_worker_ban_type (name, description, sirius_id, data)
          VALUES (
            'Dispatch',
            'Bans the worker from accepting any dispatch job.',
            ${DISPATCH_BAN_TYPE_SIRIUS_ID},
            '{"pluginIds":["all-dispatch"]}'::jsonb
          )
          RETURNING id
        `);
        dispatchTypeId = rowsOf<{ id: string }>(created)[0]?.id;
      }
      if (!dispatchTypeId) throw new Error("Dispatch option insert returned no ID");

      const converted = await tx.execute(sql`
        UPDATE worker_bans
           SET type = ${dispatchTypeId}
         WHERE type::text = ${LEGACY_DISPATCH_TYPE}
         RETURNING id, type
      `);
      const convertedRows = rowsOf<{ id: string; type: string | null }>(converted);
      const wrongRows = convertedRows.filter((row) => row.type !== dispatchTypeId);
      if (
        convertedRows.length !== lastReport.legacyDispatchCount ||
        wrongRows.length > 0
      ) {
        throw new Error(
          "worker_bans update was suppressed or altered by a live trigger/rule: " +
            `expected ${lastReport.legacyDispatchCount} canonical rows, ` +
            `received ${convertedRows.length} (${wrongRows.length} with a different type)`,
        );
      }
      const remainingLegacy = await tx.execute(sql`
        SELECT count(*)::text AS count
          FROM worker_bans
         WHERE type::text = ${LEGACY_DISPATCH_TYPE}
      `);
      if (countOf(remainingLegacy) !== 0) {
        throw new Error(
          "Legacy dispatch rows remain after conversion; a live trigger/rule changed the update",
        );
      }
      if (convertedRows.length > 0) {
        const convertedIds = sql.join(
          convertedRows.map((row) => sql`${row.id}`),
          sql`, `,
        );
        const committedImages = await tx.execute(sql`
          SELECT id, type
            FROM worker_bans
           WHERE id IN (${convertedIds})
           FOR UPDATE
        `);
        const finalRows = rowsOf<{ id: string; type: string | null }>(committedImages);
        if (
          finalRows.length !== convertedRows.length ||
          finalRows.some((row) => row.type !== dispatchTypeId)
        ) {
          throw new Error(
            "A live AFTER trigger/rule changed or deleted a converted worker ban; conversion was rolled back",
          );
        }
      }
      const finalOption = await tx.execute(sql`
        SELECT id, data
          FROM options_worker_ban_type
         WHERE id = ${dispatchTypeId}
           AND sirius_id = ${DISPATCH_BAN_TYPE_SIRIUS_ID}
         FOR SHARE
      `);
      const canonical = rowsOf<{ id: string; data: unknown }>(finalOption)[0];
      if (!canonical || !hasCanonicalDispatchBehavior(canonical)) {
        throw new Error(
          "The canonical Dispatch option changed during conversion; conversion was rolled back",
        );
      }
      return {
        dispatchTypeId,
        migrated: convertedRows.length,
        preflight: lastReport,
      };
    });
    if (completed) {
      logger.info("Worker-ban Dispatch seed completed", {
        service: SERVICE,
        ...completed,
      });
    }
  } catch (error) {
    // Enforcement remains safe: service.ts maps the legacy literal directly
    // to all-dispatch. Include the underlying PG fields and preflight so an
    // operator can distinguish a trigger/check/shape issue from a race.
    logger.error("Worker-ban legacy conversion failed; legacy Dispatch enforcement remains active", {
      service: SERVICE,
      error: databaseErrorDetails(error),
      preflight: lastReport,
      remediation:
        "Inspect the named constraint/trigger and run the read-only preflight. Apply only the reviewed worker_bans.type schema repair, then restart; do not roll back the Sirius ID authority migration.",
    });
  }
}
