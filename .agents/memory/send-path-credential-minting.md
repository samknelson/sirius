---
name: Minting a credential on a send path
description: Why a notifier that texts a per-entity access credential needs get-or-create (never set), and how it refuses when the credential's component is off.
---

# Minting a credential on a send path

A notifier that sends a link keyed by a per-entity credential (a worker access
token, a magic id, anything bearer-like) must acquire it with a **get-or-create
that can never replace an existing value**, distinct from the admin
set/regenerate path.

**Why:** the existing write path on such a row is a create-or-update — right for
an admin pressing "regenerate", catastrophic on a send path. Two concurrent
sends, or a second event a minute later, would each replace the value and
silently kill every link already delivered. The recipient's link must keep
working for as long as the admin has not deliberately revoked it.

**How to apply:**

- One statement: `INSERT ... ON CONFLICT (owner) DO UPDATE SET
  value = COALESCE(NULLIF(<existing column>, ''), EXCLUDED.value)`. The loser of
  a race lands in DO UPDATE and keeps the winner's value. A pre-read is an
  optimization (it avoids a dead row version per send), never the decision.
- Return `{ record, issued }`. The storage logging middleware's `shouldLog` only
  sees `(args, result)` — never the before-state — so "did this call actually
  mint?" has to be *in the result* or the audit line lies ("Issued …") on every
  reuse, one row per notified recipient.
- Resolve the credential while resolving RECIPIENTS, before any message is
  composed: a recipient whose credential cannot be issued is dropped, rather
  than texted a link that will not resolve.
- The reverse read (credential → owner) must refuse blank/whitespace before
  querying. A nullable column plus a blank-to-null insert transform is a write
  invariant, not something a read may assume.

## Second component, one registry slot

The notifier registry gates a plugin on exactly ONE `requiredComponent`. When a
notifier needs a second component (the one owning the credential), the *plugin*
enforces it — do not widen the registry for one plugin.

Put the check at the END of `shouldDispatch`, after the cheap gates, and
**throw** rather than return false:

- `dispatchForConfig` calls `shouldDispatch` before recipients, delivery and
  receipts, so a throw makes the whole send one visible failure instead of a
  partial one, and nothing is marked as notified.
- Returning false would be indistinguishable from "this event legitimately
  notifies nobody", and the first anyone hears of it is workers not getting
  texts.
- Say the requirement in the plugin's admin-facing `description` too, so an
  admin configuring it sees it without reading a log.
