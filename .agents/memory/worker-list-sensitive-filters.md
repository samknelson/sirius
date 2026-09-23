---
name: Worker list sensitive filters
description: How to keep sensitive worker lookup inputs out of browser and server observability surfaces.
---

**Rule:** A sensitive worker-list filter must travel in a request body only. Never put its raw value, encoded value, or reversible representation in a URL or client query-cache key. Use an opaque per-page generation to invalidate the cache when an applied sensitive value changes; keep ordinary filters shared between the list, all-matching selection, and export.

**Why:** URL-based list filters appear in browser history and access logs; query-cache keys are also inspectable and may persist between page visits. The normal list search intentionally permits partial matches for names and IDs, which is not safe for SSNs.

**How to apply:** When adding another sensitive filter, give all three result paths an authorized body-based form; reject attempts to pass that filter to legacy GET routes. Validate before reading data, and keep response rows and search-specific exports free of the matched secret.