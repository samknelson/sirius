# SMF — Delta Dental eligibility file

Plugin: `sitespecific-smf-delta`
(`server/plugins/trust/provider-edi/plugins/sitespecific-smf-delta.ts`)

## 1. Source specification

Delta Dental **"Enterprise Standard File Layout (SFL) Traders Handbook"
ver 1.1** (Delta Dental Plan of California; document last saved
2025-05-12), "Full and Changes-Only Files" section. Transcribed 2026-09-02.

Handbook constraints:

- Record size is **2,000 bytes** for every record type, including fields
  reserved for future Delta Dental use and for group-supplied data.
- A **file-level header record is required**; group/division-level header
  records are optional and not sent.
- We send a **full file** (not changes-only): every covered member as of
  the reporting month.

## 2. Record inventory

| Record | Type constant (pos 1–2) | Length | Count |
| --- | --- | --- | --- |
| File header | `10` | 2,000 | 1 |
| Individual Eligibility (detail) | `30` | 2,000 | one per covered subscriber or dependent |
| Trailer | `90` | 2,000 | 1 |

Lines are joined with CRLF by the generic EDI wizard delivery step.

## 3. Membership and family linkage

Membership is the standard WMB rule (`wmbPrimaryKeys` in
`server/plugins/trust/provider-edi/base.ts`): every worker holding a
monthly benefit record (`trust_wmb`) for the dental benefit (Sirius ID
`D`, config-overridable) in the as-of month. Each subscriber unit carries
its covered dependents — dependents appear **only** as dependent records
under their subscriber, never as their own standalone record, unless the
subscriber is not on the file (fail-safe).

Family linkage per the handbook: every member's record carries the
**subscriber's** SSN in *Primary Subscriber ID* (45–60, left justified,
space filled) and the member's **own** SSN in *Member SSN* (93–101,
spaces when unknown).

## 4. Header record (`10`)

| Field | Pos | Width | S2 mapping |
| --- | --- | --- | --- |
| Record Type | 1–2 | 2 | Constant `10` |
| Group ID | 3–7 | 5 | Config `groupId` (default `17975`, assigned by Delta) |
| Division ID | 8–12 | 5 | Blank — allowed blank on the file-level header |
| Reporting Date | 13–20 | 8 | Run as-of date, `YYYYMMDD` |
| File Type | 21 | 1 | Run input `mode`: `P` production (default) / `T` test |
| Report Set ID | 22–33 | 12 | Blank — reserved per handbook |
| File create date | 34–41 | 8 | Generation date (UTC), `YYYYMMDD` |
| File create time | 42–47 | 6 | Generation time (UTC), `HHMMSS` |
| Filler | 48–2000 | 1953 | Spaces |

## 5. Detail record (`30`) — field-by-field

Positions are one-based; the record closes at byte 2,000. "Blank" means
the field emits spaces because it has **no authoritative S2 source** — we
never invent values for optional carrier fields.

| Field | Pos | Width | Req | S2 mapping / rationale |
| --- | --- | --- | --- | --- |
| Record Type | 1–2 | 2 | Y | Constant `30` |
| Group ID | 3–7 | 5 | Y | Config `groupId` (default `17975`) |
| Division ID | 8–12 | 5 | Y | `09002` when the WMB row's employer is COBRA, else `00002` (established SMF divisions) |
| Employer Reference ID | 13–24 | 12 | | Blank — "store location" has no S2 equivalent |
| Employment Class | 25–28 | 4 | | Blank — customer-reporting field, unused |
| Incentive Start Date | 29–36 | 8 | | Blank — handbook: "Currently Not Used" |
| Waiting Period Start Date | 37–44 | 8 | | Blank — earliest effective date then applies |
| Primary Subscriber ID | 45–60 | 16 | Y | Subscriber SSN (`workers.ssn`, digits zero-padded to 9), left justified, space filled |
| Subscriber Alternate ID | 61–76 | 16 | | Blank — no alternate ID scheme |
| Case ID | 77–92 | 16 | | Blank — Medicaid-only field |
| Member SSN | 93–101 | 9 | | Member's own SSN; spaces when unknown (handbook rule) |
| Member Last Name | 102–136 | 35 | Y | `contacts.family` |
| Member First Name | 137–161 | 25 | Y | `contacts.given` |
| Member Middle Name | 162–186 | 25 | | `contacts.middle` |
| Member Name Suffix | 187–196 | 10 | | Blank — no suffix field in S2 |
| Gender | 197 | 1 | Y | Gender option code: `M` / `F`, else `U` (unknown) |
| Date of Birth | 198–205 | 8 | Y | `contacts.birth_date`, `YYYYMMDD` |
| Ethnicity Code | 206–209 | 4 | | Blank — not tracked |
| Language Code | 210–211 | 2 | | Blank — not tracked |
| Medicare Indicator | 212 | 1 | | Blank — not tracked |
| Member Classification | 213–216 | 4 | Y | Relation-type mapping, see §6 |
| Business Level 4–7 | 217–264 | 12×4 | | Blank — handbook: Reserved |
| Benefit Package ID / Eff / Term | 265–288 | 8×3 | | Blank — handbook: Reserved |
| Eligibility Effective Date | 289–296 | 8 | Y | First month of the member's contiguous `trust_wmb` run for the benefit, `YYYYMMDD` |
| Eligibility Termination Date | 297–304 | 8 | | Blank — a full file lists currently covered members only; termination is expressed by omission (see §8 Q3) |
| Mailing Address 1 | 305–359 | 55 | Y | Primary active postal `street` (per member; falls back to blank when the member has no address) |
| Mailing Address 2–3 | 360–469 | 55×2 | | Blank — S2 stores a single street line |
| Mailing Address City | 470–499 | 30 | Y | Postal `city` |
| Mailing Address State | 500–501 | 2 | Y | Postal `state` |
| Mailing Address Zip Code | 502–516 | 15 | Y | Postal code, digits only (handbook: no dashes) |
| Mailing Address Country | 517–519 | 3 | | Blank — domestic addresses |
| Service Area | 520–521 | 2 | | Blank |
| Residence Address block | 522–736 | | | Blank — only one (mailing) address is tracked |
| Member Home Phone | 737–750 | 14 | | Primary active phone, digits only, US country code stripped (handbook: no parentheses/dashes) |
| Member Work Phone (+ext) | 751–769 | | | Blank — phone type not distinguished |
| Member Cell Phone | 770–783 | 14 | | Blank — phone type not distinguished |
| Member Email Address | 784–847 | 64 | | `contacts.email` when present |
| Contact block (name/address/phone/email) | 848–1240 | | | Blank — the QMSCO responsible party of the legacy feed has no S2 source (see §8 Q2) |
| Provider Practice Location ID | 1241–1252 | 12 | | Blank — Delta auto-assigns a PCP by member zip code |
| MPNA / Provider / Network / NPI | 1253–1294 | | | Blank — provider assignment not managed here |
| COB block | 1295–1609 | | | Blank — coordination-of-benefits data not tracked |
| 834 Action Codes | 1610–1612 | 3 | | Blank — full file, not an 834 change feed |
| Group Reporting Data 1–2 | 1613–1808 | 50+146 | | Blank — handbook: Reserved |
| Reserved | 1809–2000 | 192 | | Spaces — closes the record at byte 2,000 |

## 6. Member Classification (213–216)

Handbook configured values: `10` Subscriber, `11` Surviving Spouse
Subscriber, `12` Child Subscriber, `13` Non-Covered Subscriber,
`20` Spouse, `21` Domestic Partner, `30` Child, `31` Student,
`32` Disabled Child, `33` IRS Dependent, `40` Other Adult (LDA).

S2 relation-type Sirius ID → classification:

| Relation | Code | Note |
| --- | --- | --- |
| (subscriber, no relation) | `10` | |
| `SP` | `20` | Spouse |
| `DP` | `21` | Domestic Partner |
| `C`, `AC`, `SC` | `30` | Child / Adopted / Step |
| `H` | `32` | Disabled ("Handicapped") Child |
| `G` | `40` | Other Adult (Guardian/Protected Person) |
| `QMSCO`, `RP` | `13` | Established SMF arrangement — see §8 Q1 |
| `EX` | blank | Ex-spouse must never emit a covered classification (2026-08-05 taxonomy ruling) |

## 7. Report-only values (never delivered)

The wizard preview also shows the medical-plan-derived **client group ID**
(`M`→`SMM00`, `H`→`SMH00`, `K`/`KE`→`SMK00`, config-overridable via
`medicalPlanGroupMap`). It is not part of any handbook position and is
carried for staff validation only. No S1 diagnostic identifiers (worker
NID, contact NID, subscriber number, premium columns) appear anywhere.

## 8. Open carrier questions

1. **QMSCO classification `13`.** The legacy SMF feed sends `13` for
   QMSCO children, but the handbook labels `13` "Non-Covered Subscriber".
   The established value is preserved to avoid breaking the existing
   group configuration; confirm with Delta whether QMSCO children should
   instead be `30`/`33` or a group-configured value.
2. **QMSCO responsible-party Contact block.** The legacy feed populated
   848–1240 from the QMSCO responsible-party worker. S2 has no
   responsible-party source on the relation model, so the block is blank.
   Confirm whether Delta requires it for QMSCO members.
3. **Eligibility Termination Date.** As a full monthly file, terminated
   members simply drop off the next file and the field is always blank.
   Confirm Delta does not require a final terminating record.
4. **Detail Division ID.** `00002`/`09002` (COBRA) are the established
   SMF divisions; the handbook only says divisions are Delta-assigned.
   Confirm the division set if the group structure ever changes.

## 9. Synthetic example (mirrored by `tests/edi/delta-edi.test.ts`)

Subscriber JANE Q DOE, SSN 001-23-4567, F, born 1980-01-15, covered since
2025-08, 123 MAIN ST, SACRAMENTO CA 95814-0000, (916) 555-1234,
jane.doe@example.com:

```
30 17975 00002 … 001234567␠␠␠␠␠␠␠ … 001234567 DOE… JANE… Q… F 19800115 … 10␠␠ … 20250801 ␠␠␠␠␠␠␠␠ 123 MAIN ST… SACRAMENTO… CA 958140000… 9165551234␠␠␠␠ … jane.doe@example.com…
```

Her spouse JOHN DOE (SSN 009-87-6543) repeats her `001234567` in Primary
Subscriber ID, carries his own SSN at 93–101, and classification `20`.
