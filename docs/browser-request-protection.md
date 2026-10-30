# Browser request protection

The application rejects untrusted browser mutations before body parsing, session
restoration, provider middleware, or application handlers. This is independent
of authorization: passing the origin check does not grant any permission.

## Request rules

- All methods other than GET, HEAD, and OPTIONS require proven same-origin
  provenance, including local login, public browser actions, and uploads.
- The existing GET/HEAD logout and dispatch status-options routes also require
  this check because they change the session or persist derived state.
- A present Origin must be a single serialized HTTP(S) origin exactly matching
  the current registry-resolved PUBLIC_URL. Null, empty, malformed, foreign, and
  sibling-subdomain origins are refused. A bad Origin never falls back to Referer.
- Without Origin, a valid HTTP(S) Referer from that exact origin is accepted.
  Without either, the request is refused with 403 / CSRF_ORIGIN_REFUSED.
- Sec-Fetch-Site: cross-site is refused even if other headers appear trusted.
  Missing or same-site Fetch Metadata is not itself permission.
- Host and X-Forwarded-Host do not determine the trusted origin. PUBLIC_URL
  provides the existing deployment and proxied-development fallback behavior.
- JSON mutations with bodies require application/json (charset parameters are
  permitted). Non-JSON bodies receive 415 / JSON_BODY_REQUIRED. Bodyless actions
  need no content type. Multipart is supported only on the existing upload
  routes and still requires trusted provenance.

Session cookies explicitly use SameSite=Lax, HttpOnly, and Secure in production,
with the existing session lifetime. Restored legacy sessions also receive the
Lax policy; existing IDs are not rotated just for this change. Browsers update
their stored cookie attributes when the server next issues the session cookie.
Origin validation protects requests immediately, including older browser cookies.

## Protocol exceptions

These exceptions bypass browser provenance/body-format rules, **not their own
authentication or validation**:

- POST to the actual boot-mounted SAML callback, including a custom callback
  outside /api. The SAML provider verifies the assertion and establishes a
  session; its cross-site form POST is expected. The exemption follows the
  mounted path, not a subsequently edited configuration value.
- The two-segment /api/ws/:configuration/:operation route. The dispatcher
  independently authenticates web-service credentials and terminates unknown
  operations/paths; it does not fall back to the signed-in browser's authority.
- POST /api/comm/statuscallback/:commId, which uses the existing provider
  validation and never authorizes through the browser session.

Supplying an Authorization header does not exempt an ordinary API. Adding a
protocol or upload route requires explicitly reviewing its corresponding narrow
exception in the shared middleware; do not exempt entire API namespaces.

**Existing separate gap:** Twilio status callbacks validate signatures, but the
SendGrid and Lob callback validators currently accept requests without signature
verification. This task preserves that behavior, not an assurance of verified
delivery-status payloads. Those validators need separate hardening.

## Compatibility and verification

Normal browser requests supply Origin on mutations or Referer on same-origin
reads/navigation. Tools/scripts calling browser APIs with session cookies must
now supply an appropriate Origin or Referer; machine integrations should use
their independently authenticated web-service endpoints. Privacy tools that
strip both headers will receive a refusal rather than an implicit exception.

Keep PUBLIC_URL aligned with the origin users actually visit. Do not work around
a mismatched deployment URL by trusting arbitrary forwarded hosts.

Focused tests cover origin and content-type policy, real role/permission route
handlers with stubbed storage/authorization, multipart parsing, independent
protocol boundaries, and actual session-cookie issuance/restoration. External
identity-provider roundtrips require deployment-specific access and are not
replaced by these tests.
