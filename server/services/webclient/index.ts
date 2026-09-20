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
/**
 * The vendor half of the framework is deliberately NOT re-exported here.
 * `wc-vendor-context` reaches the plugin registry and the storage layer, and
 * this barrel is imported by boot-path clients that need neither; pulling it
 * in from here would put both into their module graph. Import
 * `services/webclient/wc-vendor-context` directly for `describeWcVendor` and
 * the vendor resolution errors. Making the CALL needs nothing from there —
 * `wcRequest` below takes the vendor shape too.
 */
export {
  wcRequest,
  resetUnstorableHolds,
  notRecordableReason,
  type WcRequestOptions,
  type WcTransportRequestOptions,
  type WcVendorRequestOptions,
  type WcVendorTarget,
} from "./client";
export {
  getWcRequest,
  listWcRequests,
  resolveWcCacheDurations,
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
