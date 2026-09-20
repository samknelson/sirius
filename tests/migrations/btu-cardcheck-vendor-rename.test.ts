import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { renameBtuCardcheckVendorConfigs } from "../../scripts/migrate/core/1116_rename_btu_cardcheck_vendor";

describe.sequential("BTU card-check WC vendor rename migration", () => {
  async function withFixture(
    callback: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TEMP TABLE plugin_configs (
          id varchar PRIMARY KEY,
          plugin_kind varchar NOT NULL,
          plugin_id text NOT NULL,
          enabled boolean NOT NULL,
          name text,
          ordering integer NOT NULL,
          data jsonb
        ) ON COMMIT DROP
      `);
      await tx.execute(sql`
        CREATE TEMP TABLE plugin_configs_wc_vendors (
          id varchar PRIMARY KEY REFERENCES plugin_configs(id) ON DELETE CASCADE
        ) ON COMMIT DROP
      `);
      await callback(tx);
    });
  }

  it("preserves the complete configuration and subsidiary linkage", async () => {
    await withFixture(async (tx) => {
      await tx.execute(sql`
        INSERT INTO plugin_configs
          (id, plugin_kind, plugin_id, enabled, name, ordering, data)
        VALUES
          ('btu-existing', 'wc-vendors', 'btu-cardcheck', false,
           'Existing BTU', 17, '{"secretName":"BTU_PASSWORD","siteUrl":"https://btu.test"}')
      `);
      await tx.execute(sql`
        INSERT INTO plugin_configs_wc_vendors (id) VALUES ('btu-existing')
      `);

      expect(await renameBtuCardcheckVendorConfigs(tx)).toBe(1);
      const result = await tx.execute(sql`
        SELECT p.*, w.id AS subsidiary_id
        FROM plugin_configs p
        JOIN plugin_configs_wc_vendors w ON w.id = p.id
      `);
      expect(result.rows).toEqual([{
        id: "btu-existing",
        plugin_kind: "wc-vendors",
        plugin_id: "sitespecific-btu-cardcheck",
        enabled: false,
        name: "Existing BTU",
        ordering: 17,
        data: {
          secretName: "BTU_PASSWORD",
          siteUrl: "https://btu.test",
        },
        subsidiary_id: "btu-existing",
      }]);
      expect(await renameBtuCardcheckVendorConfigs(tx)).toBe(0);
    });
  });

  it("refuses an old/new collision without changing either row", async () => {
    await withFixture(async (tx) => {
      await tx.execute(sql`
        INSERT INTO plugin_configs
          (id, plugin_kind, plugin_id, enabled, ordering, data)
        VALUES
          ('old', 'wc-vendors', 'btu-cardcheck', true, 0, '{}'),
          ('new', 'wc-vendors', 'sitespecific-btu-cardcheck', true, 0, '{}')
      `);
      await expect(renameBtuCardcheckVendorConfigs(tx)).rejects.toThrow(
        /found 1 "btu-cardcheck".*1 "sitespecific-btu-cardcheck"/,
      );
      const rows = await tx.execute(sql`
        SELECT id, plugin_id FROM plugin_configs ORDER BY id
      `);
      expect(rows.rows).toEqual([
        { id: "new", plugin_id: "sitespecific-btu-cardcheck" },
        { id: "old", plugin_id: "btu-cardcheck" },
      ]);
    });
  });
});