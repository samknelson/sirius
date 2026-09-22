---
name: Legacy month reconciliation proof
description: Safety rule for deleting historical month rows created by a retired span-expansion convention.
---

Historical repair may cross the normal open-span reconciliation horizon only for the exact month produced by the retired rule. Require both a non-stub anchor owned by the original loader and a live non-stub worker or relation mapping. If any current source span desires that month, preserve it.

**Why:** The horizon protects future S2-owned coverage, while broad worker ownership cannot prove which process created an individual month row. The old rule's exact termination month plus loader provenance is narrow enough to repair without treating all future rows as stale.

**How to apply:** Keep legacy repair candidates separate from the ordinary stale set. Report missing/stub mapping, ownership, and overlap protections as aggregate counters so an incomplete repair cannot look like a clean no-op.