/**
 * SMF Delta Dental eligibility file — specification-driven golden suite.
 *
 * The layout of every record is defined by the Delta Dental "Enterprise
 * Standard File Layout (SFL) Traders Handbook" ver 1.1: 2,000-byte
 * fixed-width records — "10" file header, "30" Individual Eligibility
 * detail, "90" trailer whose count includes header and trailer.
 *
 * Structural conformance of the detail record (field order, widths,
 * offsets, padding, truncation, constants) is asserted by the shared
 * conformance suite against the handbook layout pinned in
 * `fixtures/legacy-layouts.ts`. This suite asserts what is genuinely
 * Delta's own: handbook byte positions, the header/trailer records,
 * classification/division mapping, and golden subscriber/dependent rows.
 *
 * Field-by-field mapping rationale: docs/edi/smf-delta-dental.md.
 */
import { describe, expect, it } from "vitest";
import {
  DELTA_HEADER_WIDTH,
  DELTA_RECORD_WIDTH,
  DELTA_TRAILER_WIDTH,
  deltaDivisionId,
  deltaMemberClassification,
  encodeDeltaHeader,
  encodeDeltaRow,
  encodeDeltaTrailer,
  effectiveGroupId,
} from "../../server/plugins/trust/provider-edi/plugins/sitespecific-smf-delta";
import type { TrustProviderEdiContext } from "../../server/plugins/trust/provider-edi";
import { LEGACY_LAYOUTS } from "./fixtures/legacy-layouts";
import { fieldSpans, sliceField } from "./fixtures/harness";

const layout = LEGACY_LAYOUTS["sitespecific-smf-delta"];
const field = (record: string, name: string) => sliceField(record, layout, name);

function ctx(
  configData: Record<string, unknown> = {},
  input: Record<string, unknown> = {},
): TrustProviderEdiContext {
  return { configId: "t", configData, providerId: null, sftpClientId: null, input, storage: null as never };
}

describe("handbook record geometry", () => {
  it("every record type is exactly 2,000 bytes", () => {
    expect(DELTA_RECORD_WIDTH).toBe(2000);
    expect(DELTA_HEADER_WIDTH).toBe(2000);
    expect(DELTA_TRAILER_WIDTH).toBe(2000);
  });

  // One-based start positions straight from the handbook tables. A shifted
  // width anywhere upstream moves one of these and fails here by name.
  const HANDBOOK_POSITIONS: Array<[string, number]> = [
    ["Record Type", 1],
    ["Group ID", 3],
    ["Division ID", 8],
    ["Employer Reference ID", 13],
    ["Employment Class", 25],
    ["Incentive Start Date", 29],
    ["Waiting Period Start Date", 37],
    ["Primary Subscriber ID", 45],
    ["Subscriber Alternate ID", 61],
    ["Case ID", 77],
    ["Member SSN", 93],
    ["Member Last Name", 102],
    ["Member First Name", 137],
    ["Member Middle Name", 162],
    ["Member Name Suffix", 187],
    ["Gender", 197],
    ["Date of Birth", 198],
    ["Ethnicity Code", 206],
    ["Language Code", 210],
    ["Medicare Indicator", 212],
    ["Member Classification", 213],
    ["Business Level 4", 217],
    ["Benefit Package ID", 265],
    ["Eligibility Effective Date", 289],
    ["Eligibility Termination Date", 297],
    ["Mailing Address 1", 305],
    ["Mailing Address City", 470],
    ["Mailing Address State", 500],
    ["Mailing Address Zip Code", 502],
    ["Mailing Address Country", 517],
    ["Service Area", 520],
    ["Residence Address 1", 522],
    ["Member Home Phone", 737],
    ["Member Work Phone", 751],
    ["Member Cell Phone", 770],
    ["Member Email Address", 784],
    ["Contact Last Name", 848],
    ["Contact Email Address", 1177],
    ["Provider Practice Location ID", 1241],
    ["MPNA Effective Date", 1253],
    ["Network ID", 1273],
    ["NPI", 1285],
    ["COB Other Carrier Name", 1295],
    ["834 Action Codes", 1610],
    ["Group Reporting Data 1", 1613],
    ["Group Reporting Data 2", 1663],
    ["Reserved", 1809],
  ];
  const spans = fieldSpans(layout);
  for (const [name, oneBased] of HANDBOOK_POSITIONS) {
    it(`${name} starts at handbook position ${oneBased}`, () => {
      const span = spans.find((s) => s.name === name);
      expect(span, `layout has no field '${name}'`).toBeDefined();
      expect(span!.start + 1).toBe(oneBased);
    });
  }

  it("the Reserved field closes the record at byte 2,000", () => {
    const last = spans[spans.length - 1];
    expect(last.name).toBe("Reserved");
    expect(last.start + last.width).toBe(2000);
  });
});

describe("header record", () => {
  const header = encodeDeltaHeader(
    ctx({}, { asOfDate: "2026-07-15", mode: "T" }),
    new Date("2026-07-20T13:04:05Z"),
  );

  it("is exactly 2,000 bytes", () => expect(header.length).toBe(2000));
  it("record type 10", () => expect(header.slice(0, 2)).toBe("10"));
  it("group ID at 3–7", () => expect(header.slice(2, 7)).toBe("17975"));
  it("division blank at 8–12 (file-level header)", () =>
    expect(header.slice(7, 12)).toBe("     "));
  it("reporting date YYYYMMDD at 13–20", () =>
    expect(header.slice(12, 20)).toBe("20260715"));
  it("file type at 21 (T = test)", () => expect(header[20]).toBe("T"));
  it("report set ID blank at 22–33 (reserved)", () =>
    expect(header.slice(21, 33)).toBe(" ".repeat(12)));
  it("file create date YYYYMMDD at 34–41", () =>
    expect(header.slice(33, 41)).toBe("20260720"));
  it("file create time HHMMSS at 42–47", () =>
    expect(header.slice(41, 47)).toBe("130405"));
  it("filler spaces through byte 2,000", () =>
    expect(header.slice(47)).toBe(" ".repeat(1953)));

  it("defaults to production mode", () => {
    expect(encodeDeltaHeader(ctx({}, { asOfDate: "2026-07-15" }))[20]).toBe("P");
  });

  it("honours a configured group ID", () => {
    const custom = encodeDeltaHeader(ctx({ groupId: "01234" }, { asOfDate: "2026-07-15" }));
    expect(custom.slice(2, 7)).toBe("01234");
    expect(effectiveGroupId(ctx({ groupId: " 01234 " }))).toBe("01234");
    expect(effectiveGroupId(ctx({ groupId: "" }))).toBe("17975");
  });
});

describe("trailer record", () => {
  const trailer = encodeDeltaTrailer({ detailRecordCount: 3, detailRows: [] });

  it("is exactly 2,000 bytes", () => expect(trailer.length).toBe(2000));
  it("record type 90", () => expect(trailer.slice(0, 2)).toBe("90"));
  it("count at 3–9 includes header and trailer (details + 2)", () =>
    expect(trailer.slice(2, 9)).toBe("5".padEnd(7)));
  it("filler spaces through byte 2,000", () =>
    expect(trailer.slice(9)).toBe(" ".repeat(1991)));
});

describe("member classification (handbook 213–216)", () => {
  const cases: Array<[string | null, string]> = [
    [null, "10"], // subscriber
    ["SP", "20"], // spouse
    ["DP", "21"], // domestic partner
    ["C", "30"], // child
    ["AC", "30"], // adopted child
    ["SC", "30"], // step child
    ["H", "32"], // disabled child
    ["G", "40"], // other adult (LDA)
    ["QMSCO", "13"], // established SMF arrangement (see docs open questions)
    ["RP", "13"], // QMSCO (RP variant) follows every QMSCO rule
    ["EX", ""], // ex-spouse: never a covered classification
    ["UNKNOWN", ""],
  ];
  for (const [rel, code] of cases) {
    it(`${rel ?? "subscriber"} → ${JSON.stringify(code)}`, () =>
      expect(deltaMemberClassification(rel)).toBe(code));
  }
});

describe("division", () => {
  it("COBRA → 09002, everyone else → 00002", () => {
    expect(deltaDivisionId(true)).toBe("09002");
    expect(deltaDivisionId(false)).toBe("00002");
  });
});

/** Golden subscriber detail record — synthetic data only. */
const subscriberRow = {
  groupId: "17975",
  divisionId: "00002",
  subscriberSsn: "001234567",
  memberSsn: "001234567",
  lastName: "DOE",
  firstName: "JANE",
  middleName: "Q",
  gender: "F",
  birthDate: "19800115",
  memberClassification: "10",
  coverageStart: "20250801",
  coverageEnd: "",
  street: "123 MAIN ST",
  city: "SACRAMENTO",
  state: "CA",
  zip: "958140000",
  phone: "9165551234",
  email: "jane.doe@example.com",
};

describe("golden subscriber record", () => {
  const record = encodeDeltaRow(subscriberRow);

  it("is exactly 2,000 bytes", () => expect(record.length).toBe(2000));

  const expected: Array<[string, string]> = [
    ["Record Type", "30"],
    ["Group ID", "17975"],
    ["Division ID", "00002"],
    ["Employer Reference ID", " ".repeat(12)],
    ["Primary Subscriber ID", "001234567".padEnd(16)], // left justified, space filled
    ["Subscriber Alternate ID", " ".repeat(16)],
    ["Member SSN", "001234567"],
    ["Member Last Name", "DOE".padEnd(35)],
    ["Member First Name", "JANE".padEnd(25)],
    ["Member Middle Name", "Q".padEnd(25)],
    ["Member Name Suffix", " ".repeat(10)],
    ["Gender", "F"],
    ["Date of Birth", "19800115"],
    ["Ethnicity Code", "    "],
    ["Language Code", "  "],
    ["Medicare Indicator", " "],
    ["Member Classification", "10  "],
    ["Benefit Package ID", " ".repeat(8)],
    ["Eligibility Effective Date", "20250801"],
    ["Eligibility Termination Date", " ".repeat(8)],
    ["Mailing Address 1", "123 MAIN ST".padEnd(55)],
    ["Mailing Address 2", " ".repeat(55)],
    ["Mailing Address City", "SACRAMENTO".padEnd(30)],
    ["Mailing Address State", "CA"],
    ["Mailing Address Zip Code", "958140000".padEnd(15)], // digits only, no dashes
    ["Mailing Address Country", "   "],
    ["Residence Address 1", " ".repeat(55)],
    ["Member Home Phone", "9165551234".padEnd(14)], // digits only, space filled
    ["Member Work Phone", " ".repeat(14)],
    ["Member Cell Phone", " ".repeat(14)],
    ["Member Email Address", "jane.doe@example.com".padEnd(64)],
    ["Contact Last Name", " ".repeat(35)], // QMSCO responsible party: no S2 source
    ["Contact Email Address", " ".repeat(64)],
    ["Provider Practice Location ID", " ".repeat(12)], // auto-assigned by zip
    ["NPI", " ".repeat(10)],
    ["COB Other Carrier Name", " ".repeat(50)],
    ["834 Action Codes", "   "],
    ["Group Reporting Data 1", " ".repeat(50)],
    ["Reserved", " ".repeat(192)],
  ];
  for (const [name, value] of expected) {
    it(`${name} = ${JSON.stringify(value)}`, () =>
      expect(field(record, name)).toBe(value));
  }
});

describe("golden dependent record (spouse under the subscriber's family link)", () => {
  const record = encodeDeltaRow({
    ...subscriberRow,
    memberSsn: "009876543",
    memberClassification: "20",
    lastName: "DOE",
    firstName: "JOHN",
    middleName: "",
    gender: "M",
    birthDate: "19790310",
    email: "",
  });

  const expected: Array<[string, string]> = [
    // Family linkage: dependent carries the SUBSCRIBER's ID at 45–60 and
    // their OWN SSN at 93–101.
    ["Primary Subscriber ID", "001234567".padEnd(16)],
    ["Member SSN", "009876543"],
    ["Member Classification", "20  "],
    ["Member First Name", "JOHN".padEnd(25)],
    ["Gender", "M"],
    ["Date of Birth", "19790310"],
    ["Member Email Address", " ".repeat(64)],
  ];
  for (const [name, value] of expected) {
    it(`${name} = ${JSON.stringify(value)}`, () =>
      expect(field(record, name)).toBe(value));
  }
});

describe("value normalization at the record boundary", () => {
  it("over-width values truncate at the field width without shifting", () => {
    const record = encodeDeltaRow({
      ...subscriberRow,
      lastName: "X".repeat(60),
    });
    expect(record.length).toBe(2000);
    expect(field(record, "Member Last Name")).toBe("X".repeat(35));
    expect(field(record, "Member First Name")).toBe("JANE".padEnd(25));
  });

  it("an unknown-SSN member emits spaces, per the handbook", () => {
    const record = encodeDeltaRow({ ...subscriberRow, memberSsn: "" });
    expect(field(record, "Member SSN")).toBe(" ".repeat(9));
  });

  it("an empty row still carries the record-type constant and nothing else", () => {
    const record = encodeDeltaRow({});
    expect(record.length).toBe(2000);
    expect(record.slice(0, 2)).toBe("30");
    expect(record.slice(2).trim()).toBe("");
  });
});
