import type { ExternalService } from "../maintenance-flag";

/**
 * The vendor being called. Deliberately the same vocabulary the shared vendor
 * guard uses, so "which services are refused during maintenance" and "which
 * services can be called at all" can never be two different lists.
 */
export type WcService = ExternalService;

/**
 * How hard the caller wants the vendor asked.
 *
 * - `default` — serve the stored answer while it is fresh, otherwise call.
 * - `force` — call regardless of how recent the stored answer is, and ignore
 *   any failure hold. This is the mode for a person pressing "refresh"
 *   because they believe the stored answer is wrong.
 * - `cached-only` — never call. Return whatever is stored, fresh or not.
 * - `local` — read neither the cache nor the network. Not a degraded
 *   `cached-only`: it is the mode for callers who are only passing through
 *   this code to get an argument normalized and are not asking the question
 *   at all. It must stay free of a query as well as of a call, because it is
 *   the mode on the hottest paths.
 */
export type WcRequestMode = "default" | "force" | "cached-only" | "local";

/** What the last attempt against a request key produced. */
export type WcOutcome = "success" | "failure";

/**
 * What the caller hands back after attempting the call.
 *
 * `answered` is declared, never inferred. Several of our transports catch
 * their own transport failures and return a locally-derived answer instead;
 * that answer does not throw, and treating "did not throw" as "the vendor
 * answered" is what stamps a record fresh on a call that never landed.
 */
export interface WcAnswer<TValue> {
  /** True only when the vendor itself answered. */
  answered: boolean;
  /**
   * The answer, when there is one. On a non-answer this may still carry
   * whatever the caller derived locally; the wrapper hands it back as
   * `fallback` and never stores it.
   */
  value?: TValue;
  /** Why the vendor did not answer. Recorded on the failure row. */
  error?: string;
  /**
   * Keep this answer? Defaults to true. `false` means the vendor answered but
   * the answer must not be remembered — a "no such record" that the vendor
   * may start recognising tomorrow, for instance.
   */
  store?: boolean;
}

/** What the wrapper resolved, and where it came from. */
export interface WcResult<TValue> {
  /** `none` means nothing was read and nothing was asked. */
  source: "cache" | "network" | "none";
  outcome?: WcOutcome;
  /** Whether the answer is inside its window, judged at read time. */
  fresh: boolean;
  /** The response body. Present only when `outcome` is `success`. */
  value?: TValue;
  /** When the vendor was asked for `value`. */
  fetchedAt?: Date;
  /** What the caller derived locally when the vendor did not answer. */
  fallback?: TValue;
  /** Why the vendor did not answer, from this attempt or the remembered one. */
  error?: string;
}

/**
 * A duration in milliseconds, or a way to work one out.
 *
 * A function is resolved on every request rather than at registration,
 * because some windows are a configurable setting and an operator who
 * shortens one expects it to bite now, not only on entries written afterwards.
 */
export type WcDuration = number | (() => number | Promise<number>);

/** Per (service, request type) caching behavior. */
export interface WcRequestBehavior<TArgs = any> {
  service: WcService;
  requestType: string;
  /**
   * What is being attempted, in plain words, for the maintenance refusal —
   * the second half of "Twilio is unavailable: cannot <operation>".
   */
  operation: string;
  /** Whether an answer to this request is kept at all. */
  cached: boolean;
  /**
   * Whether the answer must be storable before the vendor is asked. Defaults
   * to `cached`: a billable lookup made on a connection that will forget it
   * is money spent to learn something twice.
   */
  needsWritableDatabase?: boolean;
  /** How long an answer stays fresh. */
  freshFor: WcDuration;
  /** How long a failure is remembered, and therefore not retried. */
  failureRememberedFor: WcDuration;
  /**
   * Caller arguments → the canonical request key.
   *
   * Every option that changes the SHAPE of the answer belongs in this string.
   * Two requests that differ only in an option left out of the key collide on
   * one row, and the second caller silently gets the first one's answer.
   */
  requestKey: (args: TArgs) => string;
}
