---
name: Managed workflow secret provisioning
description: Replit Secrets are available to managed workflows but not ordinary shell one-liners.
---

**Rule:** When a one-off operation needs a Replit Secret, do not assume a Shell
command can read it. Use a short-lived managed-workflow hook or the supported
secret-aware execution path, then remove the hook immediately after the
operation. Never print the secret or its derived hash.

**Why:** Replit injects project secrets into the managed application workflow,
while ordinary shell commands may not receive them. A shell command can appear
to run successfully while seeing an unset secret.

**How to apply:** Keep the operation idempotent, log only non-sensitive outcome
flags, verify the database result, and have the operator remove one-time
secrets from the Secrets pane when the agent cannot delete them.