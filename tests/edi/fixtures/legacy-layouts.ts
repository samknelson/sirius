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

export const LEGACY_LAYOUTS: Readonly<Record<string, LegacyLayout>> = {
  "sitespecific-bao-kaiser": KAISER,
  "sitespecific-bao-healthnet": HEALTHNET,
  "sitespecific-smf-delta": SMF_DELTA,
};
