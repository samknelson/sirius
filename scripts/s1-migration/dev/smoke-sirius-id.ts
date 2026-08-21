import assert from "node:assert/strict";
import { nextSiriusId } from "../lib/sirius-id";

assert.equal(nextSiriusId([], []), 1);
assert.equal(nextSiriusId([2, 7, 4], [3, 10]), 11);
assert.equal(nextSiriusId([-2, 0], [-1]), 1);

// The real contacts-workers run has hundreds of thousands of staged workers.
// This must be an iteration, never Math.max(...ids), which exceeds V8's
// function-argument limit at production scale.
const stagedIds = new Map<number, number>();
for (let id = 1; id <= 300_000; id += 1) stagedIds.set(id, id);
const existingIds = new Map<number, true>([[450_000, true]]);
assert.equal(nextSiriusId(stagedIds.keys(), existingIds.keys()), 450_001);

console.log("PASS smoke-sirius-id");