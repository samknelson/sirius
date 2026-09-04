/**
 * The name of the phone Lookup request in the web client framework.
 *
 * Kept dependency-free and apart from the validator so the migration that
 * carries already-paid-for answers into the cache can address the same
 * request without importing the comm stack.
 */

/** The vendor. Matches the shared vendor guard's name for it. */
export const PHONE_LOOKUP_SERVICE = 'Twilio' as const;

/**
 * The request type.
 *
 * Covers the one shape of Lookup we make: the `line_type_intelligence` field
 * set. A different field set is a different answer and would be a different
 * request type, not the same one with another argument.
 */
export const PHONE_LOOKUP_REQUEST_TYPE = 'phone-lookup';

export interface PhoneLookupArgs {
  /** The number in E.164, as normalized by our own parse. */
  phoneNumber: string;
}

/**
 * The canonical request key: the E.164 number and nothing else. The caller
 * passes no other argument, and our own normalization is what produces the
 * string — never the provider's, so an answer can never drift the key.
 */
export function phoneLookupRequestKey(args: PhoneLookupArgs): string {
  return args.phoneNumber;
}
