#!/usr/bin/env npx tsx
/**
 * Every directory under `components/` is one removable component, and every
 * component (core-defined or in its own directory) declares what it depends on
 * in ONE place: its definition's `dependsOnComponents`. This check reports
 * undeclared hard dependencies:
 *
 * - imports: a component may import only from itself, from core, or from a
 *   component it declares;
 * - foreign keys into another component's declared tables;
 * - raw SQL naming another component's declared tables.
 *
 * Discovery separately refuses a declared dependency whose source is missing.
 * `--audit` additionally prints every cross-component table link (including
 * Drizzle table imports and core references, which may be runtime-gated soft
 * links) for maintaining docs/component-dependencies.md; it never fails.
 *
 * See docs/optional-components.md and docs/component-dependencies.md.
 */
import { auditComponentTableLinks, checkComponentImports, checkComponentTableReferences } from "../optional-components";

if (process.argv.includes("--audit")) {
  for (const link of auditComponentTableLinks()) {
    console.log(`${link.from ?? "(core)"} -> ${link.owner} [${link.kind}${link.declared ? ", declared" : ""}] ${link.table} at ${link.where}`);
  }
}

const imports = checkComponentImports();
const tables = checkComponentTableReferences();
if (imports.length) {
  console.error("Component import boundary violations:\n");
  for (const violation of imports) console.error(`  ${violation}`);
  console.error("\nMove shared code into the component both depend on (or into core), or declare the dependency.");
}
if (tables.length) {
  console.error(`${imports.length ? "\n" : ""}Undeclared component table dependencies:\n`);
  for (const violation of tables) console.error(`  ${violation}`);
  console.error("\nDeclare the owning component in dependsOnComponents, or remove the reference.");
}
if (imports.length || tables.length) process.exit(1);
console.log("Component imports, foreign keys and raw SQL respect declared dependencies.");
