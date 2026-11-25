// Migration infrastructure owns this one-time data write.
import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/boot/migration-runner";

const migration: Migration = {
  version: 1130,
  name: "cardcheck_status_notifier",
  description: "Preserve email and in-app revocation delivery as an editable event notifier configuration",
  async up() {
    // Only core config tables are touched. This is safe even when the optional
    // cardcheck tables are absent/disabled; the plugin's component gate keeps
    // the config inert until enabled. No boot-time seed recreates deleted rows.
    await db.transaction(async tx => {
      const inserted = await tx.execute(sql`
        INSERT INTO plugin_configs (id, plugin_kind, plugin_id, enabled, name, ordering, data)
        VALUES ('ed18b89b-821e-44b8-a050-cb2acf3595cd', 'event-notifier',
          'cardcheck-status-notifier', true, 'Cardcheck revocation notifications', 0,
          '{"destinationStatus":"revoked","media":["email","inapp"]}'::jsonb)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `);
      // Do not overwrite a pre-existing row, its edits, or its channel choices.
      if (inserted.rows.length > 0) {
        await tx.execute(sql`
          INSERT INTO plugin_configs_event_notifier (id, media)
          VALUES ('ed18b89b-821e-44b8-a050-cb2acf3595cd', 'email,inapp')
        `);
      }
    });
  },
};

registerMigration(migration);
export default migration;
