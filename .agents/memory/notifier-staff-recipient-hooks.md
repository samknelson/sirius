---
name: Notifier staff-recipient & actor-suppression hooks
description: How a staff-mode notifier merges event-derived recipients and controls per-config self-suppression
---

The event-notifier framework has two optional plugin hooks (types.ts, wired in dispatcher.ts):

- `resolveStaffRecipientUserIds(ctx, configData, configuredIds)` — staff-mode only; returns the FINAL user-id list for one dispatch (merge event-derived users like a committed current assignee, or drop the explicit list for assignment-only triggers). Dispatcher dedupes and still enforces staff/admin eligibility in resolveStaffRecipients.
- `actorSuppression(ctx, configData)` → `{ suppress, actorUserId }` — replaces the plugin-level `notifySelf` default per config; a payload-carried actor overrides the ambient request-context user for the suppression match (deferred deliveries have no ambient request).
- `validateConfigData(configData)` — plugin cross-field rules run after configSchema in the kind's validateConfig. Use this instead of a root-level JSON-Schema `anyOf` (RJSF renders root anyOf as a selector UI and breaks the form).

**Why:** BAO case notifier needed dynamic Current Assignee recipients + per-config suppress-self without changing other notifiers.

**How to apply:** any notifier needing event-derived staff recipients or a per-config self-suppression toggle should use these hooks, not bespoke dispatcher changes. Absent hooks = exact legacy behavior. Recipient decisions must read only the committed event payload (rollback safety, no re-reads). New merged token fields must be added to the token kind's `entityFields` AND every builder (notifier build + previewEntity.load + sample sets).
