import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { migrateWcCache } from "../../scripts/migrate/core/1117_wc_cache_configuration";

describe.sequential("WC cache provider-neutral migration", () => {
  it("preserves known answers, proves prefixes, keeps the newest collision, and reruns", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TEMP TABLE plugin_configs_wc_vendors (
          id varchar PRIMARY KEY
        ) ON COMMIT DROP
      `);
      await tx.execute(sql`
        CREATE TEMP TABLE wc_cache (
          id varchar PRIMARY KEY,
          service varchar(64) NOT NULL,
          request_type varchar(64) NOT NULL,
          request_key text NOT NULL,
          request_key_hash varchar(64) NOT NULL,
          outcome text NOT NULL,
          response jsonb,
          fetched_at timestamp NOT NULL,
          created_at timestamp NOT NULL DEFAULT now(),
          CONSTRAINT wc_cache_service_type_key_hash_uniq
            UNIQUE (service, request_type, request_key_hash)
        ) ON COMMIT DROP
      `);
      await tx.execute(sql`
        CREATE INDEX wc_cache_sweep_idx
        ON wc_cache (service, request_type, fetched_at)
      `);
      await tx.execute(sql`
        INSERT INTO plugin_configs_wc_vendors (id)
        VALUES ('config-old'), ('config-new')
      `);
      await tx.execute(sql`
        INSERT INTO wc_cache
          (id, service, request_type, request_key, request_key_hash,
           outcome, response, fetched_at)
        VALUES
          ('older', 'Lob', 'address-verification', 'config-old:10 MAIN ST',
           'old-hash', 'success', '{"answer":"older"}', '2026-01-01'),
          ('newer', 'Google', 'communications.postal.address.verify',
           'config-new:10 MAIN ST', 'new-hash', 'success',
           '{"answer":"newer"}', '2026-02-01'),
          ('unknown', 'Lob', 'retired.unknown', 'not-a-config:subject',
           'unknown-hash', 'success', '{"answer":"unknown"}', '2026-03-01')
      `);

      await migrateWcCache(tx);
      await migrateWcCache(tx);

      const result = await tx.execute(sql`
        SELECT id, service, configuration_id, request_type, request_key,
               request_key_hash, response
        FROM wc_cache
        ORDER BY id
      `);
      expect(result.rows).toEqual([
        {
          id: "newer",
          service: "Google",
          configuration_id: "config-new",
          request_type: "communications.postal.address.verify",
          request_key: "10 MAIN ST",
          request_key_hash: createHash("sha256").update("10 MAIN ST").digest("hex"),
          response: { answer: "newer" },
        },
        {
          id: "unknown",
          service: "Lob",
          configuration_id: null,
          request_type: "retired.unknown",
          request_key: "not-a-config:subject",
          request_key_hash: createHash("sha256")
            .update("not-a-config:subject")
            .digest("hex"),
          response: { answer: "unknown" },
        },
      ]);
    });
  });
});