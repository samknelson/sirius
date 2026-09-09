import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1109";

/**
 * Bring stored notifier templates in line with the ONE per-medium field
 * declaration in `shared/delivery-fields.ts`.
 *
 * An SMS body is called `body`. Bulk already stored it under that name;
 * the event notifier stored its admin overrides under
 * `data.templates.sms.message`. There is no read-time alias for the old
 * spelling — an alias is a second name that outlives every rename — so
 * the stored overrides are rewritten here instead. Notifier DEFAULTS
 * live in code and were renamed with it; only the admin's overrides are
 * stored, and only in plugin_configs.
 *
 * (The other half of this rename, dropping the bulk email's stored
 * plain-text body, lives in the bulk component's own migrations: that
 * table does not exist where the component is off.)
 *
 * The migration runner does not wrap a step in a transaction, so this
 * opens its own, and every statement is written to be safe on a rerun.
 */
async function up(): Promise<void> {
  const moved = await db.transaction(async (tx) => {
    // Move the value across, only where the new key is not already
    // there (so a rerun, or a config an admin has since re-saved,
    // cannot overwrite the current value with a stale one).
    const result = await tx.execute(sql`
      UPDATE plugin_configs
      SET data = jsonb_set(
            data,
            '{templates,sms,body}',
            data #> '{templates,sms,message}'
          )
      WHERE plugin_kind = 'event-notifier'
        AND jsonb_typeof(data #> '{templates,sms,message}') = 'string'
        AND NOT (data #> '{templates,sms}' ? 'body')
    `);

    // Then drop the old key wherever it survives — including on rows
    // that already carried both spellings, where the stored `body` is
    // the one the app has been reading.
    await tx.execute(sql`
      UPDATE plugin_configs
      SET data = data #- '{templates,sms,message}'
      WHERE plugin_kind = 'event-notifier'
        AND data #> '{templates,sms}' ? 'message'
    `);

    return result.rowCount ?? 0;
  });

  logger.info("Unified stored medium message fields", {
    service: SERVICE,
    smsTemplatesRenamed: moved,
  });
}

const migration: Migration = {
  version: 1109,
  name: "unify_medium_message_fields",
  description:
    "Rename stored notifier SMS templates from sms.message to sms.body and drop the bulk email plain-text column now derived at send.",
  up,
};

registerMigration(migration);

export default migration;
