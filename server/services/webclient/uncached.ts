import { wcRequest } from "./client";
import { notRecordableReason } from "./refusals";
import { getWcRequest, registerWcRequest } from "./registry";
import type { WcAnswer, WcService } from "./types";

/**
 * The uncached half of the web client framework.
 *
 * A send, a connection test and a call to somebody else's system all belong on
 * the framework — it is where the maintenance refusal, the writable-database
 * gate and the one description of what was attempted live — but none of their
 * answers may be kept. Replaying a stored answer for "send this letter" would
 * report a letter that was never printed, and a stored "the connection works"
 * is the one thing a connection test must never say on its own.
 *
 * So an entry registered here is uncached by construction rather than by
 * remembering to pass `cached: false`: nothing reads a row, nothing writes one,
 * and `wcUncachedRequest` refuses to run against an entry that caches.
 */

/**
 * Every uncached entry's request key.
 *
 * A request key exists to decide when two requests are the same one, which is
 * a question only a stored answer can be asked. Nothing here is stored, so
 * there is nothing to collide: the constant says that plainly, where a
 * per-caller key would suggest an identity that is never used.
 */
const UNCACHED_REQUEST_KEY = "(uncached)";

export interface UncachedWcRequest {
  service: WcService;
  requestType: string;
  /** What is being attempted, in plain words, for the maintenance refusal. */
  operation: string;
  /**
   * Whether the vendor may be asked when the answer cannot be recorded.
   *
   * Decided per entry, because the two halves of this list want opposite
   * answers. A send must not fire when its result cannot be written down: the
   * message leaves the building and nothing in here would know it went. A
   * connection test, a configuration read or a status poll has nothing to
   * record, and blocking it on a read-only connection would take away the one
   * tool an operator has while the site is in that state.
   */
  needsWritableDatabase: boolean;
}

/** Register an operation whose answer is never kept. */
export function registerUncachedWcRequest(entry: UncachedWcRequest): void {
  registerWcRequest({
    service: entry.service,
    requestType: entry.requestType,
    operation: entry.operation,
    cached: false,
    needsWritableDatabase: entry.needsWritableDatabase,
    // Windows over a row that is never written. Zero rather than a plausible
    // number, so nothing reads as if an answer had a shelf life here.
    freshFor: 0,
    failureRememberedFor: 0,
    requestKey: () => UNCACHED_REQUEST_KEY,
  });
}

/**
 * What a vendor operation's request carries: which connection it is for, and
 * the operation's own arguments.
 *
 * Both halves, because a vendor plugin can have several connections — two
 * Stripe accounts, two remote sites — and they are different far ends that
 * happen to share a code path.
 */
export interface WcVendorRequestArgs {
  configId: string;
  args: unknown;
}

/**
 * The canonical request key for a vendor operation.
 *
 * Vendor operations are all uncached today, so nothing is stored and nothing
 * can collide. This exists anyway because the day one of them starts caching,
 * the cost of having keyed them all on a constant is two connections silently
 * reading each other's stored answers — and that failure looks like a vendor
 * bug, not a framework one. Keying per connection now is free; discovering
 * later that it was needed is not.
 */
function vendorRequestKey(args: WcVendorRequestArgs): string {
  return `${args.configId}:${canonicalJson(args.args)}`;
}

/**
 * Arguments as a string that does not change when the caller's object happens
 * to be built key-by-key in a different order.
 */
function canonicalJson(value: unknown): string {
  if (value === undefined) return "";
  return (
    JSON.stringify(value, (_key, inner) =>
      inner && typeof inner === "object" && !Array.isArray(inner)
        ? Object.fromEntries(
            Object.entries(inner as Record<string, unknown>).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          )
        : inner,
    ) ?? ""
  );
}

/**
 * Register one vendor-plugin operation, keyed per connection.
 *
 * Same entry as {@link registerUncachedWcRequest} in every other respect; only
 * the identity of a request differs, because these carry which connection they
 * are for and the others have no such thing.
 */
export function registerUncachedWcVendorRequest(entry: UncachedWcRequest): void {
  registerWcRequest({
    service: entry.service,
    requestType: entry.requestType,
    operation: entry.operation,
    cached: false,
    needsWritableDatabase: entry.needsWritableDatabase,
    freshFor: 0,
    failureRememberedFor: 0,
    requestKey: vendorRequestKey,
  });
}

/**
 * What an uncached request produced: the system's own answer, or the reason
 * there is none.
 *
 * Exactly one of the two is present. `value` means the far end answered — the
 * answer may itself report a failure, which is still an answer. `error` means
 * it did not answer, or was never asked.
 */
export interface WcUncachedResult<TValue> {
  value?: TValue;
  error?: string;
}

export interface WcUncachedOptions<TValue> {
  service: WcService;
  requestType: string;
  /**
   * Make the call, declaring whether the far end answered. A non-answer
   * carries only `error`: with nothing stored there is no fallback to hand
   * back, and the caller builds its own failure shape from the text.
   */
  fetch: () => Promise<WcAnswer<TValue>>;
}

/**
 * Make an outbound request whose answer is never kept.
 *
 * Throws `MaintenanceModeError` when the call is refused, exactly as the
 * shared guard always did — a caller that turns failures into a normal-looking
 * result must let that one back out.
 */
export async function wcUncachedRequest<TValue>(
  options: WcUncachedOptions<TValue>,
): Promise<WcUncachedResult<TValue>> {
  const behavior = getWcRequest(options.service, options.requestType);
  if (behavior?.cached) {
    throw new Error(
      `"${options.service}:${options.requestType}" is registered as a cached request. ` +
        `wcUncachedRequest is for operations whose answer must never be stored or replayed; ` +
        `use wcRequest for a cached one.`,
    );
  }

  const result = await wcRequest<TValue>({
    service: options.service,
    requestType: options.requestType,
    args: undefined,
    fetch: options.fetch,
  });

  if (result.outcome === "success") return { value: result.value };
  if (result.outcome === "failure") {
    return { error: result.error ?? `${options.service} did not answer.` };
  }

  // Neither an answer nor a failure: the writable-database gate stopped the
  // call before it was made, and said so in the framework's own words.
  return {
    error:
      result.error ??
      notRecordableReason(options.service, behavior?.operation ?? options.requestType),
  };
}
