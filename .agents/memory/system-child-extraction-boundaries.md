---
name: System child extraction boundaries
description: Approved limits for later history and file-transfer extraction after relocation.
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
contributions. A later extraction needs separate approval for the typed
history observer/enricher, not a new lifecycle bus or parallel loader.

SFTP removal must coordinate its mandatory Trust Provider EDI dependent, or
remain core-registered. Preserve both FTP and SFTP functionality and the real
FK/dependency; do not invent a transfer capability abstraction to conceal it.

**Why:** The owner explicitly rejected treating a real dependent as a
hook-shaped problem and rejected claiming single-directory deletion works
while mandatory consumers remain core.

**How to apply:** Review dependent ownership separately. For record-go, reuse
an existing entity/access declaration if possible; otherwise only a small
additive typed mapping registration, never an access-granting alter hook.

Owner approved (2026-11-25) extracting SFTP and Trust Provider EDI TOGETHER in
one change (not a relocate-first staging). Scope, inventory and the record-go
`recordGo` requirement on the existing metadata contribution live in
`docs/sftp-edi-ownership-scope.md`. BAO EDI file-type plugins move with EDI.
