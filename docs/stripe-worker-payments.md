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

Links from the worker account list and Domestic Partner page carry
`/workers/:workerId/ledger/pay?eaId=:eaId`. Checkout lists the worker's accounts
and requires an explicit choice when more than one exists. An account's gateway,
currency, financial payment type, and online-payment readiness determine whether
it can accept payment. Unsupported accounts must show the configuration problem,
not a zero balance.

`GET /api/workers/:workerId/ledger/payable?eaId=:eaId` reads the selected EA's
ledger sum. The response distinguishes the posted `balance` from
`reservedAmount` and `availableBalance`; pending payments must not make a posted
debt look paid. Payment submission rechecks ownership, gateway compatibility,
and available balance under the existing EA lock. Merely visiting checkout or
setting up a method does not create a ledger payment or credit.

Method setup uses the existing shared SetupIntent flow independently of debt.
Only the existing confirmed-payment lifecycle posts a credit; a successful
provider confirmation still appears as processing until ledger posting is
confirmed.

## Regression evidence and verification boundary

Representative fixtures reproduce ambiguous multi-account checkout navigation
and the client rendering a missing balance as zero. The storage-contract test
compares the account-list, selected-EA, and DP aggregation readers against the
same ledger rows, including an unrelated account that must not offset the debt.
This is evidence for the repaired failure paths, not a diagnosis of a particular
production worker's record.

Run the focused tests with:

```sh
npx vitest run tests/ledger/worker-ledger-payment.test.tsx tests/ledger/worker-payable-routes.test.ts tests/ledger/worker-payable-storage-contract.test.ts tests/ledger/payment-attempts-contract.test.ts
```

These tests use representative storage/provider fixtures. They do not issue
live Stripe charges, modify historical balances, or replace the separate
Stripe test-mode card/ACH and webhook verification work.