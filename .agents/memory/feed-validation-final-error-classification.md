---
name: Feed validation final-error classification
description: Why unmapped-only status rows must be counted after all wizard-specific validation
---

Classify whether an unmapped employment status is the only row issue using the final set of blocking errors, after subclass-specific validation has accepted or added errors.

**Why:** The shared numeric validator rejects dollar-formatted withholding, while BAO accepts it. Classifying at the parent stage incorrectly counts an otherwise unmapped-only row as invalid even though the subclass removes the numeric error. The inverse is possible when a subclass adds a blocking error.

**How to apply:** When changing a feed subclass that adjusts parent errors, ensure its final error list updates the unmapped-only row classification before result counts are reconciled.