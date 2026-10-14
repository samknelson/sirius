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
