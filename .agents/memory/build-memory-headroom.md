---
name: Production build memory headroom
description: Diagnose abruptly terminated Vite builds by measuring process-tree RSS, and distinguish Node heap limits from machine RAM.
---

The production frontend build needs deliberate memory headroom on a small
publishing machine. Measure the entire build process tree, not only the Vite
process, before choosing a heap ceiling.

**Why:** a locally successful build approached 2 GiB combined RSS while the
publishing machine reported 2 GB RAM. An explicit smaller heap reduced the
successful build's combined RSS to roughly 1.7 GiB. A 1 GiB heap was too small
and produced a genuine JavaScript heap OOM. Heap size and total resident memory
are different budgets.

**How to apply:** retain an explicit build-only heap ceiling, verify the full
frontend/backend build, and sample child-process RSS when recalibrating it.
Do not assume a larger Node heap fixes a machine-memory limit. An abrupt end
during transformation without a logged error makes memory pressure a suspect,
not a confirmed cause; keep that uncertainty explicit unless logs confirm it.

When the logged heap OOM occurs specifically at **computing gzip size**, remove
optional compressed-size reporting before increasing the heap. That reporting
step can exhaust the constrained builder even after transformation and chunk
rendering succeed. A full build with reporting disabled succeeded under the
same heap ceiling with process-tree RSS below the publishing machine's RAM.
This is only a build-reporting cost; it does not control HTTP compression.
