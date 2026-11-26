---
name: Successful-login extraction boundary
description: Shared authentication stays independent of optional sign-in history.
---

Keep generic successful-login event delivery in core when history is eventually
extracted. History enrichment is the narrow invocation boundary; disabled or
absent history means null history decisions, never failed login. Preserve
history-before-alert classification, restoration suppression, session-save
duplicate suppression, independent transactions and failure isolation. Do not
publish session IDs, authentication correlation references or browser-profile
UUIDs on the general event bus.

**Why:** The owner explicitly reviewed this separation while approving
relocation only; the history service also orchestrates generic sign-in delivery.
Moving that service is not permission to extract shared authentication.

**How to apply:** Reuse existing session save/touch events and normal manifest
contributions. The approved history extraction uses a typed private-context
decision alter, not an observer registry or a new lifecycle bus. Its core
consumer deliberately catches failures, discards intermediate decisions and
delivers null decisions; an unavailable/failed enrichment is not restoration.
Keep this fail-open policy local to optional enrichment, never authentication
authority or global alter execution.
