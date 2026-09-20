/**
 * What the framework says when it refuses a request, in one place.
 *
 * A leaf on purpose: both halves of the framework refuse in the same words,
 * and the vendor half is loaded by the core on demand. Keeping the wording in
 * the core would mean the vendor half importing the core back — a runtime
 * edge in the opposite direction to the one that loads it, which is the shape
 * of cycle that survives in Node and breaks under a transform that evaluates
 * modules differently.
 */

/**
 * The reason a request that had to be recorded was never made.
 *
 * Said out loud rather than left as an empty answer, because the alternative
 * is a caller reading "nothing came back" as a success with nothing in it.
 */
export function notRecordableReason(service: string, operation: string): string {
  return (
    `${service} was not asked to ${operation}: the result could not be recorded ` +
    `(the database is not accepting writes), and this operation must not happen unrecorded.`
  );
}
