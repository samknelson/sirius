import { buildCanonicalAddress } from '../providers/postal';
import type {
  AddressVerificationResult,
  PostalAddress,
  PostalTransport,
} from '../providers/postal';
import { registerWcRequest, wcRequest, type WcAnswer, type WcRequestMode } from '../../webclient';
import { isMaintenanceModeError } from '../../maintenance-flag';
import {
  ADDRESS_VERIFICATION_REQUEST_TYPE,
  ADDRESS_VERIFICATION_SERVICE,
  addressVerificationRequestKey,
  type AddressVerificationArgs,
} from './address-verification-request';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a verification stays fresh.
 *
 * Long, for the same reason the phone window is: a building does not stop
 * receiving mail twice a year, and Lob bills per verification. The window is
 * the only thing standing between "verify this address" on a screen someone
 * reloads and a charge per reload.
 */
const VERIFICATION_FRESH_FOR_MS = 180 * DAY_MS;

/**
 * How long a failed verification is left alone. Short: a failure here is an
 * outage or a missing key, and a long silence would hide a fixed one.
 */
const FAILURE_REMEMBERED_FOR_MS = 5 * 60 * 1000;

/** The provider that actually calls a vendor. */
const LOB_PROVIDER_ID = 'lob';

registerWcRequest<AddressVerificationArgs>({
  service: ADDRESS_VERIFICATION_SERVICE,
  requestType: ADDRESS_VERIFICATION_REQUEST_TYPE,
  operation: 'verify an address',
  cached: true,
  // A verification is billed. Making one on a connection that will forget the
  // answer means paying for it again on the very next call.
  needsWritableDatabase: true,
  freshFor: VERIFICATION_FRESH_FOR_MS,
  failureRememberedFor: FAILURE_REMEMBERED_FOR_MS,
  requestKey: addressVerificationRequestKey,
});

export interface PostalVerification extends AddressVerificationResult {
  /**
   * True when the vendor was asked just now. The derived deliverability
   * fields on the postal opt-in row are written as the cache fills, so this
   * is what decides whether writing them is telling the truth.
   */
  fromNetwork: boolean;
  /**
   * When this answer was obtained from the vendor — now for a call just made,
   * the stored answer's own timestamp for one served from the cache. It is
   * what "last verified" on a row means, so it must never be `now` for an
   * answer we did not just get.
   */
  verifiedAt?: Date;
}

export interface VerifyPostalAddressOptions {
  /**
   * How hard to ask. `default` serves a fresh stored answer; `force` is for a
   * person deliberately testing the vendor, who would learn nothing from a
   * stored one.
   */
  mode?: WcRequestMode;
}

/**
 * The single entry point for verifying a postal address.
 *
 * Every caller goes through here rather than calling the transport directly,
 * because the transport has no idea whether the same address was verified an
 * hour ago. The freshness window, the maintenance refusal and the "do not buy
 * what cannot be stored" rule are all applied by the web client framework;
 * this function's job is to say what a Lob verification means once one has
 * been made, and to keep the local provider out of the cache entirely.
 *
 * Throws `MaintenanceModeError` when a call would have to be made. That is
 * deliberate: a refusal must reach the caller as a refusal, never flattened
 * into an address Lob judged undeliverable.
 */
export async function verifyPostalAddress(
  transport: PostalTransport,
  address: PostalAddress,
  options?: VerifyPostalAddressOptions,
): Promise<PostalVerification> {
  // Only the Lob provider calls a vendor. The local provider's verifyAddress
  // is a format check we could run for free any number of times, and storing
  // its verdict would stamp an address as vendor-verified on the strength of
  // a call that was never made.
  if (transport.id !== LOB_PROVIDER_ID) {
    return { ...(await transport.verifyAddress(address)), fromNetwork: true, verifiedAt: new Date() };
  }

  const args: AddressVerificationArgs = { canonicalAddress: buildCanonicalAddress(address) };

  const result = await wcRequest<AddressVerificationResult>({
    service: ADDRESS_VERIFICATION_SERVICE,
    requestType: ADDRESS_VERIFICATION_REQUEST_TYPE,
    args,
    mode: options?.mode,
    fetch: () => verifyWithVendor(transport, address),
  });

  if (result.outcome === 'success' && result.value) {
    return {
      ...withCallerRecipient(result.value, address),
      fromNetwork: result.source === 'network',
      verifiedAt: result.fetchedAt,
    };
  }

  // The vendor did not answer. Whatever it derived locally beats nothing, and
  // is exactly what the transport would have returned without the wrapper.
  if (result.fallback) {
    return { ...withCallerRecipient(result.fallback, address), fromNetwork: true };
  }

  return {
    valid: false,
    deliverable: false,
    error: result.error || 'Address verification is unavailable',
    fromNetwork: result.source === 'network',
  };
}

/**
 * Make the verification and say what came back.
 *
 * Whether the vendor answered is declared here rather than inferred by the
 * framework from the absence of a thrown error, because this transport
 * catches its own transport failures — a missing key, a refused connection, a
 * Lob 4xx — and answers with `valid: false, deliverable: false` instead.
 * `rawResponse` is Lob's own fingerprint: it is set only from a body Lob
 * produced, so it is what separates a real "not deliverable" from a call that
 * never landed.
 */
async function verifyWithVendor(
  transport: PostalTransport,
  address: PostalAddress,
): Promise<WcAnswer<AddressVerificationResult>> {
  let result: AddressVerificationResult;
  try {
    result = await transport.verifyAddress(address);
  } catch (error) {
    if (isMaintenanceModeError(error)) throw error;
    return {
      answered: false,
      error: error instanceof Error ? error.message : 'Address verification failed',
    };
  }

  if (result.rawResponse === undefined) {
    return {
      answered: false,
      value: result,
      error: result.error || 'The provider answered without a Lob response',
    };
  }

  // A "no such address" answer is a real answer — the caller is told the
  // address is bad — but it is not kept: caching it would keep rejecting an
  // address the postal service may recognise once it is built.
  return { answered: true, value: withoutRecipient(result), store: result.valid };
}

/**
 * Strip the person out of an answer before it is stored.
 *
 * The request key is the address, so the stored answer is shared by everyone
 * at that address. A recipient name riding along in it would be handed to the
 * next caller — who addresses a letter with `normalizedAddress`.
 */
function withoutRecipient(result: AddressVerificationResult): AddressVerificationResult {
  const stripped: AddressVerificationResult = { ...result };
  if (stripped.normalizedAddress) {
    const { name, company, ...rest } = stripped.normalizedAddress;
    stripped.normalizedAddress = rest as PostalAddress;
  }
  if (stripped.rawResponse && typeof stripped.rawResponse === 'object') {
    const { recipient, ...rest } = stripped.rawResponse as Record<string, unknown>;
    stripped.rawResponse = rest;
  }
  return stripped;
}

/**
 * Put the caller's own recipient back on an answer.
 *
 * Applied to every answer the framework returns, cached or fresh, so it also
 * covers the rows carried over from before the cache existed — those were
 * written per opt-in row and do carry a name.
 */
function withCallerRecipient(
  result: AddressVerificationResult,
  address: PostalAddress,
): AddressVerificationResult {
  const answer: AddressVerificationResult = { ...result };
  if (answer.normalizedAddress) {
    answer.normalizedAddress = {
      ...answer.normalizedAddress,
      name: address.name,
      company: address.company,
    };
  }
  if (answer.rawResponse && typeof answer.rawResponse === 'object') {
    answer.rawResponse = { ...(answer.rawResponse as Record<string, unknown>), recipient: address.name };
  }
  return answer;
}
