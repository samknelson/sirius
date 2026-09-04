---
name: Minting a credential on a send path
description: Why a notifier that texts a per-entity access credential needs get-or-create (never set), and how it refuses when the credential's component is off.
---

# Minting a credential on a send path

A notifier that sends a bearer-link credential must use a stable get-or-create
operation, never the admin replacement path.

**Why:** automatically replacing a credential on a later or concurrent send
silently invalidates links already delivered to recipients.

**How to apply:** mint at most once for a recipient, resolve the credential
before composing the message, and fail the notification visibly when its
credential-owning component is unavailable rather than sending an unusable
link or marking it delivered.
