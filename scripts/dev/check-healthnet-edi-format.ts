/**
 * Golden-file format check for the HealthNet fixed-width EDI generator.
 *
 * The field layout (order + widths) below is an INDEPENDENT transcription of
 * the authoritative legacy PHP `edi_fields()` — do not derive it from the
 * plugin source, or the check proves nothing. Verifies:
 *  - the plugin layout matches the legacy layout exactly (names, widths, order)
 *  - total record width (349 bytes) and per-field placement
 *  - member-type mapping (M/P/D/S/Q, fallback M)
 *  - byte-exact golden records for a subscriber ("M"), a QMSCO dependent
 *    ("Q"), COBRA pay status, null demographics, and over-width truncation
 *
 * Run: npx tsx scripts/dev/check-healthnet-edi-format.ts (registered as the
 * `healthnet-edi-format` validation).
 */
import {
  encodeHealthnetRow,
  memberType,
  HEALTHNET_EDI_FIELDS,
} from "../../server/plugins/trust/provider-edi/plugins/sitespecific-bao-healthnet";

// Legacy PHP edi_fields(): [name, width] in output order.
const LEGACY_LAYOUT: Array<[string, number]> = [
  ["Health Net Group Number", 6], ["Reserved 1", 2], ["File Date", 8],
  ["Transaction Type (Activity Flag)", 1], ["Coverage Begin Date", 8],
  ["Subscriber SSN", 9], ["Dependent SSN", 9], ["Member Type", 1],
  ["Reserved 2", 3], ["Last Name & Suffix", 17], ["First Name", 10],
  ["Middle Initial", 1], ["Gender", 1], ["Date of Birth", 8],
  ["Address Line 1", 25], ["Address Line 2", 25], ["City", 17], ["State", 2],
  ["Zip Code", 5], ["Zip Code +4 Extension", 4], ["Work Telephone", 10],
  ["Residence Telephone", 10], ["Provider ID", 4], ["Physician Last Name", 20],
  ["Physician First Name", 20], ["Physician Middle Initial", 1],
  ["4-Digit PPG ID", 4], ["6-Digit PCP ID", 6], ["Current Patient Indicator", 1],
  ["Hire Date", 8], ["Employee Number", 6], ["Department", 6],
  ["COBRA End Date", 6], ["Pay Status Code", 2], ["Contract Type", 1],
  ["Number Covered", 2], ["Coverage End Date", 8], ["Foreign Address Flag", 1],
  ["Correspondence Indicator", 3], ["Ethnicity Indicator", 3],
  ["Student Indicator", 1], ["Medicare Part A Indicator", 1],
  ["Medicare Part B Indicator", 1], ["Medicare Parts A & B Indicator", 1],
  ["Medicare Part D Indicator", 1], ["Disabled Indicator", 1], ["Filler 1", 13],
  ["Health Insurance Claim Number (for Medicare COB)", 13],
  ["Coordination of Benefits", 1], ["Insurance Line Code", 3],
  ["Current Premium Amount", 8], ["Retroactive Debit Amount", 8],
  ["Retroactive Credit Amount", 8], ["Record End Designator", 5],
];
const TOTAL_WIDTH = LEGACY_LAYOUT.reduce((a, [, w]) => a + w, 0); // 349

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`✗ ${label}\n    expected ${e}\n    actual   ${a}`);
  }
}

// Field offsets by name from the legacy layout.
const offsets = new Map<string, { start: number; width: number }>();
{
  let pos = 0;
  for (const [name, width] of LEGACY_LAYOUT) {
    offsets.set(name, { start: pos, width });
    pos += width;
  }
}
function slice(record: string, name: string): string {
  const f = offsets.get(name)!;
  return record.slice(f.start, f.start + f.width);
}

// 1. Plugin layout matches the legacy layout exactly.
check("field count", HEALTHNET_EDI_FIELDS.length, LEGACY_LAYOUT.length);
HEALTHNET_EDI_FIELDS.forEach((f, i) => {
  check(`field[${i}] name`, f.name, LEGACY_LAYOUT[i]?.[0]);
  check(`field[${i}] width`, f.width, LEGACY_LAYOUT[i]?.[1]);
});
check("total width", TOTAL_WIDTH, 349);

// 2. Member-type mapping (legacy member_type()).
check("member type self", memberType(null), "M");
check("member type DP", memberType("DP"), "P");
for (const t of ["C", "AC", "H", "SC", "G"]) {
  check(`member type ${t}`, memberType(t), "D");
}
check("member type SP", memberType("SP"), "S");
check("member type QMSCO", memberType("QMSCO"), "Q");
check("member type unknown", memberType("XX"), "M");

// 3. Golden subscriber ("M") record.
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
const rec = encodeHealthnetRow(subscriberRow);
check("record width", rec.length, TOTAL_WIDTH);
check("Group Number", slice(rec, "Health Net Group Number"), "LB391A");
check("Reserved 1 blank", slice(rec, "Reserved 1"), "  ");
check("File Date", slice(rec, "File Date"), "20260801");
check("Transaction Type blank", slice(rec, "Transaction Type (Activity Flag)"), " ");
check("Coverage Begin Date", slice(rec, "Coverage Begin Date"), "20250801");
check("Subscriber SSN", slice(rec, "Subscriber SSN"), "001234567");
check("Dependent SSN", slice(rec, "Dependent SSN"), "001234567");
check("Member Type", slice(rec, "Member Type"), "M");
check("Reserved 2 blank", slice(rec, "Reserved 2"), "   ");
check("Last Name", slice(rec, "Last Name & Suffix"), "DOE".padEnd(17));
check("First Name", slice(rec, "First Name"), "JANE".padEnd(10));
check("Middle Initial", slice(rec, "Middle Initial"), "Q");
check("Gender", slice(rec, "Gender"), "F");
check("Date of Birth", slice(rec, "Date of Birth"), "19800115");
check("Address Line 1", slice(rec, "Address Line 1"), "123 MAIN ST".padEnd(25));
check("Address Line 2 blank", slice(rec, "Address Line 2"), " ".repeat(25));
check("City", slice(rec, "City"), "OAKLAND".padEnd(17));
check("State", slice(rec, "State"), "CA");
check("Zip Code", slice(rec, "Zip Code"), "94612");
check("Zip +4 blank", slice(rec, "Zip Code +4 Extension"), "    ");
check("Work Telephone", slice(rec, "Work Telephone"), "5105551234");
check("Residence Telephone blank", slice(rec, "Residence Telephone"), " ".repeat(10));
check("Physician Last Name blank", slice(rec, "Physician Last Name"), " ".repeat(20));
check("Hire Date", slice(rec, "Hire Date"), "20240301");
check("Pay Status Code", slice(rec, "Pay Status Code"), "AC");
check("Contract Type", slice(rec, "Contract Type"), "2");
check("Number Covered", slice(rec, "Number Covered"), "2 ");
check("Coverage End Date blank", slice(rec, "Coverage End Date"), " ".repeat(8));
check("Medicare Part A blank", slice(rec, "Medicare Part A Indicator"), " ");
check("Filler 1 blank", slice(rec, "Filler 1"), " ".repeat(13));
check("Insurance Line Code", slice(rec, "Insurance Line Code"), "HMO");
check("Current Premium blank", slice(rec, "Current Premium Amount"), " ".repeat(8));
check("Record End Designator", slice(rec, "Record End Designator"), "HNPES");

// 4. QMSCO dependent ("Q") record with COBRA subscriber context: dependent
// rows blank out phone, hire date, pay status, contract type, covered count.
const dependentRow = {
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
};
const dep = encodeHealthnetRow(dependentRow);
check("Q record width", dep.length, TOTAL_WIDTH);
check("Q Subscriber SSN", slice(dep, "Subscriber SSN"), "001234567");
check("Q Dependent SSN", slice(dep, "Dependent SSN"), "009876543");
check("Q Member Type", slice(dep, "Member Type"), "Q");
check("Q Work Telephone blank", slice(dep, "Work Telephone"), " ".repeat(10));
check("Q Hire Date blank", slice(dep, "Hire Date"), " ".repeat(8));
check("Q Pay Status blank", slice(dep, "Pay Status Code"), "  ");
check("Q Contract Type blank", slice(dep, "Contract Type"), " ");
check("Q Number Covered blank", slice(dep, "Number Covered"), "  ");
check("Q Record End Designator", slice(dep, "Record End Designator"), "HNPES");

// 5. COBRA subscriber pay status.
const cobraRec = encodeHealthnetRow({ ...subscriberRow, payStatusCode: "CO" });
check("CO Pay Status", slice(cobraRec, "Pay Status Code"), "CO");

// 6. Null demographics — everything pads to spaces except constants.
const emptyRec = encodeHealthnetRow({});
check("empty record width", emptyRec.length, TOTAL_WIDTH);
check("empty Insurance Line Code", slice(emptyRec, "Insurance Line Code"), "HMO");
check("empty Record End Designator", slice(emptyRec, "Record End Designator"), "HNPES");
const constantsStripped =
  emptyRec.slice(0, offsets.get("Insurance Line Code")!.start) +
  emptyRec.slice(
    offsets.get("Insurance Line Code")!.start + 3,
    offsets.get("Record End Designator")!.start,
  );
check("empty record otherwise blank", constantsStripped.trim(), "");

// 7. Over-width values are truncated, never shift later fields.
const longRec = encodeHealthnetRow({
  ...subscriberRow,
  lastName: "X".repeat(60),
  city: "Y".repeat(90),
});
check("truncated record width", longRec.length, TOTAL_WIDTH);
check("truncated Last Name", slice(longRec, "Last Name & Suffix"), "X".repeat(17));
check("truncated City", slice(longRec, "City"), "Y".repeat(17));
check("field after truncated name intact", slice(longRec, "First Name"), "JANE".padEnd(10));

if (failures > 0) {
  console.error(`\n✗ HealthNet EDI format check FAILED (${failures} mismatch(es)).`);
  process.exit(1);
}
console.log("✓ HealthNet EDI format check passed (layout, member types, golden records).");
