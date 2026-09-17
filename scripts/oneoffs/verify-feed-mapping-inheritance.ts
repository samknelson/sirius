import assert from "node:assert/strict";
import { reconcileInheritedColumnMapping } from "../../server/plugins/wizards/plugins/feed-mapping";

const canonical = {
  firstName: "col_0",
  lastName: "col_1",
  ssn: "col_2",
};

assert.deepEqual(
  reconcileInheritedColumnMapping(
    canonical,
    ["First Name", "Last Name", "SSN"],
    [["SSN", "First Name", "Last Name"]],
    true,
  ),
  {
    firstName: "col_1",
    lastName: "col_2",
    ssn: "col_0",
  },
  "header-based mappings should follow reordered columns",
);

assert.deepEqual(
  reconcileInheritedColumnMapping(
    canonical,
    ["First Name", "Last Name", "SSN"],
    [["First Name", "Last Name"]],
    true,
  ),
  {
    firstName: "col_0",
    lastName: "col_1",
  },
  "columns absent from the new file should be removed",
);

assert.deepEqual(
  reconcileInheritedColumnMapping(
    { col_0: "firstName", col_2: "ssn" },
    undefined,
    [["Ada", "Lovelace"]],
    false,
  ),
  { col_0: "firstName" },
  "legacy headerless mappings should retain only valid indexes",
);

assert.deepEqual(
  reconcileInheritedColumnMapping(
    { firstName: "col_0" },
    ["Name"],
    [["Name", "Name"]],
    true,
  ),
  {},
  "ambiguous duplicate headers should not be inherited",
);

assert.deepEqual(
  reconcileInheritedColumnMapping(
    { firstName: "col_0", lastName: "col_1" },
    ["Name", "Name"],
    [["Name"]],
    true,
  ),
  {},
  "canonical mappings from duplicate source headers should be dropped",
);

assert.deepEqual(
  reconcileInheritedColumnMapping(
    { col_0: "firstName", col_1: "lastName" },
    ["Name", "Name"],
    [["Name"]],
    true,
  ),
  {},
  "legacy mappings from duplicate source headers should be dropped",
);

console.log("Feed mapping inheritance checks passed");