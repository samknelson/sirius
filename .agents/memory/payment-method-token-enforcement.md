---
name: Payment-method token enforcement point
description: Where to validate/sanitize a gateway methodToken so sensitive data can't be stored
---

The generic payment-methods create route persists the client-supplied
`methodToken` **verbatim** as `paymentMethods.paymentMethod` — it is NOT
re-derived from the provider after attach. The only plugin hook that runs
BEFORE persistence is `attachMethod(ctx, {customerRef, methodToken})`.

**Rule:** any gateway plugin that must guarantee something about what gets
stored (e.g. "never store the full PAN or CVC") has to enforce it inside
`attachMethod` by validating the token and throwing — a throw there aborts the
request before `storage.ledger.paymentMethods.create`. `getMethodSummary` /
`getMethodDetails` run only on reads and are too late to protect storage.

**Why:** the Dummy gateway is stateless (no remote provider to canonicalize
against), so a no-op attach would let a crafted client POST a token containing
a real card number and have it stored. Strict validation in attach is the
guard: exact key set, brand allowlist, 4-digit last4, calendar-range expiry.
Critically, the token has **no free-form field** — an early version kept a
`nonce`, but `^[a-z0-9]{8,32}$` still matches a 16-digit PAN, so any
unbounded string is a smuggling channel. Only keep strictly-bounded fields.

**Also:** `PaymentGatewayPlugin.requiresSecret` defaults to true; set it false
for credential-less gateways. `resolveGateway` then skips the missing-secret
503 and passes `apiKey: ""`. The config can still name a secret harmlessly.
