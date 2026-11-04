import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getClient, runInTransaction } from "../transaction-context";

const COMPONENT = "system.mask_mode";
const EPOCH = "mask_mode_component_epoch";
const LOCK = "mask-mode-component-lifecycle";

/** Database authority, not a process-local component cache. No private values. */
export async function readMaskComponent(): Promise<{ enabled: boolean; epoch: string | null }> {
  const result = await getClient().execute(sql`
    SELECT
      COALESCE((SELECT value ->> ${COMPONENT} FROM variables WHERE name = 'components'), 'false') = 'true' AS enabled,
      (SELECT value #>> '{}' FROM variables WHERE name = ${EPOCH}) AS epoch
  `);
  const row = result.rows[0] as any;
  return { enabled: row?.enabled === true, epoch: row?.epoch ?? null };
}

/** Serializes component changes with ON/OFF CAS across application processes. */
export async function lockMaskComponent(): Promise<void> {
  await getClient().execute(sql`SET LOCAL lock_timeout = '2500ms'`);
  await getClient().execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${LOCK}, 0))`);
}

/**
 * Wrap ALL variable write paths, including imports/deletes, not only the
 * Components screen. Epoch changes and revocation commit with the setting.
 */
export async function withMaskComponentChange<T>(write: () => Promise<T>): Promise<T> {
  return runInTransaction(async () => {
    await lockMaskComponent();
    const before = await readMaskComponent();
    const result = await write();
    const after = await readMaskComponent();
    if (before.enabled !== after.enabled) {
      await getClient().execute(sql`
        INSERT INTO variables (name, value) VALUES (${EPOCH}, ${JSON.stringify(randomUUID())}::jsonb)
        ON CONFLICT (name) DO UPDATE SET value = excluded.value
      `);
      // Keep a tombstone, not a deletion: late whole-session saves must never
      // resurrect an identity or erase its forced-reauth requirement.
      await getClient().execute(sql`
        UPDATE sessions SET sess = jsonb_set(sess::jsonb, '{maskModeRevoked}', 'true'::jsonb)
        WHERE sess::jsonb -> 'maskMode' ->> 'mode' = 'on'
      `);
    }
    return result;
  });
}
