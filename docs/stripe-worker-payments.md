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