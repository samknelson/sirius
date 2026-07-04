import { getClient } from "../transaction-context";
import { grievances, variables } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Grievance ID (`sirius_id`) generation.
 *
 * Current scheme: `YYYYNNNN` — the 4-digit calendar year of creation plus a
 * zero-padded, per-year sequence number (e.g. `20260097` is the 97th grievance
 * created in 2026).
 *
 * This module is intentionally the ONE place that knows how a grievance ID is
 * produced. It is a clean seam: a future "pluggable" scheme would replace the
 * body of `generateGrievanceSiriusId` (or swap this module out) without touching
 * the storage/create path that calls it.
 *
 * Algorithm (per the agreed design):
 *   - Keep a per-year counter in the `variables` table under `grievance.nextid`,
 *     shaped as a JSON map of `{ "<year>": <next sequence number> }`.
 *   - Probe forward from the counter for the first `YYYYNNNN` value that is not
 *     already used, and return it. We start from the counter (not from `0001`)
 *     on purpose: a deleted-then-freed low number is NOT backfilled, and an
 *     admin's manually-placed high number does NOT drag the whole sequence up.
 *   - If the counter is missing for the year (first use, or a reset), start the
 *     probe from `0001` so we recover the first genuinely-free slot.
 *   - Advance the counter to `usedSequence + 1`.
 *
 * All work uses the ambient transaction client from `getClient()`, so when the
 * caller runs this inside a transaction the counter advance and the subsequent
 * insert commit (or roll back) together. The `grievances.sirius_id` UNIQUE
 * constraint remains the final backstop against duplicates under a race.
 */

const COUNTER_VARIABLE_NAME = "grievance.nextid";
const MIN_SEQUENCE = 1;
const MAX_SEQUENCE = 9999;

function formatSiriusId(year: number, sequence: number): string {
  return `${year}${String(sequence).padStart(4, "0")}`;
}

async function siriusIdExists(siriusId: string): Promise<boolean> {
  const client = getClient();
  const [existing] = await client
    .select({ id: grievances.id })
    .from(grievances)
    .where(eq(grievances.siriusId, siriusId))
    .limit(1);
  return !!existing;
}

export async function generateGrievanceSiriusId(now: Date = new Date()): Promise<string> {
  const client = getClient();
  const year = now.getFullYear();
  const yearKey = String(year);

  const [counterRow] = await client
    .select()
    .from(variables)
    .where(eq(variables.name, COUNTER_VARIABLE_NAME))
    .limit(1);

  const counters: Record<string, number> =
    counterRow && counterRow.value && typeof counterRow.value === "object"
      ? { ...(counterRow.value as Record<string, number>) }
      : {};

  const stored = counters[yearKey];
  let sequence =
    typeof stored === "number" && Number.isInteger(stored) && stored >= MIN_SEQUENCE
      ? stored
      : MIN_SEQUENCE;

  let chosen: { id: string; sequence: number } | null = null;
  for (; sequence <= MAX_SEQUENCE; sequence++) {
    const candidate = formatSiriusId(year, sequence);
    if (!(await siriusIdExists(candidate))) {
      chosen = { id: candidate, sequence };
      break;
    }
  }

  if (!chosen) {
    throw new Error(
      `Cannot generate a grievance ID for ${year}: all ${MAX_SEQUENCE} sequence numbers are in use.`,
    );
  }

  counters[yearKey] = chosen.sequence + 1;

  // Upsert on the unique `name` so a first-ever generation racing with another
  // request cannot fail on the counter row's own uniqueness. The only conflict
  // we ever want to surface to the caller is the grievance `sirius_id` unique
  // constraint (handled as a 409 by the route); counter contention must not.
  await client
    .insert(variables)
    .values({ name: COUNTER_VARIABLE_NAME, value: counters })
    .onConflictDoUpdate({ target: variables.name, set: { value: counters } });

  return chosen.id;
}
