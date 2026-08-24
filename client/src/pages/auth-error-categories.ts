/**
 * Allowlist of SAML failure categories that the server may include as the
 * `?category=` param.  Mirrors the category strings produced by
 * `categorizeSamlError` on the server.  Unknown or missing values are ignored
 * so no free-text ever appears from the URL.
 *
 * Kept in its own module so it can be imported by tests without pulling in
 * the full React page component.
 */
export const CATEGORY_REASONS: Readonly<Record<string, string>> = {
  audience_mismatch:
    "Audience mismatch: the identity provider's Audience URI (SP Entity ID) does not match this application's issuer. Make both sides identical.",
  invalid_signature:
    "Signature validation failed: the response/assertion signature does not verify against the configured IdP certificate, or a required signature is missing. Check the certificate pasted in SAML_CERT and that the IdP signs the assertion.",
  certificate_problem:
    "Certificate problem: the configured IdP signing certificate is missing or invalid (SAML_CERT).",
  assertion_timing:
    "Assertion timing rejected (expired or not yet valid): usually clock skew between the identity provider and this server, or a stale/replayed response.",
  recipient_mismatch:
    "Recipient/Destination mismatch: the identity provider is posting to a different callback URL than this application expects. The Single sign-on (ACS) URL must exactly match the application's callback URL.",
  in_response_to:
    "InResponseTo validation failed: the response does not match an outstanding login request (IdP-initiated flow or an expired login attempt).",
  missing_assertion:
    "The sign-in response contained no SAML assertion (malformed or truncated response from the identity provider).",
  idp_status_error:
    "The identity provider returned a non-success SAML status. Check the IdP-side assignment/configuration for this user and application.",
  // "unrecognized" is intentionally omitted — the generic error message is
  // more helpful than surfacing "Unrecognized SAML error" to the user.
};
