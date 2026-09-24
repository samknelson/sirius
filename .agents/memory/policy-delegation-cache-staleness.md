---
name: Policy delegation defeats skipCache
description: ctx.checkPolicy sub-policy results come from the evaluator cache even when the outer policy sets skipCache.
---

# Policy delegation defeats skipCache

`skipCache: true` on an access policy only skips caching of THAT policy's
result. If its `evaluate()` delegates via `ctx.checkPolicy('employer.mine', ...)`
(or any sub-policy), the delegated result is still served from the evaluator's
~5-minute cache — so revoking the underlying relationship (e.g. unlinking a
contact from an employer) keeps granting until the sub-policy's cache expires.

**Why:** proven by a route-harness revocation test — an unlinked employer user
kept 200s despite skipCache on the outer policy; inlining the check fixed it.

**How to apply:** for relationship-sensitive, revocation-critical policies,
inline the sub-policy's logic (hasPermission + getUserContact +
listByEmployer, etc.) instead of delegating, AND set skipCache. Note the t631
job-interviews policy delegates to employer.mine and has this residual
staleness. Always add a revocation case to route-harness verifiers.
