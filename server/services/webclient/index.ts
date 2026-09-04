/**
 * "wc" — the web client framework: the single path every outbound
 * third-party request takes.
 *
 * A request is named by (service, request type). A behavior registered under
 * that name says how long an answer stays fresh, how long a failure is
 * remembered, whether the answer is kept at all, and how the caller's
 * arguments become the canonical request key that decides when two requests
 * are the same one. `wcRequest` applies all of it, along with the maintenance
 * refusal and the "do not buy what cannot be stored" gate.
 *
 * Sits next to the inbound "ws" web-service tooling: ws is other systems
 * calling us, wc is us calling them.
 */
export { wcRequest, resetUnstorableHolds, type WcRequestOptions } from "./client";
export {
  registerUncachedWcRequest,
  wcUncachedRequest,
  type UncachedWcRequest,
  type WcUncachedOptions,
  type WcUncachedResult,
} from "./uncached";
export {
  registerWcRequest,
  getWcRequest,
  listWcRequests,
  resolveWcDuration,
} from "./registry";
export type {
  WcAnswer,
  WcDuration,
  WcOutcome,
  WcRequestBehavior,
  WcRequestMode,
  WcResult,
  WcService,
} from "./types";
