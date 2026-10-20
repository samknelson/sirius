# Online checkout and saved-method help coverage

Verified 2026-10-19 against this checkout and the workspace development database.
This is an addendum to the 2026-10-14 [coverage audit](in-app-help-coverage-audit.md),
not a reassessment of its other families or historical counts.

## Delivered family/path/entry inventory

All four entries are registered built-ins, have a plain-text summary and expanded
details, and use the five prescribed semantic sections. No local help was seeded,
edited, deleted, or overridden.

| Family | Browser surface | Stable entry ID | Registered path patterns |
| --- | --- | --- | --- |
| F08 | Worker account chooser, `/workers/:id/ledger/pay` | `system:worker-online-payment-accounts` | `/workers/%/ledger/pay` |
| F08 | Authenticated shared checkout, `/pay/:eaId` | `system:online-payment-checkout` | `/pay/0%`, `/pay/1%`, `/pay/2%`, `/pay/3%`, `/pay/4%`, `/pay/5%`, `/pay/6%`, `/pay/7%`, `/pay/8%`, `/pay/9%`, `/pay/a%`, `/pay/b%`, `/pay/c%`, `/pay/d%`, `/pay/e%`, `/pay/f%` |
| F08 | Authenticated shared receipt, `/pay/receipt/:sessionId` | `system:online-payment-receipt` | `/pay/receipt/%` |
| F09 | Worker saved methods, `/workers/:id/ledger/payment-methods` | `system:worker-payment-methods` | `/workers/%/ledger/payment-methods` |

The worker `/workers/:id/ledger/pay/:eaId` alias immediately redirects to the
chooser with an `eaId` query and then to checkout for an offered account. It is
not a separate help surface. Query strings do not determine help matching.

### Path boundary and wildcard evidence

The existing `%` matcher crosses `/` and can match empty text. `/pay/%` would
therefore put checkout procedures on every receipt. Checkout instead enumerates
the first hexadecimal character of generated ledger-EA UUIDs (see `ledgerEa` in
`shared/schema.ts`). This covers current generated IDs without changing the help
framework. It deliberately does not claim coverage for arbitrary non-hex-prefixed
custom account identifiers; revisit the patterns if the identifier contract changes.

Representative synthetic matches:

| Path | Payment help IDs (suffix after `system:`) |
| --- | --- |
| `/workers/fictional/ledger/pay` | `worker-online-payment-accounts` |
| `/workers/fictional/ledger/payment-methods` | `worker-payment-methods` |
| `/pay/a0000000-0000-4000-8000-000000000000` | `online-payment-checkout` |
| `/pay/receipt/b0000000-0000-4000-8000-000000000000` | `online-payment-receipt` only |

Tests exercise all 16 UUID prefixes on checkout and receipt routes. They also
explicitly exercise nested receipt paths: these never get checkout procedures.
Sibling worker Accounts/ECHP/Benefits tabs, employer methods, staff ledger-payment
pages, configuration, APIs, case changes, trailing worker-tab slashes, and
suffix near misses get none of these entries.

Remaining **existing matcher limitations are explicit**, not disguised as route
validation: `/workers/fictional/nested/ledger/pay` matches chooser help;
`/pay/<hex-prefixed-id>/nested` and its trailing-slash variant match checkout help;
`/pay/receipt/<id>/nested` matches receipt help. A malformed
`/pay/<hex-prefixed-id>/receipt/<id>` matches checkout help, but is not the shipped
receipt route. These malformed nested paths are not delivered page routes. No
single-segment wildcard, exclusion rule, matcher change, or help UI change was
introduced in this documentation work.

## Behavior and wording evidence

| Source inspected | Claims verified for authoring |
| --- | --- |
| `client/src/App.tsx`, `shared/tabRegistry.ts` | Shared checkout/receipt require authentication and ledger; worker chooser and method page have their own policy gates; alias redirect and exact current paths. |
| `client/src/pages/worker-ledger-payment.tsx` | **Choose an account to pay**, **Posted balance**, **Pending**, **Available to pay**, **Your unfinished payments**, **Check status**, **Pay this account**, loading/empty/requested-account states. |
| `client/src/pages/shared-checkout.tsx`, `shared/ledger/checkout-selection.ts` | Full balance versus offered whole-statement selection, oldest-first credits and explicit transfers, pending reservations and unknown-allocation blockers, minimum/current-quote refusals, accepted types and compatible saved methods, current consent, review/edit/secure confirmation, one-off new methods and existing-attempt recovery. |
| `client/src/pages/shared-payment-receipt.tsx` | Exact status headings, provider confirmation versus ledger pending/cleared, received/cleared dates, confirmation number, **Retry** versus **Check status**, terminal-only **Try again**, constrained **Abandon this payment** and failure recovery. |
| `client/src/pages/worker-payment-methods.tsx`, `server/modules/ledger/payment-methods.ts` | Exact add/provider/default/remove controls, consent and secure setup, separate read/manage capability, errors and empty state, local inactive-history retention, best-effort provider detachment rather than a guarantee. |
| `server/modules/ledger/online-payment-authority.ts`, `shared/access-policies/worker/ledger-pay.ts`, `shared/access-policies/worker/ledger-methods.ts` | Own linked worker plus separate pay/method permission; staff online-action refusal; employer payment authority requires an active grant. Viewing accounting is not permission to charge. |
| `server/modules/ledger/payment-attempts.ts`, `payment-initiation.ts`, `payment-settlement.ts` (same directory) | Account/gateway/type/consent checks, creator-scoped receipt/cancel, reserved attempts and provider evidence, ledger posting, provider-confirmed cancellation only before confirmation begins. A failed request is not proof that no provider payment exists. |
| `server/help/system/index.ts`, `server/help/path-match.ts`, `server/modules/helps.ts`, `server/storage/helps.ts`, `shared/utils/html/policies.ts`, `client/src/components/HelpDisplay.tsx`, `client/src/pages/config/helps.tsx` | Registry, stable IDs, actual lookup, sanitizer, merged system/local ownership, authentication and admin controls, inline summary, **more** / **Help**, five-minute cache, **System** / **Built-in** listing labels. |

Existing built-ins were inspected; none supplied reusable online-payment
procedures. Existing guidance was left unchanged. New entries reuse the current
registry, sanitizer, and display components, not a second help system.

Consequential warnings precede instructions for provider confirmation, method
removal, and abandonment. Receipt guidance contains no checkout-start procedure.
No text promises automatic payment from a default method, immediate ACH settlement,
refunding/reversal, unrestricted cancellation, automatic recreation of secure
entry, anonymous checkout, or resubmission after a status error.

## Verification results and access limits

### Source, matcher, sanitizer, and isolated HTTP checks — passed

Command:

```sh
npx vitest run tests/ledger/payment-help.test.ts \
  tests/comm/worker-comms-help.test.ts \
  tests/sitespecific/worker-benefits-summary-help.test.ts
```

Result: **3 files, 38 tests passed**.

The new suite uses the actual system registry, matcher, `rich-document` sanitizer,
and help HTTP route registration. It verifies unique IDs, summaries, retained
headings/steps/labels/warnings, intended matches and near misses, wildcard
collisions, and receipt/checkout separation.

Its HTTP tests use **an isolated Express harness with fake sign-in and fictional
in-memory local help**, not app credentials or a real signed-in session. They
verify unauthenticated refusal, authenticated-style listing and lookup, sanitized
system entries, and a matching local entry remaining alongside built-ins without
mutation. The harness is test-only and does not bypass authentication in the app.
No payment route or provider endpoint is called by this suite.

### Workspace local guidance — read-only inspected

The physical `help` table was confirmed from schema/storage. Read-only development
queries `SELECT id, paths, summary, details FROM help ORDER BY id` and subsequent
`SELECT count(*) AS local_entries FROM help` both found **zero local entries**.
There was no local guidance to contradict or reproduce. These results do not
establish what another deployment contains. No local-help writes were performed.

### Running app API/browser — limited by authentication

- Restarted **Start application** after the server help changes. Logs reached
  **Application fully initialized and ready**.
- Fresh proxied `GET /config/helps` returned **200** (application shell).
- Fresh unauthenticated `GET /api/helps` and
  `GET /api/helps/lookup?path=%2Fpay%2Freceipt%2Ffictional` each returned **401**.
  These prove the live read-authentication boundary, not signed-in listing content.
- The initial screenshot timed out during initial page loading; a subsequent
  fresh screenshot of `/config/helps` rendered the sign-in form. Capture logs
  included local Vite websocket/connection warnings and unauthenticated/missing
  resource responses. No help dialog was opened.
- **Not verified in a real signed-in browser:** `/config/helps` System/Built-in
  rows, fresh authorized help listing/lookup, inline summaries on the four payment
  surfaces, **more** / **Help** dialog headings and scrolling, mobile rendering,
  or signed-in absence on unrelated routes. Source and isolated HTTP tests are
  not substitutes for those checks.

No payment was submitted, canceled, refunded, or charged for verification. No
method was attached, removed, or made default; no gateway configuration or local
help was changed; no provider test request was made. In particular, no receipt
API was used as a supposedly read-only test: its GET handler can retrieve provider
evidence and settle an attempt. No real card/bank details, credentials, client
secrets, or personal records are in the authored help or fixtures.

### Audit handoff classification

F08 and F09 now have **source-verified registered expanded product help** across
their delivered surfaces, with the family/path/entry evidence above. Matching,
sanitization, and isolated HTTP behavior are verified; real signed-in presentation
and authorized live help reads remain **unverified**, not missing or passed.
Other audit families and production-local help remain outside this addendum.
