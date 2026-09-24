# Worker Stripe payments

## Non-production worker sign-in fixture

The dedicated worker fixture is **not** the break-glass admin, an Okta user, or
an impersonation. Provision it only against an isolated development/test
database with `NODE_ENV=development` (or `test`) and the explicit
`ALLOW_WORKER_PAYMENT_FIXTURE=1` opt-in. Never point this command at production,
even from a development shell. Its reserved email is
`worker-payment-fixture@example.invalid`; it creates a contact, worker, active
user, worker-only role assignment, and a local identity explicitly linked to
the worker. Colliding or partially owned records are refused, not adopted.
The worker role must already have `worker`, `worker.ledger`,
`worker.ledger.pay`, and `worker.ledger.methods` (and no elevated permissions).
Ledger must be enabled. The script will not change role permissions, account
balances, payment wording, or gateway configuration.

Save `WORKER_PAYMENT_FIXTURE_PASSWORD` as a **development secret** (8–200
characters; password + optional `AUTH_LOCAL_PEPPER` at most 72 UTF-8 bytes).
Do not supply it on the command line, in a checked-in file, or in shell
history. Use the same `AUTH_LOCAL_PEPPER` as the running local-auth provider.
Enable `local` in `AUTH_PROVIDER`, with `AUTH_LOCAL_ENABLED` not `false`.
Run from the dev/test deployment shell:

```sh
ALLOW_WORKER_PAYMENT_FIXTURE=1 npx tsx scripts/oneoffs/worker-payment-fixture.ts
```

The only output is the fixture's **non-secret** user ID, worker ID, and email.
Keep the worker ID for test runs. Rerunning with the same secret is safe;
changing the secret rotates the local password and ends existing fixture
sessions, without changing the worker association or granting additional roles.
Sign in at `/login` as the fixture
email and that secret. To disable it, run
`ALLOW_WORKER_PAYMENT_FIXTURE=1 npx tsx scripts/oneoffs/worker-payment-fixture.ts deactivate`;
this deactivates the user, removes its password hash, and deletes its persisted
sessions. Re-provision to reactivate with a newly supplied secret.

For a repeatable **real HTTP session** check, set `WORKER_FIXTURE_BASE_URL`
to the running non-production application's HTTPS origin (or local loopback)
and run:

```sh
ALLOW_WORKER_PAYMENT_FIXTURE=1 npx tsx scripts/oneoffs/verify-worker-payment-fixture.ts
```

This checks the actual login page, local login endpoint, session cookie on
subsequent requests, own worker record, denial for another worker's record,
checkout and methods, and denial of admin access. It checks ledger component
and permission prerequisites separately from payment configuration. If an
interactive Chromium is available, also run
`ALLOW_WORKER_PAYMENT_FIXTURE=1 npx tsx scripts/oneoffs/verify-worker-payment-browser.ts`
with the same secret and base URL to check the actual login form and worker
payment pages in a persisted browser session. The account chooser reports a
setup blocker if the worker has no eligible payable account. If an
enabled Stripe gateway has **test** keys, pass its non-secret config ID as the
single argument to check saved-method provider entry:

```sh
ALLOW_WORKER_PAYMENT_FIXTURE=1 npx tsx scripts/oneoffs/verify-worker-payment-fixture.ts <test-gateway-config-id>
```

The verifier refuses non-test publishable keys and the Stripe setup endpoint
refuses non-test secret keys before creating a SetupIntent. It never prints
the session cookie, client secret, password, hash, or Stripe key. If consumer
authorization, enabled gateway, a payable account with positive available
balance, or test credentials are missing, the verifier reports a **setup
blocker**; do not invent debt or legal text to get a green result. The method
setup check can create a test-mode Stripe customer and SetupIntent, but does
not attach a method, charge funds, settle payments, or exercise webhooks.

Worker self-payments use the configured `payment-gateway` row, never a global
Stripe credential. Set its `data.secretName` to the test secret (for example
`STRIPE_DEFAULT`), `data.publishableKey` to the matching `pk_test_` key, and
`data.webhookSecretName` to the signing-secret name. Configure `paymentTypes`
with `card` and/or `us_bank_account`.

The webhook endpoint is:

`POST /api/ledger/payment-gateways/:gatewayConfigId/webhook`

Stripe signing verification uses the raw request bytes. Payment attempts have
an application idempotency key and provider-event uniqueness key. Webhook
states are monotonic (`requires_action` → `processing` → `succeeded`); a
succeeded attempt creates one cleared ledger payment and runs the normal charge
plugin allocation path. Stripe test cards and ACH test accounts can therefore
exercise the same delayed settlement path as production.

## Account-scoped worker checkout

Links from the worker account list and Domestic Partner page lead to
`/pay/:eaId`; the legacy `/workers/:workerId/ledger/pay?eaId=:eaId` bookmark
redirects to the same checkout. Without an account ID, the worker chooses
explicitly from enabled accounts. An account's gateway,
currency, financial payment type, and online-payment readiness determine whether
it can accept payment. Unsupported accounts must show the configuration problem,
not a zero balance.

`GET /api/ledger/checkout/worker/:workerId/:eaId` reads the selected EA's
ledger sum. The response distinguishes the posted `balance` from
`available` (the difference is reserved); pending payments must not make a posted
debt look paid. Payment submission rechecks ownership, gateway compatibility,
and available balance under the existing EA lock. Merely visiting checkout or
setting up a method does not create a ledger payment or credit.

Method setup uses the existing shared SetupIntent flow independently of debt.
Saving during checkout is opt-in and only offered when the entity has methods
authority and the gateway supports reusable methods. The receipt URL
`/pay/receipt/:sessionId` can be bookmarked after a redirect; the server
reconciles the provider state and exposes a ledger link only after posting.
Only the existing confirmed-payment lifecycle posts a credit. The shared
receipt distinguishes provider success awaiting ledger posting from provider
processing, and keeps polling until a ledger payment is linked.

New card and ACH PaymentIntents awaiting details normalize to `created`, not
`processing`. Both `created` and `requires_action` open secure entry when the
client secret and provider component are available. Missing entry prerequisites
show an explicit error, not a processing receipt. Unconfirmed receipts show
awaiting-details/confirmation wording and reservation guidance without ACH
settlement advice.

Preconfirmation regression coverage includes mocked Stripe session creation,
HTTP session/receipt contracts, rendered receipt states and polling, and the
375px browser fixture for both new card and ACH `created` responses. These
checks do not confirm real Stripe payments or replace the separate test-mode
integration rehearsal.

## Regression evidence and verification boundary

### Whole-statement checkout and authorization setup

Shared checkout offers **Pay full balance** or **Pay selected statements**.
Workers never enter totals or per-statement amounts. Full-balance-only account
settings still apply. The shared quote uses integer cents, applies net account
credits oldest-statement-first, and discloses the adjustment before confirmation.
Credits are transferred from their disclosed source statement periods to the
selected periods atomically with settlement, so both cash and credit actually
clear the selected statements. Credits without an attributable statement source
block checkout with administrator guidance rather than inventing a posting.
Full payment includes debt not yet on a statement; selected payment does not.
Statements reserved by an active payment cannot be selected again. A legacy
pending payment without a known allocation blocks another checkout rather than
guessing where its funds will post.

Admins configure approved consumer and business wording and versions at
**Configuration → Ledger → Settings & Payment Authorization**
(`/config/ledger/settings#payment-authorization`). This is shared configuration,
not an account-specific override. Existing values are loaded without replacement;
no legal wording is seeded. Missing approved wording remains an operator setup
requirement and blocks both one-time and saved-method payment. Saving a method is
optional, unchecked, and additionally requires the effective payer's method
authority and provider support. Existing consent snapshots remain unchanged.

Representative fixture coverage includes `2163-COBRA-202609` with $267.35 due;
it does not assert anything about a live worker or account. Stripe test-mode
verification remains separate from these fixture checks and no live charging
is enabled by this change.

Focused statement-checkout validation:

```sh
npx vitest run tests/ledger/checkout-selection.test.ts tests/ledger/online-checkout.test.ts tests/ledger/payment-settlement.test.ts tests/ledger/online-payment-storage.test.ts tests/ledger/online-payment-authority.test.ts tests/ledger/payment-attempts-contract.test.ts tests/ledger/payment-allocation-executor.test.ts tests/ledger/payment-allocation-validation.test.ts tests/ledger/shared-checkout-receipt.test.tsx tests/ledger/payment-authorization-editor.test.tsx
node tests/ledger/checkout-browser.mjs
npx vitest run tests/ledger/checkout-credit-posting.test.ts
```

The credit-posting regression uses production ledger storage with a persisted
SQL fixture to assert post-settlement invoice balances, unrelated statement
preservation, replay, rollback, and delayed-credit-source refusal. It is not a
real PostgreSQL or Stripe integration test.

The browser fixture checks 375px layout, keyboard statement/consent selection,
and single/multiple/full-balance review without a real provider. Broader ledger
tests currently also contain 12 failures in the worker-method-setup-routes and
worker-payable-routes suites; an isolated baseline run reproduced the same
failures before this change. These are not evidence of Stripe verification.

Representative fixtures reproduce ambiguous multi-account checkout navigation
and the client rendering a missing balance as zero. The storage-contract test
compares the account-list, selected-EA, and DP aggregation readers against the
same ledger rows, including an unrelated account that must not offset the debt.
This is evidence for the repaired failure paths, not a diagnosis of a particular
production worker's record.

Run the focused tests with:

```sh
npx vitest run tests/ledger/worker-ledger-payment.test.tsx tests/ledger/shared-checkout-receipt.test.tsx tests/ledger/worker-payable-routes.test.ts tests/ledger/worker-payable-storage-contract.test.ts tests/ledger/payment-attempts-contract.test.ts
```

These tests use representative storage/provider fixtures. They do not issue
live Stripe charges, modify historical balances, or replace the separate
Stripe test-mode card/ACH and webhook verification work.

For test-mode verification, configure a Stripe test gateway with a `pk_test_`
publishable key and matching test secret, then exercise both a Stripe test card
and a test ACH account through the shared checkout. Confirm that a card can
complete the one-time flow, ACH remains processing until its webhook settles,
and the receipt changes to “Payment posted” with a ledger-payment link. Also
send signed test-mode webhook events for duplicate delivery and out-of-order
statuses; the receipt and ledger must remain monotonic and a replay must not
create a second payment. Never use production keys or real bank details for
this verification.

## Preview attempt investigation (read-only, 2026-09-24 14:42 UTC)

For attempt `5c35d928-8ece-4464-aa35-97fb5f931fbd`, a targeted read of
the accessible **development** database found $100.00 USD stored as `created`,
with a provider PaymentIntent reference on a configured, enabled Stripe
test-mode gateway. The attempt was created at 14:29:50 UTC and last updated
at 14:39:14 UTC. Its `ledger_payment_id` and `reservation_expires_at` are
null. There were no inbox events associated with this attempt. The linked
ledger entity account's active-attempt reservation total was $100.00;
the attempt itself contributes $100.00 to that total. The application treats
`created` attempts as reserved even without a reservation expiry timestamp.
There is **no linked ledger payment** and no evidence in this read of a
posted credit.

A direct, read-only Stripe PaymentIntent GET using the gateway's **test**
credential returned `requires_payment_method`, amount 10000 cents USD,
`livemode: false`, created at 14:29:51 UTC. Its metadata attempt ID matched
the database row; it had no attached payment method and no last payment
error. The provider intent is not succeeded or canceled. In the current
gateway normalization, `requires_payment_method` without a last payment
error maps to `created`, consistent with the stored state. No key, client
secret, customer details, raw provider response, or receipt was exposed.

This is a point-in-time observation of the development preview, **not**
production or proof that the intent cannot later be confirmed. The receipt
route performs reconciliation and can write ledger state; it was deliberately
not called. No records or provider objects were changed. Before deciding
whether to proceed or retire the attempt, the payment owner should re-check
the same intent in the matching Stripe test account and re-read the attempt,
reservation, and ledger link. If checkout is to continue, use the existing
intent through the authorized test checkout flow and verify eventual posting
via normal provider/webhook processing. Do not release the reservation or
create a replacement charge based only on the stale `created` row; any
abandonment decision needs provider-confirmed state and an approved
reconciliation plan, **not an ad hoc cancellation**. Note that the current
background recovery code can attempt provider cancellation for
created/requires-action intents older than one day; this investigation did
not run recovery or trigger that path.