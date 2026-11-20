---
name: Scheduled sync failure policy
description: Daily continuation is not permission to accept failed source records.
---

Scheduled daily S1 sync should attempt the remaining loaders after a loader fails, retaining overall FAIL and the original reasons. Manual and final-freeze defaults remain unchanged.

**Why:** The user explicitly chose continuation with failure reporting, not relaxed reject rules or success-with-warnings.

**How to apply:** Do not add reject allowances to make scheduled runs green. Startup, lock, write-fence, and staging failures still stop execution; downstream prerequisites remain required. Production behavior changes only after a separately authorized immutable migration-image and scheduler task-definition rollout.

Treat verification assertions, rejected payments, and balance drift as separate
triage inventories; equal failure totals across runs do not establish the same
assertion or record, and payment rejects alone do not prove the cause of drift.

**Why:** The supplied daily evidence did not persist the failed assertion or
the balance detail; inferring a repair from those counts would exceed the
operator's authorization.

For scheduled-fleet readiness, verify the actual `run-scheduled-daily.ts`
launcher and its fixed production profile, not merely a manually supplied
`sync.ts` command.

**Why:** The operator launches the scheduler entry point without forwarding
arguments; required wet execution and approved allowances must be configured
in code, not left as manual command-line instructions.

**How to apply:** Trace the launcher's fixed arguments through fleet selection
and per-step policy before confirming that a loader will run.

Treat migration execution-role ownership separately from application stack
ownership. A previously usable migration task definition can reference a role
that a later Flightcontrol/CloudFormation infrastructure deployment removes.

**Why:** CloudTrail confirmed a successful role deletion by CloudFormation
under Flightcontrol's infrastructure deployment session, preventing ECS from
starting the migration container at all.

**How to apply:** For ECS role-assumption launch failures, verify role existence
and CloudTrail before changing the image or loader. Prefer a deliberately owned,
stable execution-role dependency; do not infer the initiating human from an
automation role, or manually recreate a generated stack resource without
understanding its owner.

For AWS CloudShell guidance, provide directly pasteable commands rather than
requiring the operator to upload a helper script.

**Why:** The operator explicitly prefers to run infrastructure commands in
CloudShell without transferring scripts.

**How to apply:** Keep future one-off AWS instructions inline in the response;
do not make a workspace script the required step.
