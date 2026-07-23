---
name: Wizard create preset vs run steps
description: Why POST /api/wizards must not preset progress "in_progress" for run-kind starting steps
---
The framework wizard create route preseeds `data.progress[currentStep].status = "in_progress"` to mark the active step. For a no-form report wizard whose FIRST step is `kind: "run"`, that preset makes a brand-new wizard look like a run is already executing (RunProgressView shows spinner + disabled Run button) even though the dispatcher never started anything.

**Why:** run-step progress is owned exclusively by the run dispatcher (`/dispatch/:stepId/run` sets in_progress/completed/failed). "in_progress" in the progress map means *work executing*, not *step active*; step-activeness is already derivable from `wizard.currentStep` in `stepState()`.

**How to apply:** when adding wizard plugins with a run step first (no launch form), rely on the create route's kind check that skips the preset for `kind === "run"`. If a wizard instance is ever stuck "running" with no run dispatched, its `data.progress.<step>` was set outside the dispatcher.
