---
name: Checkout rejection proof
description: Distinguish a first-call rejection from configuration failure after an uncertain create.
---

Only provider-owned proof of non-creation on the first invocation can release a
checkout reservation locally. Commit evidence of provider entry before making
the external call; on replay, current configuration rejection does not prove
that an earlier invocation failed.

**Why:** A provider payment can exist even when its create response or local
transaction is lost. Configuration may then change, so a later preflight refusal
cannot safely authorize another payment. Missing references are not proof.

**How to apply:** Keep unknown historical attempts reserved. Serialize
create/replay/recovery with webhook progress, preserve the original provider
idempotency identity, and distinguish fixture reproduction from proof about a
reported account in a verified production environment.
