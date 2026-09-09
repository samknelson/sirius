---
name: Studio template library route
description: Defines how Template Studio discovers saved letter templates and handles access.
---

Template Studio must load letter templates through the standard staff letter-template list route, using its medium and token context as filters. Do not create a separate Template Studio endpoint or duplicate access logic. When the standard list refuses access, omit the Templates panel.

**Why:** The management list is the authority for who may see letter templates. A parallel route can drift from that policy and let someone browse templates in Studio that they cannot see in the main management UI.

**How to apply:** Extend the standard list's query filters when Studio needs another narrowing dimension. Treat authorization refusal as feature absence; show ordinary loading, empty, and retryable error states only when the caller is allowed to use the list.