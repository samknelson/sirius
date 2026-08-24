/**
 * What is specific to the Kaiser eligibility file, on top of the generic
 * conformance contract in `provider-edi-conformance.test.ts`:
 *
 *  - `kaiserEncodeNumber`, the legacy signed-overpunch amount encoding, where
 *    the last digit of a cents amount carries the sign
 *  - the golden records the format check has guarded since the plugin was
 *    written: a subscriber ("A"), a QMSCO dependent ("D") on the COBRA
 *    enrollment unit, and an empty row
 *
 * Field positions are read through the expected layout fixture, never through
 * the plugin's own field table.
 */
import { describe, expect, it } from "vitest";
import { kaiserEncodeNumber } from "../../server/plugins/trust/provider-edi/plugins/sitespecific-bao-kaiser";
import { LEGACY_LAYOUTS } from "./fixtures/legacy-layouts";
import { encoderFor, requireEdiPlugin, sliceField } from "./fixtures/harness";

const layout = LEGACY_LAYOUTS["sitespecific-bao-kaiser"];
const encode = encoderFor(requireEdiPlugin("sitespecific-bao-kaiser"));
const field = (record: string, name: string) => sliceField(record, layout, name);

describe("kaiserEncodeNumber (legacy signed overpunch)", () => {
  const cases: Array<[number, string]> = [
    [0, "000000{"],
    // 123.45 → 12345 cents → "0012345" → last digit 5 → 'E' positive, 'N' negative
    [123.45, "001234E"],
    [-123.45, "001234N"],
    [0.1, "000001{"],
    [99999.99, "999999I"],
  ];
  for (const [amount, expected] of cases) {
    it(`${amount} → ${expected}`, () => {
      expect(kaiserEncodeNumber(amount)).toBe(expected);
    });
  }
});

/** Golden subscriber ("A") record. */
const subscriberRow = {
  regionCode: "SCR",
  customerId: "000226111",
  enrollmentUnit: "0000",
  activityDate: "20260801",
  recordCode: "A",
  subscriberSsn: "001234567",
  memberSsn: "001234567",
  accountRole: "01",
  lastName: "DOE",
  firstName: "JANE",
  middleName: "Q",
  gender: "02",
  birthDate: "19800115",
  street: "123 MAIN ST",
  city: "OAKLAND",
  state: "CA",
  zip: "94612",
  phone: "5105551234",
  coverageStart: "20250801",
  coverageEnd: "",
  supplementalId: "",
  duesAmount: kaiserEncodeNumber(0),
};

describe("golden subscriber record", () => {
  const record = encode(subscriberRow);
  const expected: Array<[string, string]> = [
    ["Region Code", "SCR"],
    ["Record Type", "1"],
    ["Customer ID", "000226111"],
    ["Enrollment Unit", "0000"],
    ["FILLER1", " ".repeat(36)],
    ["Activity Date", "20260801"],
    ["Transaction Type", " "],
    ["Record Code", "A"],
    ["Last Name", "DOE".padEnd(25)],
    ["First Name", "JANE".padEnd(25)],
    ["Middle Name", "Q".padEnd(25)],
    ["Account Role", "01"],
    ["Birth Date", "19800115"],
    ["Gender", "02"],
    ["Subscriber SSN", "001234567"],
    ["Member SSN", "001234567"],
    ["Supplemental ID", " ".repeat(16)],
    ["Home Phone", "5105551234"],
    ["Address Line 1", "123 MAIN ST".padEnd(40)],
    ["Address Line 2", " ".repeat(40)],
    ["City", "OAKLAND".padEnd(45)],
    ["State", "CA"],
    ["ZIP Code", "94612"],
    ["ZIP Plus 4", "    "],
    ["Effective Date", "20250801"],
    ["Termination Date", " ".repeat(8)],
    ["Current Dues Amount", "000000{"],
    ["FILLER22", " ".repeat(36)],
  ];
  for (const [name, value] of expected) {
    it(`${name} = ${JSON.stringify(value)}`, () => {
      expect(field(record, name)).toBe(value);
    });
  }
});

describe("golden QMSCO dependent record (COBRA enrollment unit)", () => {
  const record = encode({
    ...subscriberRow,
    enrollmentUnit: "7000",
    recordCode: "D",
    memberSsn: "009876543",
    accountRole: "06",
    lastName: "DOE",
    firstName: "JIMMY",
    middleName: "",
    gender: "01",
    birthDate: "20150310",
    supplementalId: "08",
    coverageEnd: "20261231",
  });
  const expected: Array<[string, string]> = [
    ["Enrollment Unit", "7000"],
    ["Record Code", "D"],
    ["Subscriber SSN", "001234567"],
    ["Member SSN", "009876543"],
    ["Account Role", "06"],
    ["Supplemental ID", "08".padEnd(16)],
    ["Termination Date", "20261231"],
  ];
  for (const [name, value] of expected) {
    it(`${name} = ${JSON.stringify(value)}`, () => {
      expect(field(record, name)).toBe(value);
    });
  }
});

describe("empty row", () => {
  const record = encode({});

  it("still carries the Record Type constant", () => {
    expect(field(record, "Record Type")).toBe("1");
  });

  it("is otherwise blank", () => {
    expect(record.slice(0, 3).trim() + record.slice(4).trim()).toBe("");
  });
});
