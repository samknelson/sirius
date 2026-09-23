---
name: Mockup artifact installation timing
description: Newly created mockup artifacts can have a workflow before their dependencies are ready
---

Creating a mockup sandbox registers its workflow before its dependency installation necessarily finishes. An immediate workflow restart can report `vite: not found` even though the artifact was created successfully. Wait for the install to finish or install the sandbox's declared dependencies before diagnosing the workflow as a configuration failure.

**Why:** the artifact scaffolder reported success while its dependency install was still in progress; the first restart raced it.

**How to apply:** after creating a new mockup artifact, check that its local dependencies exist before restarting the managed preview workflow. Keep using the generated workflow instead of starting a replacement.