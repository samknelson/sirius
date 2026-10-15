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
Remote checkpoint equality and repair execution require operator proof inside
the HIPAA boundary; a changing live count is not an extraction-defect finding.
