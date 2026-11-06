---
name: Admin-assisted payment authority
description: Administrators need real worker payments, not a test-only workflow tied to system mode.
---

Administrators must be able to make real payments on a worker's behalf. Do not substitute an admin-only test payment or tie that authority to system mode.

**Why:** The user explicitly rejected the test-payment approach and requested actual payments on behalf of workers.

**How to apply:** Keep the worker as the ledger owner and record the administrator separately. Gateway configuration still determines whether a provider operation is live or test; administrator authority does not itself prove payer consent.

Keep this authority separate from ordinary payer checkout and from historical test attempts. Initially restrict the on-behalf flow to worker accounts and newly entered details, without using or saving payer methods.

**Why:** The requested authority is for workers; it does not imply permission to charge stored methods, change employer-payment policy, or reinterpret historical tests as real funds.

**How to apply:** Use a separate versioned administrator attestation and preserve its meaning through retry, recovery, settlement and receipts. Do not broaden the ordinary payer flow's live-provider guard as a side effect.

Unfinished administrator payments must not be recreated under changed gateway credentials, even when both sets of credentials are otherwise valid.

**Why:** Provider idempotency belongs to a provider account and environment. Switching test/live credentials or accounts can turn recovery of an existing attempt into a second provider operation.

**How to apply:** Bind creation/replay/recovery to the original gateway identity. A credential change requires reconciliation rather than silently retrying against the new account.

Live administrator authority must cover the whole payment lifecycle, including cancellation and automatic expiry, with the same narrow provenance boundary.

**Why:** Allowing creation while a separate provider mutation remains test-only strands live payments and their reservations. A mocked generic gateway does not prove the real adapter can cancel.

**How to apply:** Exercise provider-adapter cancellation with live-credential fixtures, verified attempt identity and confirmed provider cancellation, without making real provider calls. Keep ordinary and historical-test cancellation restrictions intact.
