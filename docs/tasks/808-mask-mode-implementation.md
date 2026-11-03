# Strict Mask Mode: implementation and verification

## Decision and scope

The presenter selected **Strict live-data de-identification** after reviewing
the HHS-informed options. This replaces the original convenience masking
proposal, not its audit history. See the [research](808-mask-mode-hipaa-research.md)
for all 18 Safe Harbor identifier categories and authoritative HHS sources.

This implementation intentionally replaces the normal application with a
standalone read-only view at `/mask-mode`. It does **not** make the original
worker, coverage, payment, configuration or document screens training-safe.
Those screens are unavailable while protected.

It is not HIPAA certification or approval to distribute a recording. The
organization still needs permitted-purpose/minimum-necessary decisions where
applicable, security/risk management, approved recording and transcription
services and contractual arrangements where required, a review of actual
knowledge/context and review of the whole recording including narration and
captions. The PHI-processing backend remains subject to applicable obligations.
No claim is made about any hosting/recording provider's BAA eligibility.

## Exact positive disclosure contract

Only an active presenter with active effective **staff** authority may request a fresh sample of at most
20 records. The data query selects only contact birth dates through the worker
relationship. The server projects each to exactly:

- `reference`: independently random UUID for this response, never a source ID,
  with no reverse lookup or re-identification map;
- `label`: the literal `Training person`;
- `birthYear`: a validated year, otherwise `null`;
- `ageGroup`: the literal `90 or older` for the conservative older-year bucket,
  otherwise `null`.

Years that could imply age 90+ are not disclosed. Malformed and future dates
have no fallback. Dates never include month/day/time. References change on
every response and are not placed in DOM attributes or links. No source record
ID, real name, ID fragment, address, geography, contact detail, employer,
relationship, health/coverage detail, free text, picture or credential is sent.

All eight supplied identifier types are fully withheld, without metadata-based
exceptions. Legacy AAT is treated as potentially bearer-sensitive. The live
component overrides/plugin counts are incomplete runtime evidence, not an
allowlist: optional components, dashboards, injected Weglot scripts and unknown
plugin output are all refused uniformly. This is why a newly enabled component
cannot quietly expand the protected view.

## Admission and egress

- The guard is installed after session/passport loading, **before provider
  routes, application context resolution, domain handlers and SPA serving**.
- ON and malformed/missing/unknown policy refuse all ordinary API methods and
  forms, cached/export/download paths, public-file fetches made with this
  session, redirects, streams, previews and vendor-triggering handlers.
- Protected document navigations redirect to `/mask-mode`; data requests get
  neutral refusal responses. No CSS blur, recursive key-name masking, raw
  error echo or JSON-only wrapper is relied upon.
- Control documents/scripts are code-owned. The document's CSP denies external
  scripts, images, frames and connections; no normal React app, auth SDK,
  WebSocket client or third-party injection mounts there.
- WebSocket upgrades reject non-OFF sessions; each queued application data frame
  independently obtains a session lease, reads fresh state and actor identity,
  and refuses delivery if either changed or the check fails. Delivery attempts
  are not acknowledgments; existing summary receipts remain acknowledgment-based.
- Responses are private/no-store and non-referring. Database, permission,
  persistence, lease and transition failures never become implicit OFF.
- Existing unhandled errors are logged internally as before, but browser error
  messages are neutral, including body-parser/session errors before admission.
- The existing OFF domain response bodies remain unchanged. Added controls,
  no-store/revision headers, neutral unhandled errors and coordination refusal
  under failure are deliberate cross-cutting changes.

No worker/contact/identifier values, audit records, stored files, vendor
requests or background jobs are rewritten for presentation. Background work
continues normally; this session cannot initiate business actions.

## Session and concurrency contract

- Policy is `{version:1, mode:on|off, revision}` inside the persisted session.
  Missing, invalid or unavailable policy is unknown/protected.
- Only a newly authenticated SID starts explicitly OFF. Unknown older sessions
  require explicit admin recovery or sign-out/new authentication.
- A same-origin JSON toggle requires fresh original-presenter admin authority,
  explicit acknowledgment and the exact expected revision. The transaction
  locks the session row, checks expiry/revision and changes only the policy.
- Ordinary whole-session passport/refresh saves preserve authoritative policy.
  Effective-actor changes retain mode and advance the presentation generation.
  A stale save of a previously loaded SID cannot recreate it after deletion;
  the observation marker is hashed, stripped before persistence/audit and
  differs from a legitimately regenerated authentication SID.
- Shared PostgreSQL session leases fence admitted HTTP responses and socket
  data frames. An exclusive toggle drains prior responses; timeout refuses
  rather than acknowledging protection prematurely. The locks work across
  Node processes. A dedicated bounded four-connection coordination pool avoids
  consuming the domain-query pool while holding response leases.
- Toggle/log-out coordination is exclusive. Lease loss destroys the response;
  failed persistence never gets a successful toggle acknowledgment.
- Successful changes emit a truthful after-commit audit event with effective
  actor and original-presenter provenance, never raw session payloads or SIDs.
- Signing out does not require toggle permission. Another browser session is
  unaffected. Masquerade start/stop is itself refused while protected; the mode
  survives ordinary session saves and any existing actor change.

## Browser, forms and help

The normal header offers **Mask Mode** as a full-document link. The initial
normal-app bootstrap verifies state before React/auth/providers/scripts mount.
Broadcast, focus/resume/BFCache handling, polling and response-body generation
checks rebootstrap on a changed/unknown policy. The immediate veil precedes a
hard navigation, discarding component/query/draft/cache/blob state for that
document rather than trying to sanitize it recursively.

The standalone banner distinguishes ON, OFF, unknown, signed-out and pending
checks. Neither ON nor any error is described as HIPAA approval. ON exposes only
the protected sample. There are no person-edit forms; direct masked-value
submissions, sends, charges and exports are refused before their handlers.
OFF needs acknowledgment, confirmation and server success before returning to
the normal application.

Built-in help `system:mask-mode` matches only `/mask-mode`, is discoverable in
the existing `/config/helps` framework outside protection, and the protected
page displays the same code-owned guidance without loading configurable help.
It covers prerequisites, roles/masquerade, sample limits, missing/error states,
side-effect refusal, recovery, confirmation, background work and limitations.

## Verification performed

All person/session examples in browser and route tests are fictional in-memory
doubles. No live sends, charges, exports or test-record inserts were used.

Commands:

```sh
npx vitest run tests/privacy tests/auth/session-lifecycle.test.ts \
  tests/help/workflow-coverage.test.ts tests/help/workflow-help-routes.test.ts \
  tests/ledger/payment-help.test.ts tests/edi/carrier-layout-csv.test.ts \
  --testTimeout=10000 --hookTimeout=10000
node --import tsx tests/privacy/browser.mjs
node --import tsx tests/privacy/real-lease.mts
```

The focused Vitest run passed **188 tests in 10 files**. The authorized
Chromium and real-PostgreSQL cross-process checks passed separately.

Coverage includes semantic helpers, positive projection/no source mutation,
unknown policy, strict body/origin/revision contracts, all ordinary methods,
download/redirect/SSE/error refusal, independent SIDs, original versus
masqueraded authority, revoked/missing users, missing/expired sessions,
whole-session stale saves, competing compare-and-set requests, actor
generations, delayed OFF-response draining, lease/read/permission/persistence
failure, socket refusal, truthful audit attribution and help path sanitization.

The Chromium fixture checks real ON/OFF/unknown controls, acknowledgment,
network responses, complete DOM/attributes, actual selected-text clipboard
copy, no third-party requests, stale normal-document cache/blob teardown,
cross-tab transitions, independent sessions, permission refusal, neutral
failure veil and refused forms. It uses the real standalone page/script,
middleware, projection and normal-app bootstrap guard.

The separate real-PostgreSQL check uses **two Node processes**, independent
database backends and advisory locks only. It proves concurrent readers,
cross-process exclusive refusal, bounded waits, drain and subsequent exclusive
acquisition. It inserts no business/session/user/test records.

The application workflow was restarted and reached ready. Its public
`/mask-mode` signed-out document was visually checked. The actual application's
signed-in/live worker UI was **not** browser-verified; authorized behavior was
verified with the isolated fixture, not an invented production login.
Configured completion validation supplies final lint/type/migration results.
Two pre-existing test-only typing issues were corrected so that validation
can run without unrelated false failures; production behavior was not changed
by those corrections.

## Boundaries that are not controlled

Mask Mode cannot erase old DOM/screenshots/BFCache pixels, earlier response
bytes already handed to a browser, browser/network/history/cache/clipboard
history, downloads, offline data or old recordings. A sleeping tab is not a
guaranteed cleared display. Use a fresh one-tab session and stop recording
before any transition or sign-in.

Previously copied/public/bearer links are not revoked. A request made without
the protected session remains governed by that link's existing authority.
Other browsers, applications, recording overlays, speech, captions and
screen-sharing destinations are outside the toggle. The narrow view does not
approve publication or establish that the organization lacks actual knowledge
of re-identification. Release for recording requires organizational review;
an expert's formal determination cannot be replaced by passing these tests.
