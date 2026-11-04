import { describe, it, expect, vi } from "vitest";
import { getEnvironmentVariable } from "../../server/config/env-registry";
import type { IStorage } from "../../server/storage";
import { randomUUID } from "node:crypto";

// Benchmarks use transaction-local temporary tables; concurrency uses a unique
// fixture schema, removed in finally. Logs/provenance never reach app data.
const captures = vi.hoisted(() => ({ logs: vi.fn(), touch: vi.fn() }));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  storageLogger: { info: captures.logs, error: vi.fn() },
}));
vi.mock("../../server/storage/system/entity-metadata", () => ({
  entityMetadataStorage: { recordMutation: vi.fn(), recordDeletion: vi.fn(), recordSubrecordTouch: captures.touch },
}));
vi.mock("../../server/storage", async () => {
  const { createCommTagsStorage } = await import("../../server/storage/comm-tags");
  return { storage: { commTags: createCommTagsStorage({
    resolveCommLabel: async id => {
      const { createCommStorage } = await import("../../server/storage/comm");
      return createCommStorage().getLogLabel(id);
    },
  }) } };
});
vi.mock("../../server/modules/bulk/deliver", () => ({
  resolveTagIdsForMedium: async (storage: IStorage, data: { tagIds: string[] }) =>
    (await storage.commTags.listByIds(data.tagIds)).map(tag => tag.id),
}));
vi.mock("../../server/plugins/tokens", () => ({
  createTokenEvalContext: (_storage: unknown, contactId: string, options: unknown) => ({ contactId, options }),
  renderTokens: async (value: string) => ({ output: value }),
  buildTokenPickerEntries: vi.fn(() => []),
  evaluateChain: vi.fn(() => { throw new Error("Vendor merge expansion must not run"); }),
}));

const hasDevelopmentDb = !!getEnvironmentVariable("DATABASE_URL") && getEnvironmentVariable("NODE_ENV") !== "production";
describe.skipIf(!hasDevelopmentDb)("offline mailing database integration", () => {
  it("benchmarks 637 recipients and preserves parity, rollback, repair, audit and idempotency", async () => {
    const { db, pool } = await import("../../server/storage/db");
    const { sql } = await import("drizzle-orm");
    const { runWithTransaction, runInTransaction, getClient } = await import("../../server/storage/transaction-context");
    const { createBulkMessageStorage } = await import("../../server/storage/bulk/messages");
    const { createBulkParticipantStorage, bulkParticipantLoggingConfig } = await import("../../server/storage/bulk/participants");
    const { createBulkMessagesPostalStorage } = await import("../../server/storage/bulk/messages/postal");
    const { createCommTagsStorage } = await import("../../server/storage/comm-tags");
    const { createCommStorage } = await import("../../server/storage/comm");
    const { withStorageLogging } = await import("../../server/storage/middleware/logging");
    const { downloadMailCsv } = await import("../../server/modules/bulk/mail-csv");
    const { legacyMailCsv } = await import("./legacy-mail-csv-benchmark");
    const { createOfflinePostalExportStorage } = await import("../../server/storage/bulk/offline-postal");
    const { requestContext } = await import("../../server/middleware/request-context");
    let queryCount = 0;
    const acquire = (client: any) => {
      if (client.__offlineProbe) return;
      const query = client.query;
      client.__offlineProbe = query;
      client.query = function (...args: unknown[]) { queryCount++; return query.apply(this, args); };
    };
    pool.on("acquire", acquire);
    const rollback = new Error("intentional fixture rollback");
    try {
      await expect(runInTransaction(async () => {
        const client = getClient();
        for (const table of ["contacts", "contact_postal", "bulk_messages", "bulk_messages_postal", "bulk_participants", "comm", "comm_postal", "comm_tags", "options_comm_tags"]) {
          await client.execute(sql.raw(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`));
        }
        await client.execute(sql`INSERT INTO contacts(id, display_name) SELECT 'fixture-contact-'||n, 'Fixture Worker '||n FROM generate_series(1,637) n`);
        await client.execute(sql`INSERT INTO contact_postal(contact_id,street,city,state,postal_code,country,source)
          SELECT id,'10 Main St','Boston','MA','00501','US','admin' FROM contacts`);
        await client.execute(sql`INSERT INTO options_comm_tags(id,name) VALUES ('fixture-tag','Fixture SPD')`);
        await client.execute(sql`INSERT INTO bulk_messages(id,name,medium,status,data)
          VALUES ('fixture-message','Fixture SPD',ARRAY['postal'],'draft','{"offline":true,"tagIds":["fixture-tag"]}')`);
        await client.execute(sql`INSERT INTO bulk_participants(message_id,contact_id,medium)
          SELECT 'fixture-message',id,'postal' FROM contacts`);
        const tags = createCommTagsStorage({ resolveCommLabel: id => createCommStorage().getLogLabel(id) });
        const storage = {
          bulkMessages: createBulkMessageStorage(),
          bulkMessagesPostal: createBulkMessagesPostalStorage(),
          bulkParticipants: withStorageLogging(createBulkParticipantStorage(), bulkParticipantLoggingConfig),
          commTags: tags,
        } as unknown as IStorage;
        const counts = async () => {
          const result = await client.execute(sql`SELECT
            (SELECT count(*)::int FROM comm) AS comms,
            (SELECT count(*)::int FROM comm_postal) AS postal,
            (SELECT count(*)::int FROM comm_tags) AS tags,
            (SELECT count(*)::int FROM bulk_participants WHERE comm_id IS NOT NULL AND status='see_comm') AS linked,
            (SELECT status FROM bulk_messages WHERE id='fixture-message') AS status`);
          return result.rows[0];
        };
        queryCount = 0;
        const oldStart = performance.now();
        const baseline = await legacyMailCsv(storage, "fixture-message", "fixture-actor");
        const oldMs = performance.now() - oldStart;
        const oldQueries = queryCount;
        expect(await counts()).toEqual({ comms: 637, postal: 637, tags: 637, linked: 637, status: "sent" });
        await client.execute(sql`TRUNCATE comm,comm_postal,comm_tags`);
        await client.execute(sql`UPDATE bulk_participants SET comm_id=NULL,status='pending'`);
        await client.execute(sql`UPDATE bulk_messages SET status='draft'`);
        queryCount = 0;
        const start = performance.now();
        const result = await downloadMailCsv(storage, "fixture-message", "fixture-actor");
        const newMs = performance.now() - start;
        const newQueries = queryCount;
        expect(result.csv).toBe(baseline.csv);
        expect(newQueries).toBeLessThan(oldQueries / 10);
        expect(await counts()).toEqual({ comms: 637, postal: 637, tags: 637, linked: 637, status: "sent" });
        const evidence = await client.execute(sql`SELECT count(*)::int AS attributed FROM comm WHERE status='offline' AND data->>'initiatedBy'='fixture-actor' AND send_key='bulk-postal-export:fixture-message'`);
        expect(evidence.rows[0]?.attributed).toBe(637);
        queryCount = 0;
        const repeat = await downloadMailCsv(storage, "fixture-message", "fixture-actor", "all");
        const repeatQueries = queryCount;
        expect(repeat.csv).toBe(result.csv);
        expect(repeatQueries).toBeLessThan(6);
        // Lost links and remove/re-add recover the original spent send keys.
        await client.execute(sql`DELETE FROM bulk_participants WHERE contact_id='fixture-contact-1'`);
        await client.execute(sql`INSERT INTO bulk_participants(message_id,contact_id,medium) VALUES ('fixture-message','fixture-contact-1','postal')`);
        await client.execute(sql`UPDATE bulk_participants SET comm_id=NULL,status='pending' WHERE contact_id='fixture-contact-2'`);
        await downloadMailCsv(storage, "fixture-message", "fixture-actor");
        expect(await counts()).toEqual({ comms: 637, postal: 637, tags: 637, linked: 637, status: "sent" });
        // A link refusal after inserts must not leave partial comms/details/tags.
        const before = await counts();
        await expect(client.transaction(async tx => runWithTransaction(tx, async () => {
          await createOfflinePostalExportStorage().record("fixture-message", [{
            participantId: "does-not-exist", contactId: "new-fixture-contact", name: "Fixture",
            postal: { toAddressLine1: "", toCity: "", toState: "", toZip: "", toCountry: "US" },
          }], ["fixture-tag"], "fixture-actor");
        }))).rejects.toThrow("link every offline");
        expect(await counts()).toEqual(before);
        // Metadata callbacks remain after-commit; outer rollback drops them.
        console.log(JSON.stringify({ recipients: 637, oldMs: Math.round(oldMs), newMs: Math.round(newMs), oldQueries, newQueries, repeatQueries }));
        throw rollback;
      }).catch(error => {
        if (error !== rollback) console.error("Fixture failure:", error);
        throw error;
      })).rejects.toBe(rollback);
      await new Promise(resolve => setImmediate(resolve));
      expect(captures.touch).not.toHaveBeenCalled();
      const fixtureSchema = `offline_mail_test_${randomUUID().replaceAll("-", "")}`;
      if (!/^offline_mail_test_[a-f0-9]+$/.test(fixtureSchema)) throw new Error("Invalid fixture schema");
      await db.execute(sql.raw(`CREATE SCHEMA ${fixtureSchema}`));
      try {
        const inFixture = <T,>(fn: () => Promise<T>) => runInTransaction(async () => {
          await getClient().execute(sql.raw(`SET LOCAL search_path = ${fixtureSchema}, public`));
          return fn();
        });
        const tags = createCommTagsStorage();
        const storage = {
          bulkMessages: createBulkMessageStorage(),
          bulkMessagesPostal: createBulkMessagesPostalStorage(),
          bulkParticipants: withStorageLogging(createBulkParticipantStorage(), bulkParticipantLoggingConfig),
          commTags: tags,
        } as unknown as IStorage;
        await inFixture(async () => {
          const client = getClient();
          for (const table of ["contacts", "contact_postal", "bulk_messages", "bulk_messages_postal", "bulk_participants", "comm", "comm_postal", "comm_tags", "options_comm_tags"]) {
            await client.execute(sql.raw(`CREATE TABLE ${fixtureSchema}.${table} (LIKE public.${table} INCLUDING ALL)`));
          }
          await client.execute(sql`INSERT INTO contacts(id,display_name) VALUES ('fixture-one','One'),('fixture-two','Two'),('fixture-three','Three')`);
          await client.execute(sql`INSERT INTO contact_postal(contact_id,street,city,state,postal_code,country,source)
            SELECT id,'10 Main St','Boston','MA','00501','US','admin' FROM contacts`);
          await client.execute(sql`INSERT INTO options_comm_tags(id,name) VALUES ('fixture-tag','Fixture SPD')`);
          await client.execute(sql`INSERT INTO bulk_messages(id,name,medium,status,data)
            VALUES ('fixture-concurrent','Fixture',ARRAY['postal'],'draft','{"offline":true,"tagIds":["fixture-tag"]}')`);
          await client.execute(sql`INSERT INTO bulk_participants(message_id,contact_id,medium) SELECT 'fixture-concurrent',id,'postal' FROM contacts`);
        });
        captures.logs.mockClear();
        const both = await requestContext.run({
          userId: "fixture-actor", userEmail: "actor@example.invalid", originalUserId: "fixture-session-user",
        }, () => Promise.all([
          inFixture(() => downloadMailCsv(storage, "fixture-concurrent", "fixture-actor")),
          inFixture(() => downloadMailCsv(storage, "fixture-concurrent", "fixture-actor")),
        ]));
        expect(both.filter(result => !result.noFile)).toHaveLength(1);
        expect(both.filter(result => result.noFile)).toHaveLength(1);
        expect(both.find(result => !result.noFile)?.recipientCount).toBe(3);
        await inFixture(async () => {
          const result = await getClient().execute(sql`SELECT
            (SELECT count(*)::int FROM comm) AS comms,
            (SELECT count(*)::int FROM comm_postal) AS postal,
            (SELECT count(*)::int FROM comm_tags) AS tags,
            (SELECT count(*)::int FROM bulk_participants WHERE comm_id IS NOT NULL) AS linked,
            (SELECT status FROM bulk_messages WHERE id='fixture-concurrent') AS status`);
          expect(result.rows[0]).toEqual({ comms: 3, postal: 3, tags: 3, linked: 3, status: "sent" });
        });
        await new Promise(resolve => setImmediate(resolve));
        expect(captures.logs.mock.calls.filter(([, meta]) => meta?.module === "comm-tags")).toHaveLength(3);
        const concurrentAudit = [...captures.logs.mock.calls];
        // A blocked recipient commits an error even without a CSV; correcting
        // the address later makes the same recipient eligible without a reset.
        await inFixture(async () => {
          const client = getClient();
          await client.execute(sql`INSERT INTO bulk_messages(id,name,medium,status,data)
            VALUES ('fixture-blocked','Blocked',ARRAY['postal'],'draft','{"offline":true,"tagIds":["fixture-tag"]}')`);
          await client.execute(sql`INSERT INTO bulk_participants(message_id,contact_id,medium)
            VALUES ('fixture-blocked','fixture-one','postal')`);
          await client.execute(sql`UPDATE contact_postal SET deliverability_status='undeliverable' WHERE contact_id='fixture-one'`);
        });
        const blocked = await inFixture(() => downloadMailCsv(storage, "fixture-blocked", "fixture-actor"));
        expect(blocked).toMatchObject({ noFile: true, blockedCount: 1, recipientCount: 0 });
        await inFixture(async () => {
          const client = getClient();
          const result = await client.execute(sql`SELECT p.status,p.comm_id,p.message,b.status AS bulk_status,
            (SELECT count(*)::int FROM comm WHERE send_key='bulk-postal-export:fixture-blocked') AS comms
            FROM bulk_participants p JOIN bulk_messages b ON b.id=p.message_id WHERE b.id='fixture-blocked'`);
          expect(result.rows[0]).toMatchObject({
            status: "send_failed", comm_id: null, bulk_status: "draft", comms: 0,
          });
          expect(result.rows[0]?.message).toContain("undeliverable");
          await client.execute(sql`UPDATE contact_postal SET deliverability_status='verified' WHERE contact_id='fixture-one'`);
        });
        expect(await inFixture(() => downloadMailCsv(storage, "fixture-blocked", "fixture-actor")))
          .toMatchObject({ noFile: false, blockedCount: 0, recipientCount: 1 });
        // Appending to the now-sent message selects only new recipients. A
        // mixed batch exports the valid contact and persists the other's error.
        await inFixture(async () => {
          await getClient().execute(sql`INSERT INTO bulk_participants(message_id,contact_id,medium)
            VALUES ('fixture-blocked','fixture-two','postal'),('fixture-blocked','fixture-three','postal')`);
          await getClient().execute(sql`UPDATE contact_postal SET is_active=false WHERE contact_id='fixture-three'`);
        });
        const partial = await inFixture(() => downloadMailCsv(storage, "fixture-blocked", "fixture-actor"));
        expect(partial).toMatchObject({ noFile: false, recipientCount: 1, blockedCount: 1, missingAddressCount: 1 });
        expect(partial.csv).toContain('"Two"');
        expect(partial.csv).not.toContain('"One"');
        expect(partial.csv).not.toContain('"Three"');
        await inFixture(async () => {
          const rows = await getClient().execute(sql`SELECT contact_id,status,comm_id FROM bulk_participants
            WHERE message_id='fixture-blocked' ORDER BY contact_id`);
          expect(rows.rows.map(row => row.status)).toEqual(["see_comm", "send_failed", "see_comm"]);
          expect(rows.rows[1]?.comm_id).toBeNull();
          await getClient().execute(sql`UPDATE contact_postal SET is_active=true WHERE contact_id='fixture-three'`);
        });
        expect(await inFixture(() => downloadMailCsv(storage, "fixture-blocked", "fixture-actor")))
          .toMatchObject({ noFile: false, recipientCount: 1, blockedCount: 0 });
        const redownload = await inFixture(() => downloadMailCsv(storage, "fixture-blocked", "fixture-actor", "all"));
        expect(redownload.recipientCount).toBe(3);
        await inFixture(async () => {
          const rows = await getClient().execute(sql`SELECT count(*)::int AS count FROM comm
            WHERE send_key='bulk-postal-export:fixture-blocked'`);
          expect(rows.rows[0]?.count).toBe(3);
          await getClient().execute(sql`INSERT INTO bulk_messages(id,name,medium,status,data)
            VALUES ('fixture-retry','Retry',ARRAY['postal'],'draft','{"offline":true}')`);
          await getClient().execute(sql`INSERT INTO comm(id,medium,contact_id,status,send_key)
            VALUES ('fixture-old-failure','postal','fixture-one','failed','bulk-postal-export:fixture-retry')`);
          await getClient().execute(sql`INSERT INTO bulk_participants(message_id,contact_id,medium,comm_id,status)
            VALUES ('fixture-retry','fixture-one','postal','fixture-old-failure','see_comm')`);
        });
        expect(await inFixture(() => downloadMailCsv(storage, "fixture-retry", "fixture-actor")))
          .toMatchObject({ noFile: false, recipientCount: 1 });
        await inFixture(async () => {
          const rows = await getClient().execute(sql`SELECT cm.id,cm.status,cm.send_key FROM comm cm
            WHERE cm.contact_id='fixture-one' AND starts_with(cm.send_key,'bulk-postal-export:fixture-retry')
            ORDER BY cm.status`);
          expect(rows.rows).toHaveLength(2);
          expect(rows.rows[0]).toMatchObject({ id: "fixture-old-failure", status: "failed" });
          expect(rows.rows[1]).toMatchObject({
            status: "offline", send_key: "bulk-postal-export:fixture-retry:retry:fixture-old-failure",
          });
        });
        expect(concurrentAudit.filter(([, meta]) => meta?.operation === "update" && meta?.module === "bulkParticipants")).toHaveLength(3);
        const recipientAudit = concurrentAudit.filter(([, meta]) => meta?.operation === "update" || meta?.module === "comm-tags");
        for (const [, meta] of recipientAudit) {
          expect(meta.user_id).toBe("fixture-actor");
          expect(meta.meta.masqueradedBy).toEqual({ userId: "fixture-session-user", userEmail: undefined });
        }
        expect(captures.touch).toHaveBeenCalledWith(expect.objectContaining({
          tableName: "bulk_messages", entityId: "fixture-concurrent", actorId: "fixture-actor",
        }));
        // Failure in the final sent-state update must roll back even the
        // successfully batched comm, postal, tag and recipient-link writes.
        await inFixture(async () => {
          await getClient().execute(sql`INSERT INTO bulk_messages(id,name,medium,status,data)
            VALUES ('fixture-failure','Failure',ARRAY['postal'],'draft','{"offline":true,"tagIds":["fixture-tag"]}')`);
          await getClient().execute(sql`INSERT INTO bulk_participants(message_id,contact_id,medium) VALUES ('fixture-failure','fixture-one','postal')`);
        });
        const failStorage = { ...storage, bulkMessages: { ...storage.bulkMessages,
          update: async () => { throw new Error("fixture final update failure"); },
        } } as IStorage;
        const tagAuditCountBeforeFailure = captures.logs.mock.calls.filter(([, meta]) => meta?.module === "comm-tags").length;
        await expect(inFixture(() => downloadMailCsv(failStorage, "fixture-failure", "fixture-actor"))).rejects.toThrow("fixture final update failure");
        await inFixture(async () => {
          const result = await getClient().execute(sql`SELECT
            (SELECT count(*)::int FROM comm WHERE send_key='bulk-postal-export:fixture-failure') AS comms,
            (SELECT count(*)::int FROM bulk_participants WHERE message_id='fixture-failure' AND comm_id IS NOT NULL) AS linked,
            (SELECT status FROM bulk_messages WHERE id='fixture-failure') AS status`);
          expect(result.rows[0]).toEqual({ comms: 0, linked: 0, status: "draft" });
        });
        expect(captures.logs.mock.calls.filter(([, meta]) => meta?.module === "comm-tags")).toHaveLength(tagAuditCountBeforeFailure);
      } finally {
        // Destructive only to the uniquely named fixtures this test created.
        await db.execute(sql.raw(`DROP SCHEMA ${fixtureSchema} CASCADE`));
      }
    } finally {
      pool.off("acquire", acquire);
      // No public fixture rows ever existed: temp tables and all writes rolled
      // back. Restore instrumentation on pooled connections before reuse.
      const connection = await pool.connect();
      if ((connection as any).__offlineProbe) {
        connection.query = (connection as any).__offlineProbe;
        delete (connection as any).__offlineProbe;
      }
      connection.release();
      await pool.end();
    }
  }, 120_000);
});
