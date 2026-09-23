# Online payment provider contract

Ledger checkout owns authorization, amounts, customer mappings, idempotency
records, payment posting, and all database writes. Payment-gateway plugins only
make provider API calls and normalize provider responses.

## One-time payment API

Providers implementing online checkout expose:

- `createPaymentSession(context, input)` for either a new method or a saved
  `savedMethodRef`. `sessionId` is both provider metadata and the idempotency
  key. `saveMethod` requests provider-side future use and therefore requires a
  customer.
- `retrievePayment(context, providerRef)` for webhook reconciliation.
- `verifyWebhook(context, rawBody, headers)` for signature verification and
  normalization.
- `cancelPayment(context, providerRef)` when the provider payment is still
  cancelable.
- `payComponentId` naming the client component that confirms a new method.

Provider creation is a final defensive boundary: amounts must be integer minor
units and at least 100 (one dollar for USD), and every requested method type
must be enabled on that exact gateway configuration. Ledger-level balance and
account minimum rules remain the generic checkout service's responsibility.

Statuses are `created`, `requires_action`, `processing`, `succeeded`, `failed`,
or `canceled`. Unknown provider statuses must never normalize to `succeeded`.
Unsupported signed webhook events normalize to `unsupported` while retaining
their provider event type and a bounded, non-sensitive descriptor so the
webhook inbox does not lose them. Raw provider objects are never exposed as
normalized payloads because they may include client secrets or billing details.

The older payment-intent methods remain available for the existing worker
payment route during migration to shared checkout.

## Stripe

Stripe checkout accepts test-mode keys only. Both the secret key and configured
publishable key must have test prefixes; this guard intentionally prevents this
application path from creating live charges.

New methods are created as unconfirmed PaymentIntents for Stripe Elements.
Saved methods are supplied on the PaymentIntent and confirmed server-side.
Saving sets `setup_future_usage=off_session`. The Stripe webhook signing secret
is resolved from the configured `webhookSecretName`; webhook bodies must be
passed as their exact raw bytes with the `stripe-signature` header.

## Dummy testing provider

The dummy provider is non-production and stateless. Its provider reference
contains only non-sensitive normalized payment facts, allowing retrieval after
a process restart. Set metadata `dummyOutcome` to `succeeded`, `failed`, or
`processing`; the default is `succeeded`.

Cancellation is explicitly refused by the stateless dummy provider with a
typed `PaymentCancellationError`. Terminal payments use
`payment_not_cancelable`; nonterminal payments use
`cancellation_not_supported`. The original provider reference remains
unchanged, so subsequent retrieval honestly returns the same durable state.

Dummy webhook bodies use JSON with `eventId`, `type`, and optional
`providerRef`. Sign the exact bytes using HMAC-SHA256 in
`x-dummy-signature`. The key is the resolved webhook secret, then the API key,
or the built-in testing-only key when neither exists. No PAN, CVC, bank account
number, or other sensitive payment credential may appear in dummy references,
metadata, or logs.