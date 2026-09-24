# Worker Stripe payments

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
Only the existing confirmed-payment lifecycle posts a credit; a successful
provider confirmation still appears as processing until ledger posting is
confirmed.

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