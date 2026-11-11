/**
 * Rollback-safe PostgreSQL migration/default integration test:
 * RUN_WORKER_SIRIUS_ID_POSTGRES=1 npx vitest run tests/workers/worker-sirius-id-varchar-postgres.test.ts
 */
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../../server/storage/db";
import { applyWorkerSiriusIdVarcharMigration } from "../../scripts/migrate/core/1207_worker_sirius_id_varchar";
import {
  workerSiriusIdDefaultFunctionSql,
  workerSiriusIdSequenceCreateSql,
  workerSiriusIdSequenceOwnershipSql,
} from "../../server/services/worker-sirius-id-default-sql";

const enabled = process.env.RUN_WORKER_SIRIUS_ID_POSTGRES === "1";

describe.skipIf(!enabled)("worker Sirius ID varchar PostgreSQL migration", () => {
  it("preserves IDs and uniqueness, keeps NULLs, and stores gated sequence values as text", async () => {
    const schema = `worker_sid_test_${crypto.randomUUID().replaceAll("-", "")}`;
    await db.transaction(async (tx) => {
      await tx.execute(sql`CREATE SCHEMA ${sql.identifier(schema)}`);
      await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(schema)}, public`);
      await tx.execute(sql`CREATE TABLE variables (name varchar PRIMARY KEY, value jsonb)`);
      await tx.execute(sql.raw(workerSiriusIdDefaultFunctionSql));
      await tx.execute(sql`CREATE TABLE contacts (id varchar PRIMARY KEY, display_name text)`);
      await tx.execute(sql`
        CREATE TABLE workers (
          id serial PRIMARY KEY,
          contact_id varchar,
          sirius_id integer UNIQUE DEFAULT worker_sirius_id_default()
        )
      `);
      await tx.execute(sql.raw(workerSiriusIdSequenceCreateSql));
      await tx.execute(sql.raw(workerSiriusIdSequenceOwnershipSql));
      await tx.execute(sql`
        INSERT INTO contacts (id, display_name) VALUES ('old-21', 'Older A'), ('old-42', 'Older B'), ('old-null', 'Older Null')
      `);
      await tx.execute(sql`
        INSERT INTO workers (contact_id, sirius_id) VALUES ('old-21', 21), ('old-42', 42), ('old-null', NULL)
      `);
      await tx.execute(sql`
        SELECT setval(pg_get_serial_sequence('workers', 'sirius_id'), 42, true)
      `);

      await applyWorkerSiriusIdVarcharMigration(tx);

      const values = await tx.execute(sql`
        SELECT sirius_id FROM workers ORDER BY id
      `);
      expect((values.rows as Array<{ sirius_id: string | null }>).map((row) => row.sirius_id))
        .toEqual(["21", "42", null]);

      const column = await tx.execute(sql`
        SELECT data_type, is_nullable FROM information_schema.columns
         WHERE table_schema = ${schema} AND table_name = 'workers' AND column_name = 'sirius_id'
      `);
      expect(column.rows[0]).toMatchObject({
        data_type: "character varying",
        is_nullable: "YES",
      });
      const unique = await tx.execute(sql`
        SELECT COUNT(*)::int AS count
          FROM pg_constraint
         WHERE conrelid = 'workers'::regclass AND contype = 'u'
           AND conkey = ARRAY[
             (SELECT attnum FROM pg_attribute
               WHERE attrelid = 'workers'::regclass AND attname = 'sirius_id')
           ]::smallint[]
      `);
      expect(Number((unique.rows[0] as { count: number | string }).count)).toBe(1);

      await tx.execute(sql`
        INSERT INTO contacts (id, display_name)
        VALUES ('leading-zero', 'Leading Zero'), ('plain-number', 'Plain Number'), ('alpha-id', 'Alpha ID')
      `);
      await tx.execute(sql`
        INSERT INTO workers (contact_id, sirius_id)
        VALUES ('leading-zero', '0042'), ('alpha-id', 'W-A')
      `);
      for (const [input, expected] of [["0042", "0042"], ["42", "42"], ["W-A", "W-A"]]) {
        const exactMatch = await tx.execute(sql`
          SELECT sirius_id FROM workers WHERE sirius_id = ${input}
        `);
        expect(exactMatch.rows.map((row: any) => row.sirius_id)).toEqual([expected]);
      }

      await tx.execute(sql`INSERT INTO variables (name, value) VALUES ('worker_sirius_id_authority', '"external"'::jsonb)`);
      await tx.execute(sql`INSERT INTO workers DEFAULT VALUES`);
      const external = await tx.execute(sql`SELECT sirius_id FROM workers ORDER BY id DESC LIMIT 1`);
      expect((external.rows[0] as { sirius_id: string | null }).sirius_id).toBeNull();

      await tx.execute(sql`UPDATE variables SET value = '"s2"'::jsonb WHERE name = 'worker_sirius_id_authority'`);
      await tx.execute(sql`INSERT INTO workers DEFAULT VALUES`);
      const allocated = await tx.execute(sql`
        SELECT sirius_id, pg_typeof(sirius_id)::text AS value_type
          FROM workers ORDER BY id DESC LIMIT 1
      `);
      expect(allocated.rows[0]).toMatchObject({
        sirius_id: "43",
        value_type: "character varying",
      });

      await tx.execute(sql`DROP SCHEMA ${sql.identifier(schema)} CASCADE`);
    });
  });
});
