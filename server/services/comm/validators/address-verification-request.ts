/**
 * The name of the Lob address verification request in the web client
 * framework.
 *
 * Kept dependency-free and apart from the verifier so the migration that
 * carries already-paid-for verifications into the cache can address the same
 * request without importing the comm stack.
 */

/** The vendor. Matches the shared vendor guard's name for it. */
export const ADDRESS_VERIFICATION_SERVICE = 'Lob' as const;

/**
 * The request type.
 *
 * Covers the one call we make: `POST /v1/us_verifications`, Lob's US address
 * verification. An international verification is a different endpoint and a
 * different answer, and would be its own request type.
 */
export const ADDRESS_VERIFICATION_REQUEST_TYPE = 'address-verification';

export interface AddressVerificationArgs {
  /**
   * The address in the canonical form we already compute for it —
   * `buildCanonicalAddress`, the same string the postal opt-in row is keyed
   * by. Never the raw user input: the same address typed in two ways would
   * otherwise be two questions and get bought twice.
   */
  canonicalAddress: string;
}

/**
 * The canonical request key: the canonical address and nothing else.
 *
 * Notably NOT the recipient. Lob is asked whether mail reaches the address,
 * not whether it reaches the person, so two people at one address are one
 * question — which is also why the stored answer must carry no name (see
 * `address-verification.ts`).
 */
export function addressVerificationRequestKey(args: AddressVerificationArgs): string {
  return args.canonicalAddress;
}
