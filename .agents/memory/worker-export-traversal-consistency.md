---
name: Worker export traversal consistency
description: Concurrency contract for bounded worker CSV traversal
---

Use keyset pagination with the list's full sort order and a stable unique tie-break, without keeping a database snapshot open across the entire download. Rows whose filter and sort keys remain unchanged are visited once; concurrent changes to those keys can move a row across the cursor and cause an omission or repeat.

**Why:** A repeatable-read snapshot across a long HTTP download pins a pooled connection and old row versions for the entire network transfer. The export is an operational list, not an immutable accounting snapshot.

**How to apply:** Keep each read bounded and release its connection before writing to the client. If a future export requires an exact point-in-time membership guarantee, explicitly design a bounded snapshot/materialized ID set rather than assuming keyset reads provide one.