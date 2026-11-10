---
name: S1 financial contact identity authority
description: Why financial contact NIDs must resolve through exact source worker mappings rather than destination cardinality.
---

S1 intentionally uses a worker's CONTACT NID for financial participants and
payers. This is a general source contract, not a named-fund exception.

**Why:** Operator SQL and a read-only S1 code review confirmed the worker
ledger, AR joins, worker payment search and allocation behavior. A uniquely
linked destination worker alone cannot prove that it is the source worker.
Payer, participant and transaction reference are independent relationships.

**How to apply:** Require the explicit staged worker/contact relationship and
that exact source worker's mapping, cross-checked against destination contact
identity. Never infer identity from a balance or destination cardinality.

Checkpoint proof compares source and staging at the same extraction boundary;
it must not be replaced with a demand that historical staging match today's
live source. Missing extraction evidence remains explicit.

**Why:** A link-only repair consumes existing staging. New live-source activity
is a separate observation, not proof of a loader rejection or extraction defect,
and is not by itself a reason to restage or expand into a full sync.

**How to apply:** Keep extraction proof, staged-target identity verification,
and live-source differences separate. Any change from common-checkpoint proof
to staged-only acceptance needs explicit operator scope approval; remote reads
and writes still need their respective approvals inside the HIPAA boundary.
