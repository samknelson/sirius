import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1116";

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS exists
  `);
  const v = result.rows[0]?.exists;
  return v === true || v === "t";
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) AS exists
  `);
  const v = result.rows[0]?.exists;
  return v === true || v === "t";
}

async function constraintExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND constraint_name = ${name}
    ) AS exists
  `);
  const v = result.rows[0]?.exists;
  return v === true || v === "t";
}

async function up(): Promise<void> {
  // 1) Add the nullable source-relation column.
  if (!(await columnExists("trust_wmb", "source_relation_id"))) {
    await db.execute(sql`ALTER TABLE trust_wmb ADD COLUMN source_relation_id varchar`);
    logger.info("Added trust_wmb.source_relation_id", { service: SERVICE });
  }

  // worker_relations is owned by the optional worker.relations component and
  // may be absent from a deployment. The FK and the backfill only make sense
  // (and are only possible) when it exists.
  const hasRelations = await tableExists("worker_relations");
  if (!hasRelations) {
    logger.info(
      "worker_relations table absent (worker.relations component not enabled); skipping FK + backfill",
      { service: SERVICE },
    );
    return;
  }

  // 2) DB-level FK: a deleted relation clears the pointer rather than
  // blocking the delete or orphaning a dangling id.
  const fkName = "trust_wmb_source_relation_id_worker_relations_id_fk";
  if (!(await constraintExists(fkName))) {
    await db.execute(sql`
      ALTER TABLE trust_wmb
      ADD CONSTRAINT trust_wmb_source_relation_id_worker_relations_id_fk
      FOREIGN KEY (source_relation_id) REFERENCES worker_relations(id) ON DELETE SET NULL
    `);
    logger.info("Added source_relation_id FK", { service: SERVICE });
  }

  // 3) Backfill: for each still-NULL WMB row, find the unique active
  // worker_relations row (dependent = wmb.worker_id as worker_2) covered by
  // the subscriber's (worker_1's) election active as of the last day of the
  // WMB month, where the election lists that relationship and (when it lists
  // benefits at all) includes the WMB's benefit. Rows whose worker had their
  // OWN active election as of that date are treated as own-benefit and left
  // NULL, as are ambiguous rows (more than one candidate relation).
  //
  // The migration runner does not wrap up() in a transaction; the backfill is
  // a single UPDATE (atomic) so it is safe to rerun, and the WHERE
  // source_relation_id IS NULL guard makes reruns no-ops.
  if (!(await tableExists("worker_trust_elections"))) {
    logger.info("worker_trust_elections table absent; skipping backfill", { service: SERVICE });
    return;
  }

  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT
        w.id AS wmb_id,
        r.id AS relation_id
      FROM trust_wmb w
      CROSS JOIN LATERAL (
        SELECT (make_date(w.year, w.month, 1) + interval '1 month' - interval '1 day')::date AS as_of
      ) d
      JOIN worker_relations r
        ON r.worker_2 = w.worker_id
       AND r.worker_1 <> w.worker_id
       AND r.start_ymd IS NOT NULL
       AND r.start_ymd <= d.as_of
       AND (r.end_ymd IS NULL OR r.end_ymd >= d.as_of)
      JOIN worker_trust_elections e
        ON e.worker_id = r.worker_1
       AND r.id = ANY(e.relationship_ids)
       AND e.start_ymd <= d.as_of
       AND (e.end_ymd IS NULL OR e.end_ymd >= d.as_of)
       AND (e.benefit_ids IS NULL OR w.benefit_id = ANY(e.benefit_ids))
      WHERE w.source_relation_id IS NULL
        -- Own-benefit guard: if the WMB's worker had their own active
        -- election as of that date COVERING THIS BENEFIT, treat the row as
        -- the worker's own. Benefit-specific on purpose: a worker can hold
        -- benefit A through their own election while receiving benefit B as
        -- someone's dependent — only A is "own". A NULL benefit_ids array is
        -- treated as covering every benefit (same semantics as the
        -- candidate join above).
        AND NOT EXISTS (
          SELECT 1 FROM worker_trust_elections own
          WHERE own.worker_id = w.worker_id
            AND own.start_ymd <= d.as_of
            AND (own.end_ymd IS NULL OR own.end_ymd >= d.as_of)
            AND (own.benefit_ids IS NULL OR w.benefit_id = ANY(own.benefit_ids))
        )
    ),
    unambiguous AS (
      SELECT wmb_id, MIN(relation_id) AS relation_id
      FROM candidates
      GROUP BY wmb_id
      HAVING COUNT(DISTINCT relation_id) = 1
    )
    UPDATE trust_wmb w
    SET source_relation_id = u.relation_id
    FROM unambiguous u
    WHERE w.id = u.wmb_id
  `);
  logger.info("Backfilled trust_wmb.source_relation_id", {
    service: SERVICE,
    rowsUpdated: result.rowCount ?? 0,
  });
}

const migration: Migration = {
  version: 1116,
  name: "add_trust_wmb_source_relation",
  description:
    "Add nullable trust_wmb.source_relation_id referencing worker_relations (FK added only when the optional worker.relations table exists, ON DELETE SET NULL) and backfill dependent WMB rows from active elections/relations as of each row's month; own-benefit and ambiguous rows stay NULL. Idempotent and safe to rerun.",
  up,
};

registerMigration(migration);
