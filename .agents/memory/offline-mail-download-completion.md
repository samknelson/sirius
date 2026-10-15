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

**How to apply:** Use the existing offline postal sender (never a provider call),
commit comm records, participant links and message status together, and key the
record by message + recipient so repeated exports or recipient re-enqueueing
cannot create duplicate history.
