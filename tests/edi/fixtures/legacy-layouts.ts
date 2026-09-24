/**
 * The expected fixed-width layout of record for every trust-provider EDI
 * plugin, keyed by plugin id.
 *
 * Each entry is an INDEPENDENT transcription of the authoritative legacy PHP
 * `edi_fields()` for that provider — field name, order, and width, exactly as
 * the provider's parser expects them. It is deliberately NOT derived from the
 * plugin source: the conformance suite compares the live field table against
 * this list, so deriving it would prove nothing.
 *
 * Registering a new EDI plugin means adding its layout here. The conformance
 * suite fails a registered plugin that has no entry, rather than letting it
 * ship untested.
 */

export interface LegacyLayout {
  /**
   * Sum of every field width — the exact byte length of one record. Pinned
   * as a literal so a compensating pair of width edits still fails.
   */
  totalWidth: number;
  /** `[name, width]` in output order. */
  fields: ReadonlyArray<readonly [string, number]>;
}

/** Legacy PHP `edi_fields()` — Kaiser Permanente eligibility file. */
const KAISER: LegacyLayout = {
  totalWidth: 1120,
  fields: [
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
  ],
};

/** Legacy PHP `edi_fields()` — HealthNet eligibility file. */
const HEALTHNET: LegacyLayout = {
  totalWidth: 349,
  fields: [
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
  ],
};

export const LEGACY_LAYOUTS: Readonly<Record<string, LegacyLayout>> = {
  "sitespecific-bao-kaiser": KAISER,
  "sitespecific-bao-healthnet": HEALTHNET,
};
