#!/usr/bin/env npx tsx
/**
 * Every directory under `components/` is one removable component. Deleting a
 * leaf component's directory must leave the build intact, so a component may
 * import only from itself, from core, or from a component it declares in
 * `dependsOnComponents` (discovery separately refuses a declared dependency
 * whose directory is missing).
 *
 * See docs/optional-components.md.
 */
import { checkComponentImports } from "../optional-components";

const violations = checkComponentImports();
if (violations.length) {
  console.error("Component import boundary violations:\n");
  for (const violation of violations) console.error(`  ${violation}`);
  console.error("\nMove shared code into the component both depend on (or into core), or declare the dependency.");
  process.exit(1);
}
console.log("Component imports respect declared dependencies.");
