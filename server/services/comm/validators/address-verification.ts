import type {
  AddressVerificationResult,
  PostalAddress,
} from '../providers/postal';
import { wcRequest, type WcRequestMode } from '../../webclient';
import { isMaintenanceModeError } from '../../maintenance-flag';
import type { WcVendorTarget } from "../../webclient";
import { WcVendorError } from '../../webclient/wc-vendor-context';
import type { PostalVendorTypesLoaded } from "../../../plugins/wc-vendors/postal-types";
void (undefined as unknown as PostalVendorTypesLoaded);

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
 * this function's job is to interpret the selected vendor's verification
 * answer once one has been made.
 *
 * Throws `MaintenanceModeError` when a call would have to be made. That is
 * deliberate: a refusal must reach the caller as a refusal, never flattened
 * into an address the vendor judged undeliverable.
 */
export async function verifyPostalAddress(
  _transportOrVendor: WcVendorTarget,
  address: PostalAddress,
  options?: VerifyPostalAddressOptions,
): Promise<PostalVerification> {
  let result;
  try {
    result = await wcRequest({
      vendor: { any: true },
      operation: "communications.postal.address.verify",
      args: address,
      mode: options?.mode,
    });
  } catch (error) {
    if (isMaintenanceModeError(error) || error instanceof WcVendorError) throw error;
    return {
      valid: false,
      deliverable: false,
      error: error instanceof Error ? error.message : "Address verification is unavailable",
      fromNetwork: false,
    };
  }

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
