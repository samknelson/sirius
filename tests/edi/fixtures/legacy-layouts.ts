/**
 * The expected layout of record for every trust-provider EDI plugin, keyed by
 * plugin id.
 *
 * Each entry is an INDEPENDENT transcription of the authoritative source for
 * that provider — the legacy PHP generator, or the carrier's own handbook
 * where one has been adopted (Delta). It is deliberately NOT derived from the
 * plugin source: the conformance suite compares the live field table against
 * this list, so deriving it would prove nothing.
 *
 * A provider's file is either fixed-width or CSV, and is pinned in the
 * matching map:
 *  - `LEGACY_LAYOUTS` — fixed-width records: field name, order, and width,
 *    exactly as the provider's parser expects them, plus the record width.
 *  - `LEGACY_CSV_LAYOUTS` — CSV records: column name and order. A CSV cell
 *    has no width, so none is pinned.
 *
 * Registering a new EDI plugin means adding its layout to one of the two
 * maps. The conformance suite fails a registered plugin that has no entry,
 * rather than letting it ship untested.
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

/**
 * Delta Dental "Enterprise Standard File Layout (SFL) Traders Handbook"
 * ver 1.1 — Individual Eligibility ("30") record, transcribed from the
 * handbook's one-based positions (record closes at byte 2,000). See
 * docs/edi/smf-delta-dental.md for the full field-by-field reference.
 */
const SMF_DELTA: LegacyLayout = {
  totalWidth: 2000,
  fields: [
    ["Record Type", 2],                              // 1–2
    ["Group ID", 5],                                 // 3–7
    ["Division ID", 5],                              // 8–12
    ["Employer Reference ID", 12],                   // 13–24
    ["Employment Class", 4],                         // 25–28
    ["Incentive Start Date", 8],                     // 29–36
    ["Waiting Period Start Date", 8],                // 37–44
    ["Primary Subscriber ID", 16],                   // 45–60
    ["Subscriber Alternate ID", 16],                 // 61–76
    ["Case ID", 16],                                 // 77–92
    ["Member SSN", 9],                               // 93–101
    ["Member Last Name", 35],                        // 102–136
    ["Member First Name", 25],                       // 137–161
    ["Member Middle Name", 25],                      // 162–186
    ["Member Name Suffix", 10],                      // 187–196
    ["Gender", 1],                                   // 197
    ["Date of Birth", 8],                            // 198–205
    ["Ethnicity Code", 4],                           // 206–209
    ["Language Code", 2],                            // 210–211
    ["Medicare Indicator", 1],                       // 212
    ["Member Classification", 4],                    // 213–216
    ["Business Level 4", 12],                        // 217–228
    ["Business Level 5", 12],                        // 229–240
    ["Business Level 6", 12],                        // 241–252
    ["Business Level 7", 12],                        // 253–264
    ["Benefit Package ID", 8],                       // 265–272
    ["Benefit Package Effective Date", 8],           // 273–280
    ["Benefit Package Termination Date", 8],         // 281–288
    ["Eligibility Effective Date", 8],               // 289–296
    ["Eligibility Termination Date", 8],             // 297–304
    ["Mailing Address 1", 55],                       // 305–359
    ["Mailing Address 2", 55],                       // 360–414
    ["Mailing Address 3", 55],                       // 415–469
    ["Mailing Address City", 30],                    // 470–499
    ["Mailing Address State", 2],                    // 500–501
    ["Mailing Address Zip Code", 15],                // 502–516
    ["Mailing Address Country", 3],                  // 517–519
    ["Service Area", 2],                             // 520–521
    ["Residence Address 1", 55],                     // 522–576
    ["Residence Address 2", 55],                     // 577–631
    ["Residence Address 3", 55],                     // 632–686
    ["Residence Address City", 30],                  // 687–716
    ["Residence Address State", 2],                  // 717–718
    ["Residence Address Zip Code", 15],              // 719–733
    ["Residence Address Country", 3],                // 734–736
    ["Member Home Phone", 14],                       // 737–750
    ["Member Work Phone", 14],                       // 751–764
    ["Member Work Phone Extension", 5],              // 765–769
    ["Member Cell Phone", 14],                       // 770–783
    ["Member Email Address", 64],                    // 784–847
    ["Contact Last Name", 35],                       // 848–882
    ["Contact First Name", 25],                      // 883–907
    ["Contact Middle Name", 25],                     // 908–932
    ["Contact Name Suffix", 10],                     // 933–942
    ["Contact Address 1", 55],                       // 943–997
    ["Contact Address 2", 55],                       // 998–1052
    ["Contact Address 3", 55],                       // 1053–1107
    ["Contact City", 30],                            // 1108–1137
    ["Contact State", 2],                            // 1138–1139
    ["Contact Zip Code", 15],                        // 1140–1154
    ["Contact Country", 3],                          // 1155–1157
    ["Contact Phone", 14],                           // 1158–1171
    ["Contact Phone Extension", 5],                  // 1172–1176
    ["Contact Email Address", 64],                   // 1177–1240
    ["Provider Practice Location ID", 12],           // 1241–1252
    ["MPNA Effective Date", 8],                      // 1253–1260
    ["MPNA Termination Date", 8],                    // 1261–1268
    ["Provider Termination Reason Code", 4],         // 1269–1272
    ["Network ID", 12],                              // 1273–1284
    ["NPI", 10],                                     // 1285–1294
    ["COB Other Carrier Name", 50],                  // 1295–1344
    ["COB Other Carrier Group/Policy #", 12],        // 1345–1356
    ["COB Other Carrier  Address 1", 55],            // 1357–1411
    ["COB Other Carrier  Address 2", 55],            // 1412–1466
    ["COB Other Carrier  City", 30],                 // 1467–1496
    ["COB Other Carrier  State", 2],                 // 1497–1498
    ["COB Other Carrier  Zip Code", 15],             // 1499–1513
    ["COB Other Carrier Subscriber Last Name", 35],  // 1514–1548
    ["COB Other Carrier Subscriber First Name", 25], // 1549–1573
    ["COB Other Carrier Subscriber ID", 12],         // 1574–1585
    ["Other Carrier Subscriber DOB", 8],             // 1586–1593
    ["COB Effective Date", 8],                       // 1594–1601
    ["COB Termination Date", 8],                     // 1602–1609
    ["834 Action Codes", 3],                         // 1610–1612
    ["Group Reporting Data 1", 50],                  // 1613–1662
    ["Group Reporting Data 2", 146],                 // 1663–1808
    ["Reserved", 192],                               // 1809–2000
  ],
};

/**
 * Legacy PHP `edi_fields()` (reports/edi_expressscripts.inc) — Express
 * Scripts eligibility file, member detail ("M") record. The header ("H") and
 * trailer ("T") records are the same 1,500 bytes wide but are not the record
 * this suite measures.
 */
const SMF_EXPRESSSCRIPTS: LegacyLayout = {
  totalWidth: 1500,
  fields: [
    ["Record Type", 1], ["Client Identifier", 3], ["Participant ID #1", 18],
    ["Participant ID #2", 18], ["Participant Effective Date", 8],
    ["Participant First Name", 12], ["Participant Last Name", 18],
    ["Participant Middle Initial", 1], ["Address #1", 30], ["Address #2", 30],
    ["Address #3", 30], ["Address #4", 30], ["City", 28], ["State", 2], ["Zip Code", 5],
    ["Zip Reserve", 4], ["Date of Birth", 8], ["Gender Code", 1],
    ["Contract or Family ID", 18], ["Dependent ID", 5], ["Relationship Code", 1],
    ["Client Group ID", 18], ["PCP ID", 18], ["Reserved1", 8], ["Filler1", 18],
    ["Reserved2", 8], ["Transaction Date", 8], ["Participant Expiration Date", 8],
    ["Insurance Code", 20], ["Reserved3", 1], ["Reserved4", 7], ["Filler2", 1],
    ["Medicare ID", 12], ["Reserved5", 1], ["Reserved6", 7], ["Copay Waiver Flag", 1],
    ["Coverage Code Status", 1], ["Print ID Card Flag", 1], ["Admin Hold Eff Date", 8],
    ["Admin Hold Exp Date", 8], ["COB Indicator/ Primary Carrier Flag", 1],
    ["Client Specific Data", 62], ["Reserved7", 1], ["Member Level Address Type", 1],
    ["Hospice Indicator", 1], ["Suspense Indicator", 1], ["COB Effective date", 8],
    ["Contract Type", 2], ["Member SSN", 9], ["Subsidy/ESRD", 1], ["Phone Number", 10],
    ["Demographic Level 1", 20], ["Demographic Level 2", 20], ["Demographic Level 3", 20],
    ["Demographic Level 4", 20], ["Demographic Level 5", 20], ["Demographic Level 6", 20],
    ["Participant ID #3", 18], ["Participant ID #4", 18], ["County Code", 3],
    ["Subsidy Eff Date", 8], ["Subsidy Exp Date", 8], ["Application ID", 10],
    ["Benefit Option ID", 20], ["Filler3", 14], ["Multi-Birth Indicator", 1],
    ["Client Specific 2", 54], ["Record Sequence No.", 4], ["PDP Indicator", 1],
    ["Secondary-Drug-Insurance-Flag", 1], ["Secondary-Rx-Group", 15],
    ["Secondary-Rx-ID", 20], ["Election Type", 1], ["Part D Premium-Amt", 6],
    ["Premium-Withhold-Option-C-D", 1], ["Disenrollment-Indicator", 1], ["Filler4", 87],
    ["Last Name Expanded", 35], ["First Name Expanded", 25],
    ["Middle Initial Expanded", 1], ["Address Line1 Expanded", 55],
    ["Address Line2 Expanded", 55], ["Address Line3 Expanded", 55],
    ["Address City Expanded", 30], ["Address State Expanded", 2],
    ["Address Zip5 Expanded", 5], ["Address Zip4 Expanded", 4],
    ["Address Country Code Expanded", 3], ["Primary Phone", 10],
    ["Primary Phone Country Calling Code - Reserved for future.", 3],
    ["Primary Phone Extension - Reserved for future.", 6], ["Primary Phone Type", 1],
    ["Communication Preference", 1], ["Filler5", 9], ["Alternate Phone", 10],
    ["Alternate Phone Country Calling Code - Reserved for future.", 3],
    ["Alternate Phone Extension - Reserved for future.", 6], ["Alternate Phone Type", 1],
    ["Filler6", 1], ["Primary Email", 80], ["Primary Email Type – Reserved for Future", 1],
    ["Alternate Email – Reserved for Future", 80],
    ["Alternate Email Type – Reserved for Future", 1],
    ["Preferred Contact Method – Reserved for Future", 1], ["Preferred  Language -", 3],
    ["Time Zone", 5], ["Filler7", 3], ["HCR Plan Indicator", 1],
    ["Grace Period Logic Effective Date", 8], ["Ethnicity Indicator", 1], ["Filler8", 62],
  ],
};

/** Legacy PHP `edi_fields()` (reports/edi_vsp.inc) — VSP vision eligibility file. */
const SMF_VSP: LegacyLayout = {
  totalWidth: 600,
  fields: [
    ["Subscriber Record ID", 3], ["Full Replacement Files", 1], ["Control Number", 5],
    ["Subscriber ID", 30], ["Subscriber SSN", 9], ["Alternate Subscriber ID", 30],
    ["Previous Subscriber ID", 30], ["Dependent SSN", 9], ["Subscriber Last Name", 18],
    ["Subscriber First Name", 12], ["Subscriber Middle Initial", 1],
    ["Subscriber Name-Suffix", 3], ["Gender", 1], ["Family-Indicator", 1],
    ["Date of Birth", 8], ["Vision Coverage Begin Date", 8],
    ["Vision Coverage End Date", 8], ["Family Indicator Change Effective Date", 8],
    ["Division-Code", 30], ["Cross-Reference Code", 16],
    ["Subscriber Residence Address Line 1", 30],
    ["Subscriber Residence Address Line 2", 30], ["Subscriber Residence City", 19],
    ["Subscriber Residence State Code", 2], ["Subscriber Residence ZIP Code", 10],
    ["Subscriber Residence Phone Number", 10], ["Subscriber Residence Country", 3],
    ["Subscriber Home Email Address", 50], ["Subscriber Work Email Address", 50],
    ["Subscriber Mailing Address Line 1", 30], ["Subscriber Mailing Address Line 2", 30],
    ["Subscriber Mailing City", 19], ["Subscriber Mailing State", 2],
    ["Subscriber Mailing ZIP Code", 10], ["Subscriber Mailing Country", 3],
    ["Subscriber Work Phone Number", 10], ["Subscriber Message Phone", 10],
    ["Subscriber Native Language", 3], ["Subscriber Spoken Language", 3],
    ["Subscriber Reading Language", 3], ["Subscriber Ethnicity", 1],
    ["Subscriber Status Code", 1], ["Subscriber Citizenship Status Code", 2],
    ["Subscriber Status", 2], ["Subscriber Marital Status Code", 1],
    ["Subscriber Medicare Plan Code", 1], ["Filler2", 34],
  ],
};

export const LEGACY_LAYOUTS: Readonly<Record<string, LegacyLayout>> = {
  "sitespecific-bao-kaiser": KAISER,
  "sitespecific-bao-healthnet": HEALTHNET,
  "sitespecific-smf-delta": SMF_DELTA,
  "sitespecific-smf-expressscripts": SMF_EXPRESSSCRIPTS,
  "sitespecific-smf-vsp": SMF_VSP,
};

/**
 * The expected layout of one CSV detail record: its columns, in output order.
 *
 * The legacy generators for Carelon and Dentwell also list a `width` beside
 * each column. Those widths are not pinned: both generators declare CSV
 * output, and Dentwell declares width 1 for the header column that carries
 * its eight-digit report date, so the legacy CSV output did not apply them.
 */
export interface LegacyCsvLayout {
  /** Column names in output order. */
  columns: ReadonlyArray<string>;
}

/** Legacy PHP `edi_fields()` (reports/edi_carelon.inc) — Carelon EAP eligibility CSV. */
const SMF_CARELON: LegacyCsvLayout = {
  columns: [
    "MEMBNO", "SOCSEC", "LSTNAM", "FSTNAM", "MIDNAM", "ADRLN1", "ADRLN2", "CITYCD",
    "STACOD", "ZIPCOD", "HOMPHN", "WRKPHN", "BTHDAT", "RELCOD", "SEXCOD", "GRPEFF",
    "GRPEXP", "GRPNUM", "BENPKG", "TIERCD", "MSTACD", "ALTNUM", "CLIDEF",
  ],
};

/**
 * Legacy PHP `edi_fields()` (reports/edi_dentwell.inc) — Dentwell eligibility
 * CSV, member detail ("E") record. The "H" header and "T" trailer records have
 * their own three-column layouts and are not the record this suite measures.
 */
const SMF_DENTWELL: LegacyCsvLayout = {
  columns: [
    "Record Type", "SubscriberNumber", "MemberType", "EffectiveDate", "TerminationDate",
    "Status", "LastName", "FirstName", "MiddleName", "DateOfBirth", "Address1",
    "Address2", "City", "State", "Zip", "HomePhone", "Email", "Gender",
    "RelationshipCode",
  ],
};

/** Legacy PHP `fields()` (reports/edi_hinge.inc) — Hinge Health eligibility CSV. */
const SMF_HINGE: LegacyCsvLayout = {
  columns: [
    "subscriber_id", "first_name", "last_name", "dob", "relationship", "sex",
    "address1", "address2", "city", "state", "zip", "email", "start_date",
    "term_date", "language",
  ],
};

/**
 * Legacy PHP (reports/edi_local11.inc) — Local 11 hours export CSV. The
 * columns are the generator's `default_display_fields`, in that order, under
 * the titles its `fields()` gives them. `fields()` also names Worker NID and
 * Payperiod NID, which are link targets for the legacy preview and are not in
 * the display list.
 */
const SMF_LOCAL11: LegacyCsvLayout = {
  columns: [
    "Worker SSN", "Worker Name", "Employer Name", "Employer Code", "Year", "Month",
    "Hours", "Hours Type",
  ],
};

/** Legacy PHP `edi_fields()` (reports/edi_mlk.inc) — MLK Community Healthcare eligibility CSV. */
const SMF_MLK: LegacyCsvLayout = {
  columns: [
    "POLICY", "PLAN", "GROUP", "FILE DT", "MEM ACCT", "DEP ACCT", "MEM/DEP", "LN", "FN",
    "MI", "DEP REL", "BD", "SEX", "SSN", "DEP SSN", "PHONE", "ADDR1", "ADDR2", "CITY",
    "ST", "ZIP", "EFF DT", "TERM DT", "PCP", "LOB", "ERN", "EMPLOYER", "EMAIL",
  ],
};

export const LEGACY_CSV_LAYOUTS: Readonly<Record<string, LegacyCsvLayout>> = {
  "sitespecific-smf-carelon": SMF_CARELON,
  "sitespecific-smf-dentwell": SMF_DENTWELL,
  "sitespecific-smf-hinge": SMF_HINGE,
  "sitespecific-smf-local11": SMF_LOCAL11,
  "sitespecific-smf-mlk": SMF_MLK,
};
