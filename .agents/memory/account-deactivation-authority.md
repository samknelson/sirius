---
name: Account deactivation authority
description: Why deactivation needs a durable generation in addition to fresh account checks and session deletion.
---

Reactivation must not revive previously revoked sessions. Keep the generation captured by a sign-in separate from the current account's authority, and compare them before refreshing a serialized user snapshot.

**Why:** Renewal and late saves can upsert deleted session rows, including from another server process. An active-account check alone stops access only while the account is inactive; after reactivation, a restored old session would otherwise pass. Database account generations make those stale writes fail even after reactivation.

**How to apply:** Advance account authority and revoke affected sessions atomically. Authenticated saves must serialize against account changes before writing sessions. Capture a masqueraded target's authority when entering masquerade, and validate both owner and target. Reuse fresh reads within one HTTP request, never across requests or private socket deliveries. Do not treat this account-level mechanism as a complete solution to isolated per-session deletion races.
