---
name: Anonymous session history
description: Anonymous capture scope, no-logging/no-metadata storage, and explicit opt-in for destructive retention.
---

Session history is intended to support anonymous sessions, not only successful user logins.

**Why:** The owner explicitly chose support for anonymous sessions when deciding the history record's user association.

**How to apply:** When designing capture, distinguish a session existing from a user signing in. Do not assume every historical event has an authenticated user or silently discard anonymous events.

All runtime history-table access must use its dedicated storage layer, with neither storage logging nor entity metadata.

**Why:** The owner explicitly required this separation; history observations must not produce another audit/history record or touch the associated user's provenance.

**How to apply:** Preserve this rule when adding future history reads, writes, or maintenance. Existing live-session logging is a different concern and is not subject to this exclusion.

Introducing session-history retention must require explicit operator opt-in, even when the history component is already enabled. Preserve existing policies' enablement rather than changing the shared defaults for all retention plugins.

**Why:** A software update must not silently delete previously accumulated observations. The shared retention framework originally seeds policies enabled, so component gating alone does not protect against surprise deletion.

**How to apply:** Give new destructive observation-cleanup policies their own disabled initial configuration; honor saved operator choices on later boots. Keep schema bring-up and verification separate from enabling cleanup.

New-IP sign-in notifications must silently establish a baseline when the account has no prior valid IP observations in retained history.

**Why:** The owner explicitly chose not to alert on the first observed IP, including when retention leaves no previous IP history.

**How to apply:** Distinguish no known IPs from an unseen IP relative to an existing baseline. Scope knowledge to the actual signing-in account; do not use anonymous or other accounts' observations as its baseline.

For sign-in alerts, do not introduce a separate persistent baseline/known-IP store or undertake a broad authentication refactor.

**Why:** The owner explicitly expects session_history alone to supply the comparison and declined an explicit authentication refactor for this feature.

**How to apply:** Add observation around existing authentication paths without moving their credential verification or login logic. Keep the prior-IP decision consistent with the history observation, so inserting the current login first cannot erase its novelty.

An application session opening is not necessarily a new upstream authentication.

**Why:** Clerk authentication can survive replacement of the application's session; treating that replacement as a fresh sign-in produces security alerts for ordinary restoration.

**How to apply:** Distinguish genuine new authentication from restoration of the same upstream authentication. Any retained correlation belongs to existing history, must not contain bearer credentials, and must not reach notification tokens or event payloads.
