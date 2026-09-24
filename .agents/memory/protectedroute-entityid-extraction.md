---
name: ProtectedRoute entityId extraction gaps
description: URL patterns the client ProtectedRoute cannot auto-extract an entity id from; pass entityId explicitly.
---

ProtectedRoute derives the policy-check entity id from the URL via a prefix map
(`/workers/:id/...`, `/employers/:id/...`, etc.). Two-segment prefixes like
`/dispatch/job/:id/...` break it: the extractor sees `dispatch` → next segment
`job` and treats "job" as the id.

**Why:** existing dispatch-job tabs were all `permission: 'staff'` (no policy
query), so the bad id never mattered — until a job tab got a `policyId`.

**How to apply:** any tab under `/dispatch/job/:id/...` (or other nested
prefixes) that uses `policyId` must register its route with wouter function
children and pass `entityId={params.id}` to ProtectedRoute explicitly.
See the T631 job interviews route in client/src/App.tsx for the pattern.
