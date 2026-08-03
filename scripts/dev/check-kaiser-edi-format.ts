/**
 * Golden-file format check for the Kaiser fixed-width EDI generator.
 *
 * The field layout (order + widths) below is an INDEPENDENT transcription of
 * the authoritative legacy PHP `edi_fields()` — do not derive it from the
 * plugin source, or the check proves nothing. Verifies:
 *  - the plugin layout matches the legacy layout exactly (names, widths, order)
 *  - total record width (1120 bytes) and per-field placement
 *  - kaiserEncodeNumber signed-overpunch encoding
 *  - byte-exact golden records for a subscriber ("A"), a QMSCO dependent ("D"),
 *    COBRA enrollment unit, null demographics, and over-width truncation
 *
 * Run: npx tsx scripts/dev/check-kaiser-edi-format.ts (registered as the
 * `kaiser-edi-format` validation).
 */
import {
  encodeKaiserRow,
  kaiserEncodeNumber,
  KAISER_EDI_FIELDS,
} from "../../server/plugins/trust/provider-edi/plugins/sitespecific-bao-kaiser";

// Legacy PHP edi_fields(): [name, width] in output order.
const LEGACY_LAYOUT: Array<[string, number]> = [
  ["Region Code", 3], ["Record Type", 1], ["Customer ID", 9], ["Enrollment Unit", 4],
  ["FILLER1", 36], ["Activity Date", 8], ["Transaction Type", 1], ["Record Code", 1],
  ["FILLER2", 38], ["Last Name", 25], ["First Name", 25], ["Middle Name", 25],
  ["Account Role", 2], ["FILLER3", 10], ["Birth Date", 8], ["Marital Status", 2],
  ["FILLER4", 10], ["Gender", 2], ["FILLER5", 5], ["FILLER6", 1], ["FILLER7", 2],
  ["Subscriber SSN", 9], ["Member SSN", 9], ["FILLER8", 2], ["Employee ID", 9],
  ["Supplemental ID", 16], ["Employer ID", 4], ["Employment Status", 2],
  ["FILLER9", 5], ["Hire Date", 8], ["Home Phone", 10], ["Work", 10],
  ["FILLER10", 30], ["Address Line 1", 40], ["Address Line 2", 40],
  ["FILLER11", 30], ["City", 45], ["FILLER12", 45], ["State", 2], ["ZIP Code", 5],
  ["FILLER13", 2], ["ZIP Plus 4", 4], ["FILLER14", 45], ["Enrollment  Reason", 2],
  ["FILLER15", 10], ["Effective Date", 8], ["FILLER16", 8], ["FILLER17", 2],
  ["FILLER18", 10], ["Termination Date", 8], ["FILLER19", 2], ["FILLER20", 8],
  ["Current Eligibility Status", 1], ["Current Dues Amount", 7],
  ["Current Rate Code", 5], ["Retroactivity Date", 8],
  ["Retroactive Dues Amount", 7], ["Retroactive Rate Code", 5],
  ["Additional Retroactivity", 220], ["FILLER21", 7], ["Eligibility Date", 8],
  ["Dues Amount or Rate Code", 7], ["Eligibility Status", 1],
  ["Additional Eligibility Grid Information", 160], ["FILLER22", 36],
];
const TOTAL_WIDTH = LEGACY_LAYOUT.reduce((a, [, w]) => a + w, 0); // 1120

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
check("field count", KAISER_EDI_FIELDS.length, LEGACY_LAYOUT.length);
KAISER_EDI_FIELDS.forEach((f, i) => {
  check(`field[${i}] name`, f.name, LEGACY_LAYOUT[i]?.[0]);
  check(`field[${i}] width`, f.width, LEGACY_LAYOUT[i]?.[1]);
});

// 2. kaiserEncodeNumber signed overpunch (legacy kaiser_encode_number).
check("encode 0", kaiserEncodeNumber(0), "000000{");
// 123.45 → 12345 cents → "0012345" → last digit 5 → 'E' (positive) / 'N' (negative)
check("encode 123.45", kaiserEncodeNumber(123.45), "001234E");
check("encode -123.45", kaiserEncodeNumber(-123.45), "001234N");
check("encode 0.10", kaiserEncodeNumber(0.1), "000001{");
check("encode 99999.99", kaiserEncodeNumber(99999.99), "999999I");

// 3. Golden subscriber "A" record.
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
const rec = encodeKaiserRow(subscriberRow);
check("record width", rec.length, TOTAL_WIDTH);
check("Region Code", slice(rec, "Region Code"), "SCR");
check("Record Type", slice(rec, "Record Type"), "1");
check("Customer ID", slice(rec, "Customer ID"), "000226111");
check("Enrollment Unit", slice(rec, "Enrollment Unit"), "0000");
check("FILLER1 blank", slice(rec, "FILLER1"), " ".repeat(36));
check("Activity Date", slice(rec, "Activity Date"), "20260801");
check("Transaction Type blank", slice(rec, "Transaction Type"), " ");
check("Record Code", slice(rec, "Record Code"), "A");
check("Last Name", slice(rec, "Last Name"), "DOE".padEnd(25));
check("First Name", slice(rec, "First Name"), "JANE".padEnd(25));
check("Middle Name", slice(rec, "Middle Name"), "Q".padEnd(25));
check("Account Role", slice(rec, "Account Role"), "01");
check("Birth Date", slice(rec, "Birth Date"), "19800115");
check("Gender", slice(rec, "Gender"), "02");
check("Subscriber SSN", slice(rec, "Subscriber SSN"), "001234567");
check("Member SSN", slice(rec, "Member SSN"), "001234567");
check("Supplemental ID blank", slice(rec, "Supplemental ID"), " ".repeat(16));
check("Home Phone", slice(rec, "Home Phone"), "5105551234");
check("Address Line 1", slice(rec, "Address Line 1"), "123 MAIN ST".padEnd(40));
check("Address Line 2 blank", slice(rec, "Address Line 2"), " ".repeat(40));
check("City", slice(rec, "City"), "OAKLAND".padEnd(45));
check("State", slice(rec, "State"), "CA");
check("ZIP Code", slice(rec, "ZIP Code"), "94612");
check("ZIP Plus 4 blank", slice(rec, "ZIP Plus 4"), "    ");
check("Effective Date", slice(rec, "Effective Date"), "20250801");
check("Termination Date blank", slice(rec, "Termination Date"), " ".repeat(8));
check("Current Dues Amount", slice(rec, "Current Dues Amount"), "000000{");
check("FILLER22 blank", slice(rec, "FILLER22"), " ".repeat(36));

// 4. QMSCO dependent "D" record with COBRA unit and termination date.
const dependentRow = {
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
};
const dep = encodeKaiserRow(dependentRow);
check("D record width", dep.length, TOTAL_WIDTH);
check("D Enrollment Unit (COBRA)", slice(dep, "Enrollment Unit"), "7000");
check("D Record Code", slice(dep, "Record Code"), "D");
check("D Subscriber SSN", slice(dep, "Subscriber SSN"), "001234567");
check("D Member SSN", slice(dep, "Member SSN"), "009876543");
check("D Account Role", slice(dep, "Account Role"), "06");
check("D Supplemental ID (QMSCO)", slice(dep, "Supplemental ID"), "08".padEnd(16));
check("D Termination Date", slice(dep, "Termination Date"), "20261231");

// 5. Null demographics — everything pads to spaces, record stays full width.
const emptyRec = encodeKaiserRow({});
check("empty record width", emptyRec.length, TOTAL_WIDTH);
check("empty Record Type still 1", slice(emptyRec, "Record Type"), "1");
check(
  "empty record otherwise blank",
  emptyRec.slice(0, 3).trim() + emptyRec.slice(4).trim(),
  "",
);

// 6. Over-width values are truncated, never shift later fields.
const longRec = encodeKaiserRow({
  ...subscriberRow,
  lastName: "X".repeat(60),
  city: "Y".repeat(90),
});
check("truncated record width", longRec.length, TOTAL_WIDTH);
check("truncated Last Name", slice(longRec, "Last Name"), "X".repeat(25));
check("truncated City", slice(longRec, "City"), "Y".repeat(45));
check("field after truncated name intact", slice(longRec, "Account Role"), "01");

if (failures > 0) {
  console.error(`\n✗ Kaiser EDI format check FAILED (${failures} mismatch(es)).`);
  process.exit(1);
}
console.log("✓ Kaiser EDI format check passed (layout, overpunch, golden records).");
