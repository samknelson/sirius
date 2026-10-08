---
name: Compliance letter parity
description: Owner-confirmed source of truth for employer compliance letter token values.
---

Compliance letters and their tokens must match the Employer Compliance report's
current missing-period and delinquent-balance rules. Do not introduce separate
due-date or aging rules as part of the letter feature.

**Why:** the owner explicitly chose “Match the report’s current rules” when
asked whether letters should mirror the report or change compliance rules first.

**How to apply:** use the report's selected upload type, period window, and
ledger accounts for letter values. If financial or reporting definitions need
to change later, treat that as a separate product decision rather than quietly
changing the meaning only in the letter.
