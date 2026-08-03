---
name: BAO upload-source payment allocation
description: Two-phase money recognition for upload-driven withholding; durable invariants for marker-driven charge plugins.
---
Rule: never recognize ledger money at data-upload time — uploads store allocations, and a payment detail marker routes the cleared payment to a dedicated charge plugin that expands them into worker credits (exact-total match enforced at payment validation).

**Why:** the old flow booked worker payments before funds were received; and any marker consumed by one plugin must also suppress the generic allocation plugin or the amount is credited twice.

**How to apply:**
- A plugin creating entries keyed to a payment must reconcile on EVERY lifecycle verb, including hard DELETE (which bypasses the saved-trigger); an FK SET NULL only clears the consumption link, never the entries.
- Payment detail markers must ride the event-bus payload too — the async listener re-runs the executor from the emitted payload, and a payload without the marker reads as "reverse everything".
- "Consumed by at most one payment" + "credited set immutable" = per-source advisory lock (sorted acquisition) inside one tx; consume returns the locked row set and the plugin credits exactly that set.
