import { readFileSync } from "node:fs";
import { join } from "node:path";

interface VersionedStep {
  id: string;
  script: string;
  logicVersion: number;
}

/** Inspect source without importing executable loaders or running their writes. */
export function assertFleetVersions(
  steps: readonly VersionedStep[],
  base: string,
  readSource: (path: string) => string = (path) => readFileSync(path, "utf8"),
): void {
  const errors: string[] = [];
  for (const step of steps) {
    try {
      const source = readSource(join(base, step.script));
      const declarations = [...source.matchAll(/^\s*const LOGIC_VERSION\s*=\s*(\d+)\s*;/gm)];
      if (declarations.length !== 1) {
        errors.push(`${step.id}: expected one literal const LOGIC_VERSION declaration in ${step.script}`);
      } else if (Number(declarations[0][1]) !== step.logicVersion) {
        errors.push(`${step.id}: loader logicVersion ${declarations[0][1]} != sync-config expectation ${step.logicVersion}`);
      }
    } catch {
      errors.push(`${step.id}: cannot read ${step.script}`);
    }
  }
  if (errors.length) {
    throw new Error(`fleet version preflight failed before staging: ${errors.join("; ")}`);
  }
}