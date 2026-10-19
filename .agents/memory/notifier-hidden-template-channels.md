---
name: Notifier hidden template channels
description: How undeliverable notifier template medium cards are hidden without wiping stored overrides
---
Never remove template channel groups from the served JSON Schema just to hide their editors.

**Why:** RJSF strips any stored data whose field isn't declared in the schema — removing the group from the served schema would wipe an existing override for the hidden medium on the next save. Validation still runs against the unmodified registered schema.

**How to apply:** Preserve schema groups and stored overrides, decorating only a clone. Do not mutate the shared registered schema.

Treat template authoring and delivery configuration as separate concerns.

**Why:** The user clarified that writing a template is not sending a message and questioned requiring configured delivery providers merely to edit text. Existing provider-gated editing must not be represented as an explicit user requirement.

**How to apply:** Distinguish a notifier's supported media from the site's ability to send them. Provider resolution belongs on actual delivery; do not infer authoring prerequisites from it. Keep component/access gates and independently addressable message variants.
