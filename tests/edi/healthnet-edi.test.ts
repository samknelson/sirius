/**
 * What is specific to the HealthNet eligibility file, on top of the generic
 * conformance contract in `provider-edi-conformance.test.ts`:
 *
 *  - `memberType`, the relation-type → member-code mapping, including the
 *    legacy fallback to "M" for an unknown relation type
 *  - the golden records the format check has guarded since the plugin was
 *    written: a subscriber ("M"), a QMSCO dependent ("Q") with the
 *    subscriber-only fields blanked, COBRA pay status, and an empty row
 *
 * Field positions are read through the expected layout fixture, never through
 * the plugin's own field table.
 */
import { describe, expect, it } from "vitest";
import { memberType } from "../../server/plugins/trust/provider-edi/plugins/sitespecific-bao-healthnet";
import { LEGACY_LAYOUTS } from "./fixtures/legacy-layouts";
import { encoderFor, requireEdiPlugin, sliceField } from "./fixtures/harness";

const layout = LEGACY_LAYOUTS["sitespecific-bao-healthnet"];
const encode = encoderFor(requireEdiPlugin("sitespecific-bao-healthnet"));
const field = (record: string, name: string) => sliceField(record, layout, name);

describe("memberType (legacy member_type())", () => {
  const cases: Array<[string | null, string]> = [
    [null, "M"], // self / subscriber
    ["DP", "P"],
    ["C", "D"],
    ["AC", "D"],
    ["H", "D"],
    ["SC", "D"],
    ["G", "D"],
    ["SP", "S"],
    ["QMSCO", "Q"],
    ["XX", "M"], // unknown relation type falls back to M, like legacy
  ];
  for (const [relation, expected] of cases) {
    it(`${relation ?? "(none)"} → ${expected}`, () => {
      expect(memberType(relation)).toBe(expected);
    });
  }
});

/** Golden subscriber ("M") record. */
const subscriberRow = {
  groupNumber: "LB391A",
  fileDate: "20260801",
  coverageStart: "20250801",
  coverageEnd: "",
  subscriberSsn: "001234567",
  memberSsn: "001234567",
  memberType: "M",
  lastName: "DOE",
  firstName: "JANE",
  middleInitial: "Q",
  gender: "F",
  birthDate: "19800115",
  street: "123 MAIN ST",
  city: "OAKLAND",
  state: "CA",
  zip: "94612",
  phone: "5105551234",
  hireDate: "20240301",
  payStatusCode: "AC",
  contractType: "2",
  numberCovered: "2",
};

describe("golden subscriber record", () => {
  const record = encode(subscriberRow);
  const expected: Array<[string, string]> = [
    ["Health Net Group Number", "LB391A"],
    ["Reserved 1", "  "],
    ["File Date", "20260801"],
    ["Transaction Type (Activity Flag)", " "],
    ["Coverage Begin Date", "20250801"],
    ["Subscriber SSN", "001234567"],
    ["Dependent SSN", "001234567"],
    ["Member Type", "M"],
    ["Reserved 2", "   "],
    ["Last Name & Suffix", "DOE".padEnd(17)],
    ["First Name", "JANE".padEnd(10)],
    ["Middle Initial", "Q"],
    ["Gender", "F"],
    ["Date of Birth", "19800115"],
    ["Address Line 1", "123 MAIN ST".padEnd(25)],
    ["Address Line 2", " ".repeat(25)],
    ["City", "OAKLAND".padEnd(17)],
    ["State", "CA"],
    ["Zip Code", "94612"],
    ["Zip Code +4 Extension", "    "],
    ["Work Telephone", "5105551234"],
    ["Residence Telephone", " ".repeat(10)],
    ["Physician Last Name", " ".repeat(20)],
    ["Hire Date", "20240301"],
    ["Pay Status Code", "AC"],
    ["Contract Type", "2"],
    ["Number Covered", "2 "],
    ["Coverage End Date", " ".repeat(8)],
    ["Medicare Part A Indicator", " "],
    ["Filler 1", " ".repeat(13)],
    ["Insurance Line Code", "HMO"],
    ["Current Premium Amount", " ".repeat(8)],
    ["Record End Designator", "HNPES"],
  ];
  for (const [name, value] of expected) {
    it(`${name} = ${JSON.stringify(value)}`, () => {
      expect(field(record, name)).toBe(value);
    });
  }
});

describe("golden QMSCO dependent record", () => {
  // Dependent rows blank out phone, hire date, pay status, contract type and
  // the covered count — those are subscriber-only.
  const record = encode({
    ...subscriberRow,
    memberSsn: "009876543",
    memberType: "Q",
    lastName: "DOE",
    firstName: "JIMMY",
    middleInitial: "",
    gender: "M",
    birthDate: "20150310",
    phone: "",
    hireDate: "",
    payStatusCode: "",
    contractType: "",
    numberCovered: "",
  });
  const expected: Array<[string, string]> = [
    ["Subscriber SSN", "001234567"],
    ["Dependent SSN", "009876543"],
    ["Member Type", "Q"],
    ["Work Telephone", " ".repeat(10)],
    ["Hire Date", " ".repeat(8)],
    ["Pay Status Code", "  "],
    ["Contract Type", " "],
    ["Number Covered", "  "],
    ["Record End Designator", "HNPES"],
  ];
  for (const [name, value] of expected) {
    it(`${name} = ${JSON.stringify(value)}`, () => {
      expect(field(record, name)).toBe(value);
    });
  }
});

describe("COBRA subscriber", () => {
  it("carries pay status CO", () => {
    const record = encode({ ...subscriberRow, payStatusCode: "CO" });
    expect(field(record, "Pay Status Code")).toBe("CO");
  });
});

describe("empty row", () => {
  const record = encode({});

  it("still carries the Insurance Line Code constant", () => {
    expect(field(record, "Insurance Line Code")).toBe("HMO");
  });

  it("still carries the Record End Designator constant", () => {
    expect(field(record, "Record End Designator")).toBe("HNPES");
  });

  it("is otherwise blank", () => {
    // Blank out the two constants by their fixture offsets — not by searching
    // the record for their text, which would also match a data field.
    const constants = ["Insurance Line Code", "Record End Designator"];
    const blanked = layout.fields.reduce(
      (acc, [name]) => (constants.includes(name) ? acc : acc + field(record, name)),
      "",
    );
    expect(blanked.trim()).toBe("");
  });
});
