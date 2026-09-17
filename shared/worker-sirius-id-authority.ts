import { z } from "zod";

/**
 * Durable control for who may allocate new worker Sirius IDs.
 *
 * The absent/invalid state intentionally resolves to `external`: S1 remains
 * authoritative until an administrator deliberately declares the S2 cutover.
 */
export const WORKER_SIRIUS_ID_AUTHORITY_VARIABLE =
  "worker_sirius_id_authority";

export const workerSiriusIdAuthoritySchema = z.enum(["external", "s2"]);

export type WorkerSiriusIdAuthority = z.infer<
  typeof workerSiriusIdAuthoritySchema
>;

export const DEFAULT_WORKER_SIRIUS_ID_AUTHORITY: WorkerSiriusIdAuthority =
  "external";

export function resolveWorkerSiriusIdAuthority(
  value: unknown,
): WorkerSiriusIdAuthority {
  const parsed = workerSiriusIdAuthoritySchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_WORKER_SIRIUS_ID_AUTHORITY;
}