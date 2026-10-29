# SAML roundtrip investigation and operator checks

## Confirmed failure mechanisms

The client previously caught **every** `/api/auth/user` fetch, HTTP and JSON
error and returned `null`. An offline request, a 5xx, a wrong-service HTML
response, or an incomplete JSON envelope therefore looked identical to an
ordinary 401. Route guards sent the browser to sign-in without an explanation.
Only 401 now means unauthenticated; other failures show a retryable check error
without discarding a previously known user or navigating away.

The installed Passport-SAML strategy also defaults to starting a new sign-in
when a callback contains no SAML payload. An empty/misparsed ACS POST could
therefore restart the external flow instead of reporting the failed handoff.
The callback now rejects a missing response before invoking that fallback.

Neither finding proves the cause of the **original reported attempt**. The
available original evidence showed registration and an unauthenticated
current-user lookup, but no initiation or callback for that attempt. There was
no controlled external-IdP replay available in this workspace. In particular,
absence of a callback does **not** establish a SameSite/cookie failure.

## Session handoff

Successful assertion/account verification still calls Passport `logIn` with
sessions enabled. Passport regenerates and saves the authenticated session
before its callback. No second save or cookie-policy change was added.

Success now uses a 303 to `/api/auth/saml/complete`: a fresh GET with the
browser's cookie must restore an authenticated application user before the
normal `/` destination. Missing restoration and middleware failures use the
existing referenced `/auth-error` surface. A client-side per-tab, expiring
attempt hint also explains returns to sign-in after selecting the SAML button;
it is not an authentication token or evidence of callback delivery.

## System Logs

Filter module **auth** and operations beginning **saml_**:

1. `saml_initiation`: the selected login handler ran.
2. `saml_callback_received`: the callback path reached the ready app, **before**
   body parsing or session middleware. Includes the HTTP method and sanitized
   received origin, plus canonical callback origin and mounted path.
3. `saml_verification_started`: parsed callback reached the provider, including
   only the boolean `hasResponse`.
4. `saml_assertion_verified`: node-saml invoked sign-on verification; application
   account checks/role reconciliation still follow, unchanged.
5. `saml_verification_failed` / `saml_verification_rejected`: verification or
   application access failed. Existing failure references/debug captures remain.
6. `saml_session_established`: Passport's login/save callback succeeded.
7. `saml_session_restored`: the subsequent browser GET restored an application
   user. This is stronger evidence than a successful save alone.

`saml_response_missing`, `saml_session_missing`, `saml_handoff_failed`,
`saml_session_failed`, `saml_configuration_unavailable`, and
`saml_wrong_binding` identify other stopped stages. Handoff failures carry the
same safe reference shown to the user; session/verification failures retain
their existing referenced entries. Logging remains best-effort.

New milestone entries contain no assertion, attribute values, identity,
session id, cookie value, or query string. Existing explicitly enabled debug
captures and existing failure-record contents were not broadened or replaced.

## External prerequisites and interpreting missing evidence

- Read `/api/auth/saml/metadata` from the environment being tested. The IdP ACS
  destination must match its **exact canonical origin + callback path** and
  **HTTP-POST** binding. Do not substitute the browser's current origin for
  configured `PUBLIC_URL`.
- `SAML_CALLBACK_PATH` is mounted at startup. Restart after changing it; the
  strategy and metadata then use that mounted path.
- In split-role deployments, `/api/*` (except `/api/ws/*`) must reach the
  **api-user** service. A custom callback outside that scope needs compatible
  routing; a static service cannot process the SAML POST. The completion GET
  must reach api-user as well. Proxy redirects must not turn the callback POST
  into an empty GET or discard its form body.
- No initiation entry: confirm the selected button/request reached this
  environment and its user API service. No callback entry after initiation:
  inspect the IdP delivery destination and network/proxy/boot-status response.
  A request rejected before the ready application (upstream proxy, wrong
  service, startup gate) cannot create an auth milestone here.
- Callback entry but no verification entry: check parsing/session-read failure
  and its handoff reference. Body parsing is still subject to the existing
  limits, and signature/request checks have not been weakened.
- Session established but not restored: inspect the browser's response-cookie
  acceptance and subsequent request, canonical host, session-store read and
  common session-signing configuration across API replicas. A lost cookie is
  only one possible cause; the user message intentionally does not claim it.

No IdP, proxy, deployment, or cookie-security setting was changed.

## Verification performed

Focused tests exercise the real Express/Passport strategy and session-store
adapter with in-memory storage and only upstream cryptographic verification
stubbed: successful session/cookie restoration, rejected assertion, missing
payload, save/read failure, missing cookie, parser failure and initiation with
no callback. Existing live-configuration, sign-in observer and role-diagnostic
tests were also run. Fetch tests distinguish 401 from 403/404/5xx, network
failure, malformed JSON/HTML and incomplete success envelopes.

An isolated browser with intercepted fixture API responses exercised the real
app's retry from 500 to 401, normal sign-in, attempted-SAML explanation, offline
protected-route handling without redirection, malformed success handling,
auth-error reachability during a 500 and signed-in redirection out of login.
These browser fixtures are not an application auth bypass and are not shipped.
The actual public error page was visually checked.

External IdP assertion issuance/delivery and production routing were **not**
verified end to end. If the original symptom persists, use the milestones
above to identify the first missing handoff before changing external settings.
