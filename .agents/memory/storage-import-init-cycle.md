---
name: Storage import init cycle in standalone scripts
description: tsx scripts importing anything that loads the storage layer crash on module init order
---
Standalone tsx scripts must not import files that transitively load the storage layer — it instantiates at import time with ordering-sensitive cross-imports, so entering the graph from a different root throws "Cannot access X before initialization".

**Why:** hit when adding a search regression guard script.

**How to apply:** keep pure/testable logic (SQL builders, formatters) in storage-free modules and have scripts import those.
