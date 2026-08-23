---
name: In-app restart depends on an unknowable supervisor
description: Why the restart button exits non-zero, and why the UI must treat supervision as possibly-unknown.
---

A process can only ever end itself. An in-app "Restart" is a graceful shutdown
plus `process.exit`; whether the app comes back is entirely up to something
outside the container, and **a container's restart policy cannot be read from
inside the container**.

**Why the exit code is non-zero (75):** Docker `--restart on-failure` and
Kubernetes `restartPolicy: OnFailure` restart only on a non-zero exit, while
`always`/`unless-stopped`/ECS services restart either way. Non-zero therefore
restarts under a strict superset of policies. 75 (EX_TEMPFAIL) rather than 1
keeps a deliberate restart distinguishable from a crash in container logs.

**How to apply:**
- Supervision is a three-state answer — yes / no / cannot tell — never a
  boolean with a confident default. Report the evidence and the reason, and
  demand a typed confirmation whenever it is not a definite yes.
- Not being PID 1 matters independently: ending a non-entry process may not end
  the container, so no supervisor notices.
- Confirming a restart succeeded requires a boot identity (random id + start
  time) on the health endpoint. Polling for "the endpoint answers" proves
  nothing — the OLD process answering looks identical.
- Any restart-policy prose (Dockerfile header, docs) and the page's prediction
  text are written against the chosen exit code; change them together.
