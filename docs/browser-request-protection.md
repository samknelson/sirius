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

### Authenticated WebSocket upgrades

The notification socket at `/ws` (including query strings) requires an explicit,
single serialized HTTP(S) `Origin` matching the current registry-resolved
`PUBLIC_URL`. The upgrade receives HTTP 403 **before** session restoration or
the WebSocket handshake when Origin is absent, null, malformed, foreign, or a
sibling subdomain. Unlike HTTP requests, Referer is not a fallback.

There is no non-browser exemption on this session-authorized endpoint. A
non-browser notification client must provide both that explicit Origin and a
valid session; Origin alone is not authentication. Independently authenticated
machine integrations should use the web-service endpoints instead.

Host and forwarded headers never expand the allowlist. The registry's existing
platform-domain resolution supports proxied development; an explicitly
configured local HTTP origin must match its scheme and port too. Only `/ws`
upgrades are owned by this service, in both production and development. Other
paths, including Vite's `/__vite_hmr`, are left to their own upgrade listeners.

Focused in-memory handshake tests cover accepted/rejected origins, refusal
before session work and event delivery, trusted private notifications, live
registry changes, and independent upgrade-listener ownership.

### Independently authenticated HTTP protocols

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

Delivery callbacks authenticate independently of browser sessions:

- SendGrid verifies ECDSA/SHA-256 over the signed timestamp and original JSON
  bytes. In its webclient vendor configuration, set **Webhook Verification
  Public Key** (`webhookPublicKey`) to the base64 public key from SendGrid's
  **Signed Event Webhook** settings.
- Lob verifies the hexadecimal HMAC-SHA256 of `timestamp + "." + original body`.
  Store the webhook's signing secret in an environment secret and set
  **Webhook Signing Secret Name** (`webhookSecretName`) on the Lob vendor
  configuration to that secret's name. This is not the Lob API credential.
  The debugger's publicly known `secret` key is deliberately refused.
- Both require signed Unix timestamps within five minutes of server time,
  including a five-minute allowance for clock skew into the future. Keep the
  server clock synchronized. Retries need a current delivery signature; an old
  event creation date does not itself cause refusal.
- New sends record the originating vendor configuration. Keep that configuration
  and its verification settings for in-flight callbacks, even if disabled.
  Historical sends without a recorded configuration require exactly one matching
  vendor configuration; ambiguity, missing keys, or deleted configurations fail
  closed. Browser login and API send credentials never replace verification.
- Signed SendGrid/Lob events must match the saved provider message identifier
  for the communication named in the URL. A signed batch cannot update an
  unrelated communication.
- Twilio retains its account-matched configuration and standard signature
  verification, including form-encoded callback support.

Original callback bytes are captured only at this route, before JSON decoding.
Raw callback payloads and verification material are not included in callback
logs. Malformed JSON is refused without passing its payload-bearing parse error
to the general error logger.

Protocol references:
[SendGrid Event Webhook Security Features](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features)
and [Lob Webhook Signatures](https://help.lob.com/print-and-mail/getting-data-and-results/using-webhooks#webhook-signatures-11).

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
