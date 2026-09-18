---
name: Ledger currency discovery
description: Account discovery must retain nonfinancial ledger units, even on monetary checkout surfaces
---

Treat ledger currency identifiers and payment currencies as different domains. An account-discovery response can legitimately contain nonfinancial units alongside money.

**Why:** Applying monetary formatter validation to every discovery row makes one unsupported account invalidate the whole list, blocking payment of an unrelated eligible account. A refusal belongs to that account, not to discovery as a whole.

**How to apply:** Preserve unsupported accounts with their eligibility reason; validate monetary formatting and provider precision only for a payable monetary response. Include mixed financial/nonfinancial accounts in picker regressions.