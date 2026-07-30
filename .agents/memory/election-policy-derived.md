---
name: Election policy is derived, not stored
description: worker_trust_elections.policy_id is legacy/audit only; effective policy comes from employer policy history via the shared resolver.
---

Rule: never read `worker_trust_elections.policy_id` to decide behavior. The
effective policy for an election is derived from the election's EMPLOYER as of
the relevant date via `resolveEmployerPolicyAsOf` (server/services/policy-resolution.ts):
employer_policy_history as-of → employer denorm_policy_id → `policy_default` variable.

**Why:** plan-rule changes must take effect without touching existing
elections; the stored column is nullable legacy/audit only (new elections and
all wizards no longer write it).

**How to apply:** any new charge/eligibility/scan/UI code that needs an
election's policy resolves via employer + date, passing a
`createPolicyResolutionCache()` when looping over workers (batch scans share
one cache per run). COBRA elections use the dedicated "COBRA" employer whose
denorm_policy_id points at the COBRA policy — the denorm fallback is what
makes that work; don't remove it.
