---
name: Whole-job dispatch eligibility without denorm facts
description: How a dispatch-eligibility rule that is the same answer for every worker is expressed inside the fact-based framework, and why a job-type-less config is inert.
---

# A dispatch-eligibility rule with no per-worker facts

Every dispatch-eligibility plugin contributes a condition over the worker
eligibility denorm facts. A rule whose answer is a property of the JOB, not of
the worker, still has to speak that language.

The shape: contribute **no condition at all** while the rule permits, and a
single `exists` condition naming a **category no denorm plugin ever writes**
once it forbids. That clause is false for every worker in both the list query
and the per-worker acceptance check, with no framework change, no new condition
type, and no denorm producer.

**Why:** the framework's two evaluation surfaces (the SQL list query and the
per-worker check) both already handle `exists`; anything else means editing both.
The sentinel must be commented loudly at its definition — otherwise the next
person reads a missing producer as a bug and "fixes" it by writing the facts,
which silently disables the rule.

**How to apply:** pair the sentinel with a `failureMessage` on the condition, or
the refusal shown to the operator is the generic "Missing required <category>
entry (needs: …)" template naming the fake category.

## Job-type-less configs are inert (framework behavior, not a bug)

The eligibility read path loads configs by the job's job type and **returns
nothing at all when the job has no job type**; the subsidiary filter is an
equality match, so a config with a null job type is never applied to a job that
has one. There is no "applies to all job types" config today: a plugin is
enabled per job type by creating one config per job type. Verified by hand, not
inferred.
