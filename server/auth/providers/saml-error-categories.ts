/**
 * Map common node-saml validation errors to a human-readable category and
 * reason an administrator can act on without server-log access. Falls back to
 * the raw message (which contains no assertion contents — node-saml messages
 * are short diagnostics).
 *
 * Kept in its own module so it can be imported by tests without pulling in
 * passport, storage, or other server infrastructure.
 */
export function categorizeSamlError(message: string): { category: string; reason: string } {
  const m = message.toLowerCase();
  if (m.includes("audience")) {
    return { category: "audience_mismatch", reason: "Audience mismatch: the identity provider's Audience URI (SP Entity ID) does not match this application's issuer. Make both sides identical." };
  }
  if (m.includes("signature")) {
    return { category: "invalid_signature", reason: "Signature validation failed: the response/assertion signature does not verify against the configured IdP certificate, or a required signature is missing. Check the certificate pasted in SAML_CERT and that the IdP signs the assertion." };
  }
  if (m.includes("cert")) {
    return { category: "certificate_problem", reason: "Certificate problem: the configured IdP signing certificate is missing or invalid (SAML_CERT)." };
  }
  if (m.includes("expired") || m.includes("not yet valid") || m.includes("notbefore")) {
    return { category: "assertion_timing", reason: "Assertion timing rejected (expired or not yet valid): usually clock skew between the identity provider and this server, or a stale/replayed response." };
  }
  if (m.includes("recipient") || m.includes("destination")) {
    return { category: "recipient_mismatch", reason: "Recipient/Destination mismatch: the identity provider is posting to a different callback URL than this application expects. The Single sign-on (ACS) URL must exactly match the application's callback URL." };
  }
  if (m.includes("inresponseto")) {
    return { category: "in_response_to", reason: "InResponseTo validation failed: the response does not match an outstanding login request (IdP-initiated flow or an expired login attempt)." };
  }
  if (m.includes("missing") && m.includes("assertion")) {
    return { category: "missing_assertion", reason: "The sign-in response contained no SAML assertion (malformed or truncated response from the identity provider)." };
  }
  if (m.includes("status")) {
    return { category: "idp_status_error", reason: "The identity provider returned a non-success SAML status. Check the IdP-side assignment/configuration for this user and application." };
  }
  return { category: "unrecognized", reason: "Unrecognized SAML error — see the full error and SAML response in the log entry's metadata." };
}
