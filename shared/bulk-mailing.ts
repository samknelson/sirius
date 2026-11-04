import { getCommStatusBucket } from "./commStatus";

/** Successful postal handoff, including offline workflow completion.
 * Unlike a carrier receipt, offline is NOT proof of physical delivery. */
export function isMailingCompleted(status: string | null | undefined) {
  return status === "offline" || getCommStatusBucket(status) === "success";
}
