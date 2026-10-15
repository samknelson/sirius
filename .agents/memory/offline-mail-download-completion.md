---
name: Offline mailing download completion
description: A mailing CSV download completes the offline bulk-message workflow and marks the message sent.
---

For offline postal bulk messages, downloading the mailing CSV must mark the
bulk message as sent. Do not require a separate manual Mark Sent action.

**Why:** The owner explicitly corrected a read-only export proposal: marking
the message sent is part of the point of downloading the offline mailing file.

**How to apply:** Treat the download as an authorized completion action, explain
the effect in the UI, and make repeat downloads idempotent. Failure to prepare
the file must not complete the workflow. “Sent” represents offline workflow
completion, not confirmation of physical delivery.

Completion must also create an offline postal communication in each recipient's
history and link it to the bulk participant. Re-downloading must fill missing
history even for an already-sent message, without duplicating existing records.

**Why:** The owner found that a mailing marked sent with no recipient comms left
workers' communication histories empty; a CSV export alone is not completion.

**How to apply:** Preserve the offline postal sender's recording semantics (never a provider call),
commit comm records, participant links and message status together, and key the
record by message + recipient so repeated exports or recipient re-enqueueing
cannot create duplicate history.

## Batch completion rather than single-recipient delivery

A mailing CSV is an address-list export, not a vendor-rendered letter. It needs
personalized history descriptions and authored postal settings, but not an
expansion of every available vendor merge token. Batched persistence is allowed;
do not require every recipient to pass through the single-recipient sender.

**Why:** Large offline exports spent minutes repeating shared lookups and
single-record completion writes. Vendor-only token evaluation adds unrelated
work and can load sensitive fields the address list never uses.

**How to apply:** Keep comm history, tag links, recipient links, effective-user
audit attribution and parent provenance intact when batching. Emit recipient
audit entries only after commit; a completion failure must roll back everything.
Evaluate any personalized description with a separate recipient context.
