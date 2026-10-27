---
name: Notifier hidden template channels
description: Provider-independent template authoring, supported-media filtering, and preservation of hidden overrides
---
Never remove template channel groups from the served JSON Schema just to hide their editors.

**Why:** RJSF strips any stored data whose field isn't declared in the schema — removing the group from the served schema would wipe an existing override for the hidden medium on the next save. Validation still runs against the unmodified registered schema.

**How to apply:** Preserve schema groups and stored overrides, decorating only a clone. Do not mutate the shared registered schema.

Treat template authoring and delivery configuration as separate concerns.

**Why:** The user explicitly wants to write and preview templates before configuring delivery providers or default senders. Authoring is not sending.

**How to apply:** Offer declared supported template media regardless of missing, ambiguous, disabled, or failing provider setup. Authoring metadata must not look up providers just to decide editor visibility. Provider resolution and its explicit failures belong on actual delivery. Keep component/access gates and independently addressable message variants.
