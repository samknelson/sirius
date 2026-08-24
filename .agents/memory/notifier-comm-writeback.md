---
name: Notifier comm writeback
description: How a notifier plugin learns the id of the message it caused, and how to record it without lying about ordering or delivery.
---

# Recording the message a notifier caused

Notifier plugins never create comm records — the **senders** do
(`server/services/comm/senders/*.ts`), inside their own transaction. A plugin
only composes. So a plugin cannot learn "which message did I just cause?" by
sending one itself; the framework has to hand it back.

The framework's `onCommCreated(medium, recipient, comm, ctx, configData?)`
optional plugin hook is that handoff, fired per (recipient, medium) after
delivery.

**Why:** the senders already returned the created comm and the dispatcher was
discarding it, collapsing to a boolean for the flash-summary tally. Bulk
messaging had already solved the same problem its own way. An optional hook
matches how every other notifier extension point works, so this did not
require a new mechanism.

**How to apply:** when a notifier needs the message linked to whatever it was
about, implement the hook and reuse the SAME per-event map `getMessage` built
the message from — that is what makes the recorded row and the row referenced
inside the message necessarily the same one. Do not reach for a per-dispatch
callback threaded through the send.

## Three things that are easy to get wrong

1. **The hook is not delivery proof.** It fires whenever the send layer hands
   back a record, including a recorded FAILURE, and including sends where no
   provider was ever contacted (unreachable/not-opted-in recipients get a
   failed comm without a provider call). Name and document it accordingly, or
   a future reader will treat a call as "it arrived".
2. **It is strictly after the fact.** The sender's transaction has committed
   and the message is gone; the hook cannot roll back or retry, and the
   framework only catches and logs what it throws.
3. **"Most recent message" must mean most recently SENT, not most recently
   written.** A single-value link column updated unconditionally is
   last-*hook-completion* wins: two racing sends finish their bookkeeping in
   provider-latency order, so a slower older message can overwrite a newer
   one. Guard the update by comparing the incoming comm's `sent` against the
   currently-linked one's.
