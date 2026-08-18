---
name: S1 shared-email ownership signal
description: How shared email addresses are owned across the contacts and users loaders, and what remains deferred.
---

# S1 shared-email ownership

**Rule:** When staged S1 contacts share an email address (case-insensitive, trimmed, after placeholder suppression), ownership is decided by S1's user↔contact association (`field_data_field_sirius_contact` rows with `entity_type='user'`, staged as `raw_user_contact`). The contact referenced by the S1 user account whose mail matches the address keeps the email; every other contact on that address loads with `email = null`. The users loader uses the SAME signal to disambiguate multi-candidate worker links.

**Why:** First-wins-by-nid assignment put a child's email on the parent's contact (PHI exposure). No email is associated with more than one S1 user account, so the association is unambiguous wherever it exists. Both loaders must share the signal or the contact carrying an email and the worker a login resolves to diverge.

**How to apply:**
- Shared address with NO owning account → ALL contacts load email=null (fund ruling pending — ~737 addresses; the contacts-loader report's `sharedEmails.entries` with rule `deferredNoOwner` is the worklist for the follow-up owner-assignment task).
- Shared address with >1 owning account → fatal reject `shared_email_multiple_owners` (guard only; doesn't occur in prod data); `--allow-rejects` defers it (all null).
- `contacts.email` is case-insensitively unique in the DB (`contacts_email_lower_unique` on `lower(email)`); any future email writer must respect it.
- Reruns repair old first-wins assignments: the loader clears a shared address from mapped non-owner holders before reassigning, and never touches rows outside the sharing group.
- Dev staging has zero shared emails and zero association rows (synthetic gap) — coverage lives in the seeded smokes (`s1-t3-shared-email-smoke.ts`, `s1-t27-users-smoke.ts`); reports print nids/uids only, never addresses.
