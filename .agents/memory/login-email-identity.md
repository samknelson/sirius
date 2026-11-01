---
name: Login email identity
description: Operator-only resolution of ambiguous login accounts and provider subject authority.
---

Do not resolve duplicate trimmed/case-insensitive login emails by choosing an
account, merging accounts, or transferring provider identities or roles.
Stop the upgrade and name the affected account IDs for operator resolution.

**Why:** The owner explicitly required that eliminating ambiguous login accounts
preserve provider IDs, verified-email rules, and existing role assignments.
Matching email alone is not evidence that two existing identities may be merged.

**How to apply:** Keep legacy account cleanup explicit. During concurrent
trusted signup, only the exact verified provider subject may authorize recovery
to an account created by the winning transaction; do not adopt an email winner.
