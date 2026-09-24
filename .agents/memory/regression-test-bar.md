---
name: Regression-test bar
description: This project forbids follow-up test tasks, which contradicts the generic follow-up-task title templates; the full bar lives in replit.md.
---

# Regression tests are earned, and never a follow-up

The full, checkable bar is the non-negotiable rule "A regression test must
earn its place" in `replit.md`. Read it there; it is authoritative.

**Why this note exists:** the generic follow-up-task guidance suggests title
templates like "Catch X before it ships" and "Confirm X still works after Y".
Following it here produces exactly the backlog this project decided to stop
generating — dozens of proposed test tasks guarding changes nobody has
planned, each costing the owner a per-task judgment call. The project rule
wins over the generic template.

**How to apply:**

- Never propose a follow-up task whose deliverable is a test or a check. If
  the protection is warranted, it ships inside the task that changes the
  behavior.
- The strongest disqualifiers in practice: the subsystem is still being built
  out (a test pins decisions not yet made), and the breakage would be loud
  (a crash or a type error is already its own test).
- Structural risk → a rule in the `RULES` table of `scripts/dev/lint.ts`.
  Behavioral invariant → a Vitest case in `tests/<subject>/`. Never a new
  script with its own workflow.
- The automated gate list is fixed at `lint` / `typecheck` / `migrations`.
  If the registered validations ever drift back to one-workflow-per-check,
  that is debris to clear, not a pattern to extend.
