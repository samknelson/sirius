---
name: Plugin config validation runs on post-toRows data
description: Why the unified plugin-config routes validate base.data (after toRows) instead of the raw request data, and the RJSF field-stripping gotcha behind it.
---

The unified plugin-config routes (POST/PATCH `/api/plugins/:kind/configs`) must
run the adapter's `toRows()` BEFORE `ensureValidPlugin()`, and validate the
resulting `base.data` — not the raw `parsed.data.data` from the request.

**Why:** some adapters relocate an authoritative field into `data` inside
`toRows`. The canonical case is `trust-eligibility`: `data.appliesTo` (array) is
what the executor and `baseEligibilityConfigSchema` read, but the generic admin
config form renders via RJSF, which **strips any property not present in the
plugin's JSON Schema** — and `appliesTo` is deliberately kept out of that schema.
The generic form instead re-supplies the selection as a top-level comma-joined
envelope string field, and `toRows` parses it back into `data.appliesTo`. If
validation ran on the raw request `data` (pre-toRows), the generic-form save
would be rejected for "appliesTo required" even though the stored row is valid.
The two save paths (policy-benefits rule editor sends the array on `data`; the
generic admin form sends the string on the top-level envelope field) only stay
consistent when validation sees what actually gets stored.

**How to apply:** when touching the unified plugin-config save flow or adding a
new adapter whose `toRows` moves/derives fields into `base.data`, keep the order
`toRows` → validate `base.data` → persist. Do not "optimize" by validating the
raw body first. The RJSF strip-unknown-props behavior is the trap: any field you
want round-tripped through the generic form but kept out of the JSON Schema must
be reconstructed in `toRows` and validated there.
