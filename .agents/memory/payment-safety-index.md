---
name: Payment safety decisions index
description: Pointers to durable checkout, payment-editing and financial-correction boundaries.
---

Consult these existing decision notes when changing payment workflows:

- [Online payment foundation](online-payment-foundation-boundary.md) — foundation work does not authorize live charging.
- [Checkout abandonment](checkout-abandonment-boundary.md) — settlement and explicit cancellation must be serialized.
- [Checkout initiation proof](checkout-initiation-proof.md) — current rejection cannot disprove an earlier provider operation.
- [Test-mode provider entry](test-mode-provider-entry-order.md) — reject live credentials before customer creation.
- [Whole-statement checkout](whole-statement-checkout.md) — credits and unknown pending allocations constrain checkout.
- [Payment direction correction](payment-direction-historical-correction.md) — historical cleared payments require reviewed reconciliation.
- [Payment editor lifecycle](payment-editor-lifecycle.md) — hydration is not a deliberate allocation change.
- [Ledger currency discovery](ledger-currency-discovery.md) — discovery and payable monetary validation have different scope.
- [Financial correction boundaries](financial-correction-boundaries.md) — uncertain historical attribution is never auto-repaired.

**Why:** These decisions protect related financial workflows but have distinct approval and historical-evidence boundaries. Keep their original detail accessible without crowding the always-loaded index.

**How to apply:** Read the relevant linked note before proposing a change; verify any named code still exists. This index does not supersede the original decisions.
