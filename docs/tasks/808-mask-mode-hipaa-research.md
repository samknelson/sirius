# Mask Mode: HIPAA research and revised implementation requirements

**Outcome:** The user selected strict live-data de-identification. The implemented
technical boundary and verification are recorded in
[`808-mask-mode-implementation.md`](808-mask-mode-implementation.md).
This research is not a certification, Expert Determination or organizational
approval to record or publish.

Research date: 2026-11-03.

**Status:** Research and implementation requirements, not a compliance
certification, legal opinion, shipped feature or approval to record live PHI.
The request for HIPAA-informed protection supersedes treating the earlier
surname/last-four policy as a sufficient recording standard. The implementation
must not silently preserve that policy and describe it as de-identification.

## 1. Main finding

There is no masking function that makes an organization, application or recording
workflow “fully HIPAA compliant.” HIPAA duties depend on the regulated entity,
data, permitted use, recipients, agreements and safeguards. Technical and
non-technical evaluation is required; HHS does not endorse private Security Rule
certifications or treat them as eliminating legal obligations. [S3, S5]

Two distinct outcomes must not be conflated:

1. **Training that continues to use PHI.** A permitted health care operations
   purpose may support workforce training, subject to the applicable use/
   disclosure rules, role-based access, minimum necessary and safeguards.
   Neither being an administrator nor enabling Mask Mode establishes those
   conditions. The recording and its copies remain PHI. [S2, S3, S6]
2. **Training output that is de-identified.** HIPAA recognizes Safe Harbor and
   Expert Determination. Output must actually satisfy the selected method;
   a banner, a disclaimer or partial masking is not a substitute. [S1]

Fully fictional training data, created without copying real person records or
their identifying histories, is a separate engineering option that avoids
placing live PHI in the recording workflow. A superficially renamed live copy
is not equivalent to fictional data.

## 2. Safe Harbor changes the original design

Under 45 CFR 164.514(b)(2), remove the listed identifiers of the individual and
of relatives, employers or household members. The covered entity must also lack
actual knowledge that the remaining information can identify the individual,
alone or with other information. These are conditions on the output, not just
on which database columns were changed. [S1]

| Identifier category | Required consequence for the training design |
| --- | --- |
| Names | Do not retain real first names, surnames or initials of the subject or covered related people. Use neutral labels or independently generated fictional aliases. |
| Geography below state | Withhold street/city/county/precinct and equivalent geocodes. The three-digit ZIP exception has Census population conditions; do not implement it without the required current evidence. Withholding geography is simpler. |
| Dates directly related to a person | Remove elements more specific than year. Review birth, death, service, enrollment, coverage, payment and other dates for their relationship to the individual; do not assume a coverage month is exempt. |
| Ages over 89 and date elements implying them | Aggregate to `90 or older`, and withhold/generalize birth years and other elements that would reveal the older age. |
| Telephone numbers | Withhold. |
| Fax numbers | Withhold. |
| Email addresses | Withhold, not merely the name portion. |
| Social Security numbers | Withhold completely, including last four. |
| Medical record numbers | Withhold completely. |
| Health plan beneficiary numbers | Withhold completely. |
| Account numbers | Withhold completely, including person-associated ledger/payment account numbers. |
| Certificate/license numbers | Withhold. |
| Vehicle identifiers/serials, including plates | Withhold. |
| Device identifiers/serials | Withhold where associated with the person. |
| URLs | Remove person-associated URLs and links that identify or give access to the subject; generic application/help URLs are not automatically patient identifiers. |
| IP addresses | Remove person-associated IP addresses. Do not confuse these with all generic infrastructure addresses. |
| Biometrics, including finger/voice prints | Withhold biometric identifiers and sensitive signature/biometric media; review the entire recorded media, not only JSON. |
| Full-face photographs and comparable images | Block person images, avatars, signatures and document previews unless the content has been separately established safe. |
| Other unique identifying number, characteristic or code | Withhold worker Sirius numbers, external/legacy identifiers, source keys, identifying case details and ordinary person-linked record identifiers unless a reviewed exception applies. |

HHS explicitly states that patient initials and **last four SSN digits fail
Safe Harbor**. Do not treat derivatives, truncation, deterministic hashing or
date shifting as a blanket Safe Harbor workaround. Dates shifted to fictional
calendar dates are not thereby covered by Safe Harbor. [S1, FAQ 3.2–3.5]

The original design's retention of actual first names, last-four identifiers,
fine-grained dates and ordinary routing UUIDs therefore cannot be reused
unchanged for a Safe Harbor-oriented training output.

### Re-identification codes and navigation

Section 164.514(c) permits a qualifying re-identification code under specific
derivation and security conditions. It does not exempt every UUID or encrypted/
hashed identifier. A live application's ordinary worker UUID is already used for
normal identification and navigation; do not assume that it qualifies. [S1]

A conservative training surface would use random training-only references,
resolve them solely inside the authorized server boundary, and withhold the live
IDs and mapping from browser payloads, URLs and artifacts. The covered entity
must evaluate the code scheme and uses against section 164.514(c); random aliases
alone are not an expert determination or proof of Safe Harbor.

### Context, free text and audio

Safe Harbor is not satisfied merely by deleting the enumerated fields if the
organization actually knows the remaining context identifies someone. Rare
occupations, distinctive benefit/case histories, small groups and recognizable
family relationships require review or suppression. [S1, FAQ 3.6]

For an initial conservative implementation, refuse arbitrary notes, case prose,
logs, messages, template literals, documents, images and unclassified strings.
Regex scrubbing and OCR do not establish that an arbitrary body is de-identified.
The output boundary includes subtitles, filenames, attributes, QR codes, URLs,
errors and hidden browser state, not just visible table cells.

A presenter can speak a real name or identifying story into an otherwise safe
recording. Screen code cannot prevent this. Captions, transcripts, AI summaries,
thumbnails and recording metadata must be included in the recording workflow's
review and handling rules.

## 3. Expert Determination is a different route

Under 45 CFR 164.514(b)(1), a person with appropriate statistical/scientific
knowledge and experience must determine that identification risk is very small
for the anticipated recipients, considering other reasonably available
information, and document the methods and results. [S1]

This can support a tailored release that preserves utility differently from
Safe Harbor. It is not a determination the application can self-issue based on
passing tests. Do not promise that retaining particular names, dates or fragments
will be accepted. A qualified expert must assess the actual release, audience,
linkability and conditions, including successive recordings.

A limited data set is also not interchangeable with de-identified information:
it remains PHI and has purpose/agreement restrictions. [S6]

## 4. If training recordings remain PHI

The covered entity/privacy lead must establish the permitted purpose and audience.
Internal staff education is not blanket permission to publish videos or disclose
them to unrelated organizations. Group-health-plan and employer/plan-sponsor
boundaries also require review; “worker data” is not a legal classification that
automatically excludes benefit data from HIPAA. [S2, S6, S7]

The complete data flow must include the live backend, browser, recording device,
meeting/recording application, editing tool, cloud drive/LMS, backups, downloads,
transcription/AI services and eventual viewers.

Before use, establish and verify:

- Role-appropriate authorized access, minimum-necessary content and viewer scope.
- Applicable BAAs and permitted subcontractor processing wherever services
  create, receive, maintain or transmit ePHI on behalf of a regulated entity.
  A BAA alone is not sufficient: the entity must also satisfy the HIPAA Rules.
- Risk analysis and risk management across the full data flow.
- Access controls, authentication, audit controls, integrity and transmission
  safeguards; device/workstation/media handling and contingency arrangements.
- Reasonable technical safeguards such as MFA, encryption in transit/at rest,
  least privilege and session timeout, with documented applicability and
  configuration rather than assertions from source code.
- Recording approval, distribution restrictions, access review, incident response
  and breach assessment/notification procedures.
- A documented recording retention/deletion policy covering copies and backups.
  Do not invent a universal “HIPAA requires six years of training videos” rule:
  Security Rule documentation has a six-year rule; this is not a blanket video
  retention mandate. Other applicable requirements must be assessed.
- Workforce training, responsible owners, policy enforcement and periodic
  technical/non-technical evaluation.

These obligations cannot be fulfilled by this feature alone. [S2–S6]

Do not infer that hosting, translation, analytics, support, AI or recording
services are approved for PHI. No relevant Replit HIPAA/BAA documentation was
returned by the official documentation search; that is **not evidence either
that a BAA is available or that one is unavailable**. Obtain contractual evidence
for the actual services and deployment in scope. No vendor agreement or hosting
configuration was verified in this research.

The server that transforms live PHI still processes PHI even if its final browser
output is de-identified. Protecting the output does not exempt that backend or
its processors from applicable obligations. [S1, S4]

## 5. Current rules versus proposed changes

The HHS Security Rule summary fetched for this research expressly describes the
rule currently in effect and links separately to the cybersecurity NPRM.
HHS's NPRM page and fact sheet state that the current Security Rule remains in
effect during rulemaking. Do not describe the NPRM's proposed universal MFA/
encryption requirements or proposed deadlines as already-effective mandates.
They can inform engineering recommendations without mislabeling their status.
Recheck applicable rules and effective dates before release. Under the current
rule, “addressable” does not mean optional; applicable assessments and reasons/
alternatives must be documented. [S3, S8]

## 6. Applying the findings to this project

User-supplied live metadata reports eight identifier types: AAT, External ID,
Union ID, Legacy NID and four employer employee-ID types. Legacy NID is configured
for list display; other list flags are not configured. Under a strict
de-identification target, **all eight values are withheld**, not shown as last
four. This includes legacy AAT regardless of its final credential classification.
S2 access tokens and public links remain completely blocked.

The supplied component overrides enable BAO, benefits/elections, ledger/payments,
bulk, debug, worker relations, EDI and other components. Plugin inventory includes
worker quicksearch, person-bearing dashboards and two enabled Weglot injection
plugins. A stored enabled plugin row is not proof that its component makes it
reachable; similarly, a disabled component is not a substitute for endpoint
admission and output protection.

For protected training, deny third-party injection before scripts execute,
including Weglot, and enforce an appropriately restrictive resource policy.
A late toggle cannot recall text already sent to a third party or undo previously
executed code. Enter through a fresh protected document/session boundary rather
than claiming a client-side checkbox retroactively secures a live page.

The live metadata came from the user, not an independently authenticated
observation. The effective runtime `/api/components/config` answer, deployed
source revision and authorized runtime verification remain outstanding.

### Build choices

| Approach | What it provides | Tradeoff / required evidence |
| --- | --- | --- |
| Fully fictional training data | Same-product isolated training experience with no real person records or histories; recommended for broadly shareable demonstrations | Not a live-data mask. Requires a separately isolated source and side-effect boundary; no production test-record creation. |
| Strict live-data training projection | Explicitly allowlisted server output, no real names or ID fragments, generalized dates/ages, training-only navigation references; unknown content refused | Considerably more restrictive than the original mode; may prevent teaching month-by-month workflows. No release-as-de-identified claim until the covered entity evaluates the output and method. Expert review where needed. |
| Restricted PHI training | Original partial masking can be a risk-reduction measure within a permitted, safeguarded workflow | Recordings remain PHI. Requires the organization to establish purpose, audience, vendor agreements and operational controls. Not suitable for unrestricted sharing by default. |

Do not build three modes without a requirement. Select the intended outcome
first; the original request for live-data use cannot be silently replaced with
synthetic data.

### Common technical requirements for the selected implementation

1. Preserve existing authorization and storage/audit/vendor truth. Admin-only
   toggle authority is not authority to view otherwise inaccessible records.
2. Use semantic, allowlisted DTOs at final server output, outside shared raw
   caches; do not recursively guess by field names or alter stored records.
3. Fail closed at admission and egress for every transport, including redirects,
   streams, files, errors, credential issuances, plugin results and nested data.
4. Block unsafe writes and side effects before they execute. No masked values
   hydrate editable identity fields. Background truth is not rewritten.
5. Maintain atomic SID-local state, cross-process response/transition coordination
   and presentation revisions. Clear/remount client state and reject late/stale
   responses; protect bootstrap, all layouts, resumed tabs and BFCache restores.
6. Require a fresh safe recording context; explicitly disclose old browser,
   clipboard, prior script execution, public-link and operating-system limits.
7. Ship the banner/toggle and accurate built-in help with the implementation.
   Do not use a “HIPAA compliant” badge or “safe to publish” readiness message.
8. Complete synthetic helper/DTO, transport, failure/concurrency and authorized
   browser/network/DOM/copy tests within this task. No live sends, charges,
   exports or creation of production test records for verification.
9. Define measurable release criteria and record which are technical test
   results versus organizational/legal attestations. Do not call the task
   complete while required verification or release conditions are unresolved.

## 7. Sources

Primary HHS pages were searched and fetched, not inferred from search snippets.

- **S1:** [HHS de-identification guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html).
  Includes 45 CFR 164.514(b)–(c), both methods, all identifier categories,
  derivatives, dates, actual knowledge and free-text discussion.
- **S2:** [HHS treatment, payment and health care operations guidance](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/disclosures-treatment-payment-health-care-operations/index.html).
  Includes training and minimum-necessary/role-based policies.
- **S3:** [HHS summary of the current Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html).
  Administrative, physical and technical safeguards, required/addressable
  specifications, contracts, evaluation and documentation.
- **S4:** [HHS cloud service/ePHI FAQ](https://www.hhs.gov/hipaa/for-professionals/faq/2075/may-a-hipaa-covered-entity-or-business-associate-use-cloud-service-to-store-or-process-ephi/index.html).
  BAAs, risk analysis and responsibilities.
- **S5:** [HHS Security Rule certification FAQ](https://www.hhs.gov/hipaa/for-professionals/faq/2003/are-we-required-to-certify-our-organizations-compliance-with-the-standards/index.html).
- **S6:** [HHS summary of the Privacy Rule](https://www.hhs.gov/hipaa/for-professionals/privacy/laws-regulations/index.html).
  PHI scope, minimum necessary, limited data sets and permitted uses.
- **S7:** [HHS employer/group health plan FAQ](https://www.hhs.gov/hipaa/for-professionals/faq/am-i-a-covered-entity-under-hipaa/index.html).
  Confirms the employer/plan distinction and plan-sponsor disclosure conditions;
  no organization-specific legal classification has been made.
- **S8:** [HHS Security Rule NPRM](https://www.hhs.gov/hipaa/for-professionals/security/hipaa-security-rule-nprm/index.html)
  and [fact sheet](https://www.hhs.gov/hipaa/for-professionals/security/hipaa-security-rule-nprm/factsheet/index.html).

The covered entity's privacy/security officers and counsel should confirm
applicability, permitted use, the chosen de-identification method and any
additional state or specialized confidentiality requirements before use.
