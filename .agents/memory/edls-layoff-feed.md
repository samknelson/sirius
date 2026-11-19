---
name: EDLS layoff feed terminology
description: Meaning of layoff when discussing sheet export filters
---
In the EDLS sheet feed, the user's term “layoff” means the `reserved` sheet status, not the dispatch assignment status `layoff`.

**Why:** The user explicitly clarified this distinction when investigating scheduled sheets returned for layoff requests.

**How to apply:** Use `status: "reserved"` for layoff sheet export requests; do not introduce a new sheet status or confuse it with dispatch assignments.
