/**
 * Opt-in integration/performance test against the configured development DB:
 * RUN_WORKER_EXPORT_DB_SCALE=1 npx vitest run tests/workers/worker-export-db-scale.test.ts
 * Rows are inserted in one transaction and rolled back; no test fixture survives.
 * This cannot establish throughput through a deployed proxy or production DB.
 */
import { describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
// The component cache's storage-barrel import creates a Vitest SSR cycle;
// this fixture measures the reader with optional components disabled.
vi.mock("../../server/services/component-cache", () => ({
  isCacheInitialized: () => true,
  isComponentEnabledSync: (component: string) => component === "trust.benefits",
}));
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { sql } from "drizzle-orm";
import { createWorkerStorage, type WorkerExportCursor, type WorkersExportParams } from "../../server/storage/workers";
import { getClient, runInTransaction, runWithTransaction } from "../../server/storage/transaction-context";
import { pool } from "../../server/storage/db";
import { registerWorkerExportRoute } from "../../server/modules/workers/export";

const enabled = process.env.RUN_WORKER_EXPORT_DB_SCALE === "1";
const ROLLBACK = Symbol("rollback fixture");

describe.skipIf(!enabled)("worker export real-DB keyset scale", () => {
  it("visits every row once in both name and employer ordering, filtered and with benefits requested", async () => {
    const size = 10_000;
    const prefix = `export-scale-${Date.now()}-`;
    try {
      await runInTransaction(async () => {
        const db = getClient();
        await db.execute(sql`
          INSERT INTO contacts (id, display_name, given, family, email)
          SELECT ${prefix} || n::text, 'Scale ' || n::text,
            CASE WHEN n % 11 = 0 THEN NULL ELSE 'Given ' || lpad(n::text, 5, '0') END,
            CASE WHEN n % 13 = 0 THEN NULL ELSE 'Family ' || lpad(n::text, 5, '0') END,
            ${prefix} || n::text || '@example.invalid'
          FROM generate_series(1, ${size}) AS n
        `);
        await db.execute(sql`
          INSERT INTO workers (id, contact_id)
          SELECT ${prefix} || n::text, ${prefix} || n::text
          FROM generate_series(1, ${size}) AS n
        `);

        const anchorResult = await db.execute(sql`
          SELECT c.family, c.given, w.id
          FROM workers w JOIN contacts c ON c.id = w.contact_id
          WHERE w.id LIKE ${prefix + "%"} AND c.family IS NOT NULL AND c.given IS NOT NULL
          ORDER BY c.family, c.given, w.id LIMIT 1 OFFSET 7000
        `);
        const anchor = anchorResult.rows[0] as { family: string; given: string; id: string };
        const plan = async (query: ReturnType<typeof sql>) => {
          const result = await db.execute(query);
          const root = (result.rows[0] as any)["QUERY PLAN"][0];
          return { executionMs: root["Execution Time"], node: root.Plan["Node Type"], cost: root.Plan["Total Cost"] };
        };
        const offsetPlan = await plan(sql`EXPLAIN (ANALYZE, FORMAT JSON)
          SELECT w.id, (SELECT array_agg(wed.employer_id) FROM worker_employment_denorm wed WHERE wed.worker_id=w.id)
          FROM workers w JOIN contacts c ON c.id=w.contact_id
          WHERE w.id LIKE ${prefix + "%"} AND c.family IS NOT NULL AND c.given IS NOT NULL
          ORDER BY c.family, c.given, w.id LIMIT 250 OFFSET 7000`);
        const keysetPlan = await plan(sql`EXPLAIN (ANALYZE, FORMAT JSON)
          WITH selected AS MATERIALIZED (
            SELECT w.id, c.family, c.given
            FROM workers w JOIN contacts c ON c.id=w.contact_id
            WHERE w.id LIKE ${prefix + "%"} AND c.family IS NOT NULL AND c.given IS NOT NULL
              AND (c.family, c.given, w.id) > (${anchor.family}, ${anchor.given}, ${anchor.id})
            ORDER BY c.family, c.given, w.id LIMIT 250
          )
          SELECT w.id, (SELECT array_agg(wed.employer_id) FROM worker_employment_denorm wed WHERE wed.worker_id=w.id)
          FROM selected s JOIN workers w ON w.id=s.id ORDER BY s.family,s.given,s.id`);
        const employerBenefitPlan = await plan(sql`EXPLAIN (ANALYZE, FORMAT JSON)
          WITH selected AS MATERIALIZED (
            SELECT w.id, (
              SELECT MIN(e.name) FROM employers e
              JOIN worker_employment_denorm wed ON wed.employer_id=e.id
              WHERE wed.worker_id=w.id
            ) AS employer_name, c.family, c.given
            FROM workers w JOIN contacts c ON c.id=w.contact_id
            WHERE w.id LIKE ${prefix + "%"}
              AND c.family IS NOT NULL AND c.given IS NOT NULL
              AND (c.family,c.given,w.id) > (${anchor.family}, ${anchor.given}, ${anchor.id})
            ORDER BY employer_name DESC NULLS LAST, c.family DESC, c.given DESC, w.id DESC
            LIMIT 250
          )
          SELECT w.id, (SELECT json_agg(tb.name)
            FROM trust_wmb wmb JOIN trust_benefits tb ON tb.id=wmb.benefit_id
            WHERE wmb.worker_id=w.id) AS benefits
          FROM selected s JOIN workers w ON w.id=s.id
          ORDER BY s.employer_name DESC NULLS LAST,s.family DESC,s.given DESC,w.id DESC`);
        writeFileSync("/tmp/worker-export-scale.jsonl",
          `${JSON.stringify({ planDatasetSize: size, offsetLate: offsetPlan, keysetLate: keysetPlan, employerBenefitLate: employerBenefitPlan })}\n`, { flag: "a" });

        const storage = createWorkerStorage({} as any);
        // A narrow SQL baseline isolates the old OFFSET traversal cost; it
        // does not include the old route's CSV/enrichment/network overhead.
        const oldTimings: number[] = [];
        let oldRows = 0;
        const oldStart = performance.now();
        for (let offset = 0; offset < size; offset += 250) {
          const readStart = performance.now();
          const result = await db.execute(sql`
            SELECT w.id, (SELECT array_agg(wed.employer_id)
              FROM worker_employment_denorm wed WHERE wed.worker_id = w.id) AS employer_ids
            FROM workers w JOIN contacts c ON c.id = w.contact_id
            WHERE w.id LIKE ${prefix + "%"}
            ORDER BY c.family, c.given, w.id LIMIT 250 OFFSET ${offset}
          `);
          oldTimings.push(Math.round(performance.now() - readStart));
          oldRows += result.rows.length;
        }
        expect(oldRows).toBe(size);
        writeFileSync("/tmp/worker-export-scale.jsonl", `${JSON.stringify({
          baseline: "narrow OFFSET SQL only", datasetSize: size, totalRows: oldRows,
          earlyBatchMs: oldTimings[0], lateBatchMs: oldTimings.at(-1),
          completionMs: Math.round(performance.now() - oldStart),
        })}\n`, { flag: "a" });
        for (const params of [
          { sortBy: "lastName", sortOrder: "asc" },
          { sortBy: "firstName", sortOrder: "desc", contactSearch: "@example.invalid" },
          { sortBy: "employer", sortOrder: "desc", includeBenefits: true, nameIdSearch: "Scale" },
        ] satisfies WorkersExportParams[]) {
          let cursor: WorkerExportCursor | null = null;
          const seen = new Set<string>();
          const orderedIds: string[] = [];
          const timings: number[] = [];
          let bytes = 0;
          const start = performance.now();
          do {
            const readStart = performance.now();
            const batch = await storage.getWorkersForExportBatch(params, cursor, 250);
            timings.push(Math.round(performance.now() - readStart));
            for (const row of batch.rows) {
              if (!row.id.startsWith(prefix)) continue;
              expect(seen.has(row.id)).toBe(false);
              seen.add(row.id);
              orderedIds.push(row.id);
            }
            const csv = stringify(batch.rows.map(row => [row.id, row.family ?? "", row.given ?? ""]));
            bytes += Buffer.byteLength(csv);
            expect(parse(csv)).toHaveLength(batch.rows.length);
            cursor = batch.nextCursor;
          } while (cursor);
          expect(seen.size).toBe(size);
          const list = await storage.getWorkersWithDetailsPaginated({
            ...params, page: 1, pageSize: size + 100,
          });
          expect(orderedIds).toEqual(list.data.filter(row => row.id.startsWith(prefix)).map(row => row.id));
          const report = {
            datasetSize: size, sortBy: params.sortBy, filter: params.contactSearch ? "contact" : params.nameIdSearch ? "name" : "none",
            totalRows: seen.size, bytes,
            earlyBatchMs: timings[0], lateBatchMs: timings.at(-1),
            completionMs: Math.round(performance.now() - start),
          };
          writeFileSync("/tmp/worker-export-scale.jsonl", `${JSON.stringify(report)}\n`, { flag: "a" });
        }
        const tx = getClient() as Parameters<typeof runWithTransaction>[0];
        const app = express();
        const pass: express.RequestHandler = (_req, _res, next) => next();
        registerWorkerExportRoute(app, pass, () => pass, {
          workers: {
            getWorkersForExportBatch: (params, cursor, limit) =>
              runWithTransaction(tx, () => storage.getWorkersForExportBatch(params, cursor, limit)),
          },
          workerIds: {
            getShowOnListsIdTypes: async () => [],
            getWorkerIdsForListByWorkerIds: async () => [],
          },
          employers: { getByIds: async () => [] },
          getMemberStatusOptions: async () => [],
        });
        const server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, resolve));
        try {
          const port = (server.address() as AddressInfo).port;
          for (const path of [
            "/api/workers/export?sortBy=lastName",
            "/api/workers/export?sortBy=employer&sortOrder=desc&includeBenefits=true&contactSearch=%40example.invalid",
          ]) {
            const began = performance.now();
            const download = await new Promise<{ body: string; firstByteMs: number; completeMs: number }>((resolve, reject) => {
              http.get(`http://127.0.0.1:${port}${path}`, response => {
                let firstByteMs = -1;
                const chunks: Buffer[] = [];
                response.on("data", (chunk: Buffer) => {
                  if (firstByteMs < 0) firstByteMs = Math.round(performance.now() - began);
                  chunks.push(chunk);
                });
                response.on("aborted", () => reject(new Error("truncated worker export")));
                response.on("end", () => resolve({
                  body: Buffer.concat(chunks).toString("utf8"),
                  firstByteMs,
                  completeMs: Math.round(performance.now() - began),
                }));
                response.on("error", reject);
              }).on("error", reject);
            });
            const records = parse(download.body, { columns: true }) as Array<Record<string, string>>;
            expect(records.filter(row => row.Email.startsWith(prefix))).toHaveLength(size);
            expect(new Set(records.filter(row => row.Email.startsWith(prefix)).map(row => row.Email)).size).toBe(size);
            writeFileSync("/tmp/worker-export-scale.jsonl", `${JSON.stringify({
              httpPath: path.split("?")[0], filtered: path.includes("contactSearch"),
              datasetSize: size, totalRows: records.length,
              bytes: Buffer.byteLength(download.body), firstByteMs: download.firstByteMs,
              completionMs: download.completeMs,
            })}\n`, { flag: "a" });
          }
        } finally {
          await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    } finally {
      await pool.end();
    }
  }, 120_000);
});