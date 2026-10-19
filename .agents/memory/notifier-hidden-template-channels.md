---
name: Notifier hidden template channels
description: How undeliverable notifier template medium cards are hidden without wiping stored overrides
---
Never remove template channel groups from the served JSON Schema just to hide their editors. Unsupported channels should be invisible; supported but unavailable channels need a setup explanation instead of an editor.

**Why:** RJSF strips any stored data whose field isn't declared in the schema — removing the group from the served schema would wipe an existing override for the hidden medium on the next save. Validation still runs against the unmodified registered schema.

**How to apply:** Preserve schema groups and stored overrides, decorating only a clone. Follow the same operation-assignment resolver as delivery. An enabled provider alone is insufficient: its send operation must be assigned, uniquely resolvable, and component-available. Do not change providers or inspect credentials to expose an editor.

Keep delivery gating when diagnosing missing template controls.

**Why:** The user chose to retain the policy that undeliverable channels are not editable. The missing-controls complaint called for an honest explanation, not bypassing that policy.

**How to apply:** Distinguish unsupported media from temporary site setup problems, and keep assignment/removal variants independently addressable.
