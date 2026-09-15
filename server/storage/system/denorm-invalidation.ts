import { sql } from "drizzle-orm";
import { denorm, type InsertDenorm } from "@shared/schema";
import { getClient } from "../transaction-context";

export interface DenormInvalidationSeed {
  entityId: string;
  entityType: string;
  configId: string;
}

// PostgreSQL accepts at most 65,535 bind parameters. A seed currently carries
// nine insert values, so a corrective scan's coalesced 30k worker set must be
// split while still using the caller's one ambient source transaction.
export const DENORM_INVALIDATION_INSERT_BATCH_SIZE = 5_000;

/**
 * The single mutation primitive for denorm invalidation.  Callers may resolve
 * their own plugin config, but must never hand-roll this upsert: incrementing
 * `generation` is the shared conditional-apply protocol.
 *
 * It intentionally uses the ambient client, allowing source storage to call it
 * inside the same transaction that committed the changed source row.
 */
export async function enqueueDenormInvalidations(
  seeds: DenormInvalidationSeed[],
): Promise<number> {
  if (seeds.length === 0) return 0;
  const client = getClient();
  let affected = 0;
  for (let offset = 0; offset < seeds.length; offset += DENORM_INVALIDATION_INSERT_BATCH_SIZE) {
    const now = new Date();
    const values: InsertDenorm[] = seeds
      .slice(offset, offset + DENORM_INVALIDATION_INSERT_BATCH_SIZE)
      .map((seed) => ({
        entityId: seed.entityId,
        entityType: seed.entityType,
        configId: seed.configId,
        status: "stale",
        computedAt: null,
        staleAt: now,
        message: null,
        generation: 1,
        claimToken: null,
        claimAt: null,
      }));
    const rows = await client
      .insert(denorm)
      .values(values)
      .onConflictDoUpdate({
        target: [denorm.entityId, denorm.configId],
        set: {
          status: "stale",
          staleAt: now,
          message: null,
          generation: sql`${denorm.generation} + 1`,
          claimToken: null,
          claimAt: null,
        },
      })
      .returning({ id: denorm.id });
    affected += rows.length;
  }
  return affected;
}