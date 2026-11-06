---
name: Enrollment self-service authority
description: Worker-scoped enrollment is an ownership boundary for worker accounts, not a restriction on staff acting for workers.
---

Guided enrollment belongs to the selected worker. Worker-type accounts may act only for their own linked worker; staff must still be able to complete the same enrollment on behalf of any worker, without needing a worker link themselves. Manual New Election and election management stay staff-only.

**Why:** The user explicitly clarified that worker scoping must not block staff from submitting enrollments for workers.

**How to apply:** Treat the saved worker scope as the resource identity, not as a requirement that every operator own that worker. Keep staff-on-behalf-of-worker coverage alongside own-worker and other-worker permission tests.

Existing-person matches require separate authority: an SSN/date-of-birth match and an owned upload are not proof of a dependent relationship. Worker self-service may reuse an established active relationship, not establish a link to an unrelated existing person or mutate their contact; staff can review and establish the relationship on behalf of the worker.

**Why:** Exposing a formerly staff-only add step otherwise turns identity matching into cross-worker disclosure and contact modification.

**How to apply:** Check relationship authority before returning matched personal details or making mutations, and test direct add requests as well as the lookup response.
