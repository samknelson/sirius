---
name: Permanent test cost
description: Project rule for deciding when automated tests and test follow-up tasks are justified.
---

Do not add or propose tests by default for small, low-risk client-only behavior or copy/presentation changes. Propose a test only when its regression protection clearly justifies keeping the code and running it on every build indefinitely.

**Why:** A dedicated rendered-component suite for a simple configuration-page text filter added substantial permanent code and build cost without enough risk reduction, and the owner explicitly rejected that tradeoff.

**How to apply:** Before adding or proposing a test, identify the meaningful failure risk, why cheaper existing checks are insufficient, and why the test will remain valuable long-term. If that case is weak, use existing type, lint, and build checks instead.