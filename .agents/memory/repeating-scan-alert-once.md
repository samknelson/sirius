---
name: Alerting once from a repeating scan
description: How a scan that re-raises the same crossing every run still notifies exactly once, and what the key must contain
---

A threshold scan is deliberately allowed to run several times a day and to
re-raise the same crossing on every pass. Nothing about the *event* is
deduplicated; the exactly-once guarantee is the composed message's send-once
key, and the key's ingredients are the behavior spec:

- the **configuration id** — two configurations watching the same number each
  get their own message;
- the **day** — still-heavy traffic alerts again tomorrow;
- **what was counted**, built from the dimensions themselves and never from a
  rule's position — reordering or re-saving must not resurrect a spent alert;
- the **threshold** — raising or lowering a rule's number re-arms it for today,
  which is what an admin lowering a limit expects.

Recipient and channel stay OUT of the key: comm uniqueness is per (medium,
contact, key), so one crossing still reaches every recipient on every channel.

**Why:** without the threshold in the key an admin who lowers a limit hears
nothing until midnight; with the rule's index in the key a re-save sends a
duplicate.

**How to apply:** the already-sent check must run BEFORE the recipient's
anti-flood budget is consumed, or a repeating scan burns that budget on
messages it never sends and throttles real ones. A notifier that can be
triggered by a manually-run cron also needs self-notification opt-out, or the
operator is dropped from their own alert.
