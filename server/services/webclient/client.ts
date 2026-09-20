import { assertExternalServiceAllowed, isMaintenanceModeError } from "../maintenance-flag";
import { notRecordableReason } from "./refusals";

export { notRecordableReason };
import { logger } from "../../logger";
import { getTodayYmd } from "@shared/utils/date";
import { wcCacheStorage, wcRequestKeyHash, type WcCacheEntry } from "../../storage/wc-cache";
import { wcStatsStorage } from "../../storage/wc-stats";
import { runOutsideTransaction } from "../../storage/transaction-context";
import { getWcRequest, resolveWcCacheDurations, resolveWcDuration } from "./registry";
import type { WcAnswer, WcRequestBehavior, WcRequestMode, WcResult, WcService } from "./types";
// Type-only, and deliberately so: the vendor half of the framework lives
// behind a dynamic import below, so nothing about the plugin registry is
// pulled in at module load by the many boot-path callers of this file.
import type {
  WcVendorOperationArgs,
  WcVendorOperationName,
  WcVendorOperationResult,
} from "../../plugins/wc-vendors/types";

/**
 * Ask a service this module already knows how to reach: the caller brings the
 * transport.
 *
 * This is the shape for the direct clients — the ones that hold an SDK or a
 * `fetch` of their own and only want the framework's decisions around it.
 */
export interface WcTransportRequestOptions<TValue> {
  service: WcService;
  requestType: string;
  /** Whatever the registered canonicalizer expects. */
  args: unknown;
  mode?: WcRequestMode;
  /**
   * Resolved WC vendor connection. Framework-internal: direct transports leave
   * this absent and are counted in the legacy/unattributed bucket.
   */
  configurationId?: string;
  /**
   * Make the call. Invoked only when the wrapper has decided the vendor
   * should be asked, and must declare whether the vendor answered.
   */
  fetch: () => Promise<WcAnswer<TValue>>;
}

/** Historic name for {@link WcTransportRequestOptions}. */
export type WcRequestOptions<TValue> = WcTransportRequestOptions<TValue>;

/**
 * Which connection a vendor request is for.
 *
 * Exactly one of the target forms, and the type says so: naming both is a compile
 * error rather than a silent precedence rule, because "the config id wins over
 * the plugin id" is the kind of thing a caller reads once and then contradicts.
 *
 * - `configId` — this connection, chosen by whoever is asking.
 * - `pluginId` — this vendor's one enabled connection. Refused when there is
 *   none and when there is more than one; see `resolveDefaultWcVendor`.
 * - `any` — the one enabled connection assigned to the requested operation.
 *   Refused when there is none and when there is more than one assignment.
 */
export type WcVendorTarget =
  | { configId: string; pluginId?: never }
  | { pluginId: string; configId?: never }
  /**
   * Resolve the one enabled connection assigned to the requested operation.
   * This is deliberately operation-scoped: communication callers must not
   * select a provider for an entire medium when different providers expose
   * different operations.
   */
  | { any: true; configId?: never; pluginId?: never };

/**
 * Ask a vendor plugin to do one of the things it declares: the framework
 * brings the transport.
 *
 * The caller names the operation, not a method, and never sees the credential
 * the handler is given.
 */
export interface WcVendorRequestOptions<N extends WcVendorOperationName> {
  vendor: WcVendorTarget;
  operation: N;
  args: WcVendorOperationArgs<N>;
  mode?: WcRequestMode;
}

/**
 * Answers we paid for and could not keep.
 *
 * The hold that stops a request being retried lives in the cache table, so it
 * survives a restart and is shared across processes. That mechanism is exactly
 * unavailable in the one case this map covers: the writable-database gate
 * passed, the vendor was asked and answered, and the write then failed because
 * the connection turned read-only mid-call. The money is already spent and
 * nothing can be written — including a hold — so the only place left to
 * remember it is here. Short-lived by construction.
 */
const unstorableHolds = new Map<string, number>();

function holdKey(behavior: WcRequestBehavior, requestKey: string): string {
  return `${behavior.requestType}:${wcRequestKeyHash(requestKey)}`;
}

function inUnstorableHold(behavior: WcRequestBehavior, requestKey: string): boolean {
  const key = holdKey(behavior, requestKey);
  const until = unstorableHolds.get(key);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  unstorableHolds.delete(key);
  return false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Count one call we actually made.
 *
 * Off the caller's transaction, deliberately, and for two independent reasons:
 * on the caller's client a failed upsert would abort the caller's transaction
 * and turn a best-effort statistic into a fatal error, and a caller that later
 * rolled back would discard the record of a call that really happened and was
 * really paid for. Failures are logged and swallowed — the request the caller
 * asked for succeeds or fails on its own merits, never on this.
 */
async function countCall(
  behavior: WcRequestBehavior,
  configurationId?: string,
): Promise<void> {
  try {
    await runOutsideTransaction(() =>
      wcStatsStorage.recordCall(
        behavior.service,
        behavior.requestType,
        getTodayYmd(),
        configurationId ?? null,
      ),
    );
  } catch (error) {
    logger.error("Failed to count a web client call", {
      service: "webclient",
      vendor: behavior.service,
      requestType: behavior.requestType,
      error: errorMessage(error),
    });
  }
}

function storedError(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const value = (response as { error?: unknown }).error;
  return typeof value === "string" ? value : undefined;
}

/**
 * The single entry point for an outbound third-party request.
 *
 * Two shapes, one door. A caller either brings its own transport (`service` +
 * `fetch`) or names a vendor plugin and an operation (`vendor` + `operation`);
 * either way the framework owns the same decisions — the maintenance refusal,
 * the cache, the writable-database gate, the usage count — and hands back the
 * same {@link WcResult}. The shape a caller writes follows from how the vendor
 * is reached, which is an implementation detail of the vendor and not
 * something a domain module should have to know or restate.
 *
 * Everything about the decision — how long an answer stays fresh, how long a
 * failure is remembered, what makes two requests the same — comes from the
 * registry and is read now, so a changed policy takes effect on the next
 * request rather than only on entries written afterwards.
 *
 * Throws `MaintenanceModeError` when the call it was about to make is refused;
 * a request served from the cache is not a call and is not refused. A vendor
 * request also throws when it cannot be addressed at all — no such connection,
 * no single default, a disabled config, a missing credential, an operation the
 * vendor does not declare — because none of those are answers about the far
 * end. Everything the far end itself did comes back in the result.
 */
export function wcRequest<TValue>(
  options: WcTransportRequestOptions<TValue>,
): Promise<WcResult<TValue>>;
export function wcRequest<N extends WcVendorOperationName>(
  options: WcVendorRequestOptions<N>,
): Promise<WcResult<WcVendorOperationResult<N>>>;
export async function wcRequest(
  options:
    | WcTransportRequestOptions<unknown>
    | WcVendorRequestOptions<WcVendorOperationName>,
): Promise<WcResult<unknown>> {
  if ("vendor" in options) {
    // Loaded on demand. The vendor half reaches the plugin registry and the
    // storage layer, and this file is on the boot path of every direct client;
    // importing it up here would drag both into their module graph and invite
    // exactly the initialization cycles that barrel imports cause.
    const { runWcVendorRequest } = await import("./wc-vendor-context");
    return runWcVendorRequest(options, wcTransportRequest);
  }
  return wcTransportRequest(options);
}

/**
 * The framework's decisions around a transport the caller supplies.
 *
 * Vendor-blind by construction: the vendor half calls this with a `fetch` that
 * runs the plugin's handler, so there is exactly one implementation of the
 * cache, the refusal, the gate and the count.
 */
async function wcTransportRequest<TValue>(
  options: WcTransportRequestOptions<TValue>,
): Promise<WcResult<TValue>> {
  const behavior = getWcRequest(options.service, options.requestType);
  if (!behavior) {
    throw new Error(
      `No web client behavior registered for "${options.service}:${options.requestType}". ` +
        `Register one before making the request — an unregistered request has no ` +
        `canonical key and no idea what to keep.`,
    );
  }

  const mode: WcRequestMode = options.mode ?? "default";

  // Fully local: neither the cache nor the network is read. Callers on this
  // path are passing through to have an argument normalized, not to ask the
  // question, and there are enough of them that a query here would be felt.
  if (mode === "local") return { source: "none", fresh: false };

  const requestKey = behavior.requestKey(options.args);
  const now = Date.now();

  let entry: WcCacheEntry | undefined;
  if (behavior.cached) {
    try {
      entry = await wcCacheStorage.read(behavior.requestType, requestKey);
    } catch (error) {
      logger.error("Failed to read the web client cache", {
        service: "webclient",
        vendor: behavior.service,
        requestType: behavior.requestType,
        error: errorMessage(error),
      });
    }
  }

  const sharedDurations = behavior.cached
    ? await resolveWcCacheDurations(behavior.requestType)
    : undefined;
  const freshFor =
    sharedDurations?.freshFor ?? await resolveWcDuration(behavior.freshFor);
  const failureRememberedFor =
    sharedDurations?.failureRememberedFor ??
    await resolveWcDuration(behavior.failureRememberedFor);
  const window = entry?.outcome === "failure" ? failureRememberedFor : freshFor;
  const fresh = entry ? now - entry.fetchedAt.getTime() < window : false;

  const stored = (): WcResult<TValue> => {
    if (!entry) return { source: "none", fresh: false };
    return {
      source: "cache",
      outcome: entry.outcome,
      fresh,
      value: entry.outcome === "success" ? (entry.response as TValue) : undefined,
      fetchedAt: entry.fetchedAt,
      error: entry.outcome === "failure" ? storedError(entry.response) : undefined,
    };
  };

  if (mode === "cached-only") return stored();

  // A fresh entry answers the question. A fresh FAILURE answers it too: it is
  // the hold that stops an outage turning every read into another attempt.
  if (mode === "default" && entry && fresh) return stored();

  // Every request the wrapper is about to make is refused during maintenance,
  // in the shared guard's own words.
  assertExternalServiceAllowed(behavior.service, behavior.operation);

  if (inUnstorableHold(behavior, requestKey)) return stored();

  const needsWritable = behavior.needsWritableDatabase ?? behavior.cached;
  if (needsWritable && !(await wcCacheStorage.canStore())) {
    // Refused, not degraded: an answer that cannot be stored would be bought
    // again on the very next call. A previously stored answer still answers;
    // with nothing stored, the refusal says so in words rather than handing
    // back an empty result a caller could read as an answer.
    if (entry) return stored();
    return {
      source: "none",
      fresh: false,
      error: notRecordableReason(behavior.service, behavior.operation),
    };
  }

  let answer: WcAnswer<TValue>;
  try {
    answer = await options.fetch();
  } catch (error) {
    // A refusal is not a vendor failure and must not become a hold.
    if (isMaintenanceModeError(error)) throw error;
    answer = { answered: false, error: errorMessage(error) };
  }

  // The vendor was contacted. Counted here and nowhere else: everything above
  // this line either answered from the cache or refused before the call, and a
  // failed attempt below it is still a call we made.
  await countCall(behavior, options.configurationId);

  if (answer.answered) {
    const fetchedAt = new Date();
    if (behavior.cached && (answer.store ?? true)) {
      try {
        await wcCacheStorage.writeSuccess(
          behavior.service,
          options.configurationId ?? null,
          behavior.requestType,
          requestKey,
          answer.value ?? null,
        );
      } catch (error) {
        logger.error("Paid for a web client answer that could not be stored", {
          service: "webclient",
          vendor: behavior.service,
          requestType: behavior.requestType,
          error: errorMessage(error),
        });
        unstorableHolds.set(holdKey(behavior, requestKey), Date.now() + failureRememberedFor);
      }
    }
    return {
      source: "network",
      outcome: "success",
      fresh: true,
      value: answer.value,
      fetchedAt,
    };
  }

  if (behavior.cached) {
    try {
      await wcCacheStorage.writeFailure(
        behavior.service,
        options.configurationId ?? null,
        behavior.requestType,
        requestKey,
        answer.error,
        new Date(now - freshFor),
      );
    } catch (error) {
      logger.error("Failed to record a web client failure", {
        service: "webclient",
        vendor: behavior.service,
        requestType: behavior.requestType,
        error: errorMessage(error),
      });
    }
  }

  // A stored answer, even one the failure just displaced, beats nothing: the
  // caller asked a question we have answered before.
  if (entry?.outcome === "success") {
    return { ...stored(), fallback: answer.value, error: answer.error };
  }

  return {
    source: "network",
    outcome: "failure",
    fresh: false,
    fallback: answer.value,
    error: answer.error,
  };
}

/** Test seam: forget the in-memory unstorable holds. */
export function resetUnstorableHolds(): void {
  unstorableHolds.clear();
}
