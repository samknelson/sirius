---
name: Notifier postal template channel
description: Rules for token-templated notifiers that mail letters — one letter page, where at-most-once lives, and why a sender refusal before the claim must be reported as not sent.
---

**One letter page.** A rendered postal template becomes `{ file, description }` through the
single shared letter-page wrapper in the shared HTML utils; manual compose uses the same wrapper.
**Why:** the studio preview, a hand-composed letter and a notifier letter must be the same page,
or a template that previews fine is delivered differently.

**At-most-once is the comm insert.** A templated notifier declares a send key; the sender's comm
insert is the claim. A key is spent only when a comm row exists, so a refusal BEFORE the claim
leaves the key unspent and a later status re-entry may retry — the wanted behaviour.

**Pre-claim refusals must be reported as not sent.** The postal sender answers "failed, no comm"
when the site cannot mail at all (a postal provider without letter support, no return address,
an address the provider rejects). Nothing downstream — comm-created hooks, the case letter list,
the flash tally — can see a letter that never became a row, so the dispatcher must log and count
it as NOT_SENT. **Why:** during verification an emit looked healthy while no letter and no error
was recorded anywhere; the tally said "sent".

**Gating parity.** The postal template card hides whenever the default postal provider cannot
mail letters; the Media checkbox is per-plugin only (same as email/SMS). Don't "fix" one surface
to match the other per plugin. To exercise the chain without a vendor call, drive the real sender
in its offline-record mode; never mail through the live provider from dev.
