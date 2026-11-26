---
name: Component-owned guidance
description: Where feature-specific decisions live after a removable component is extracted
---
Keep feature-specific product decisions with their removable source in
`components/<component-id>/.agents/memory/`, with a local `MEMORY.md` index.
Read that local index before changing an independently registered component.
Keep only cross-cutting lessons in the root memory directory.

**Why:** Feature extraction includes documentation and operator knowledge.
Keeping feature-specific instructions in core leaves an ownership dependency
after the feature source has been removed.

**How to apply:** Move existing domain notes, rather than duplicating or deleting
their decisions. Keep neutral examples in cross-cutting lessons.
