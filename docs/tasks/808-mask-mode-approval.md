# Mask Mode implementation approval and prerequisites

## Final implementation decision

The user explicitly chose **Strict live-data de-identification** after the HHS
research. This supersedes the earlier convenience policy below: no real first
names, initials, SSN fragments or ID fragments are offered. The existing **admin
permission** is the approved admin-only toggle alternative; no new permission
grants are silently added. During masquerade only that original presenter's
active admin authority controls the toggle; fresh effective-staff authority
controls the training sample.

The implemented boundary is a **standalone, read-only training view**, not
inline masking across the original application. All original application
routes, unknown outputs and side-effect handlers are refused while ON or
unknown, before they run. Only a small positive DTO of reviewed facts is
available. See [`808-mask-mode-implementation.md`](808-mask-mode-implementation.md)
for the exact contract, tests, usage and remaining organizational release gates.

The supplied identifier metadata resolves handling conservatively: **all eight
types are withheld in full**, including legacy AAT (treated as potentially
bearer-sensitive), External ID, Union ID, Legacy NID and employer employee IDs.
Neither editable labels nor absent validators can authorize raw values.

The user supplied stored component overrides and plugin counts, but not the
effective runtime component response or deployed source revision. That inventory
is **not represented as complete**. The earlier inline-surface inventory
prerequisite is replaced by default refusal of every optional/component/plugin
surface; none is admitted based on those incomplete results. This narrower
boundary is independent of their enablement.

## Explicit approval

**Subsequent scope change:** The user requested research into HIPAA requirements
and a build based on those rules. See
[`808-mask-mode-hipaa-research.md`](808-mask-mode-hipaa-research.md).
The earlier approval below is not approval to describe first-name/last-four
masking as HIPAA de-identification. The research distinguishes de-identified
output from restricted training that remains PHI; the intended outcome must be
resolved before implementing a materially different policy.

The user approved the proposed safeguards and limitations in the companion
audit, exposure table and coverage plan. In response to “Which roles may
toggle Mask Mode?”, the user specified **admin**.

This records approval to proceed once the required prerequisites are resolved;
it does not report a shipped feature or successful verification.

## Earlier convenience boundary (superseded by the final decision above)

- Preserve structured first names. Replace complete surnames with `••••`,
  omit suffixes/titles/credentials, rebuild display aliases from verified
  parts, and withhold unstructured names.
- Mask valid full SSNs to the permitted last-four fragment. Mask approved
  worker display IDs and Sirius numbers; fully withhold short/malformed
  values, legacy AAT and unclassified identifier types.
- Preserve internal routing/join UUIDs and storage, audit and vendor truth.
- Use the dedicated `privacy.mask-mode` toggle permission with **admin-only**
  access; do not grant it to all staff. The original presenter's authority
  controls only that session's presentation toggle during masquerade.
  Ordinary data authorization continues to use the effective user.
- Keep protection session-local, authoritative on the server and fail-closed.
  A legacy session without explicit state requires protected recovery or
  fresh login. Revocation or a permission failure cannot switch protection off.
- Refuse unsafe content and workflows before effects: unreviewed free text
  and opaque outputs, notes/log/communication bodies, documents and previews,
  exports, bearer credentials, sends, payment operations and identity editing.
  Contact/user surname summaries are included; name-bearing contact strings
  are withheld.
- Deliver atomic state, process-independent transitions, response contracts,
  admission and egress enforcement, cache/revision handling, banner/toggle,
  form refusals and built-in help as one coherent implementation.
- Complete helper, contract, failure/concurrency and authorized browser,
  network, DOM and copy verification in this task. No live sends, charges,
  exports or test-record creation are authorized for verification.

## Accepted limitations

This is not comprehensive PHI de-identification. First names, retained UUIDs,
relationships and other structured facts may identify a person. The feature
does not erase old browser/network/clipboard/download content or guarantee
that sleeping tabs clear their old pixels. Use one fresh active recording tab
and close previous tabs. Previously issued, copied, public or no-cookie
bearer/document links remain outside session control. Do not visit them during
recording.

## Prerequisite evidence still needed

The live training deployment's metadata and effective runtime inventory must be
established:

- Identifier type membership, stable aliases, validators and list visibility;
  no `worker_ids.value`, SSNs or person names.
- Enabled optional components and plugin IDs/kinds, including whether custom
  client injection is enabled; no configuration bodies, templates, arbitrary
  labels or credential values.
- A preauthorized route for the required later authenticated browser checks,
  without creating a live test account/record or requesting credentials in chat.

The user subsequently supplied identifier metadata, component override inventory
and plugin enablement counts. Eight identifier types were reported. Two enabled
client-injection types are Weglot SDK/init; unknown/third-party output cannot
be treated as safe merely because it is configured. The effective component
API result, environment/revision and authorized runtime verification have not
been supplied. Receipt of the SQL results resolves the missing SQL inventory
input, not all runtime evidence.

The deployment lookup in this workspace returned `isDeployed: false` with no
production URL. This does not prove that the external live S2 deployment is
absent. The existing source-config connection is documented as a legacy
configuration-copy source; its existence does not establish that it points to
the live training database. No connection value was accessed or displayed, and
no query was run against that unconfirmed source.

Development inventory in the audit is not live evidence. Do not bypass this
prerequisite or describe the live inventory as complete.

The user chose to provide metadata results rather than authorize use of the
unconfirmed source-config connection. The read-only SQL package is
[`808-mask-mode-metadata.sql`](808-mask-mode-metadata.sql). It reads identifier
type metadata, component override status and plugin enablement counts, not
worker records or configuration bodies. Review editable identifier metadata
for unexpected personal text before sharing it.

Stored component overrides are not the effective runtime inventory: defaults
come from the deployed registry. Also supply the `componentId`/`enabled` list
from **GET `/api/components/config`** in an already authorized live session.
Do not supply cookies, authorization headers, other network requests or a full
network trace. State the live environment label and deployed source revision if
known, so the inventory can be matched to the deployed code. Report unavailable
results or SQL errors explicitly; missing evidence is not an empty inventory.

## Legacy AAT evidence

`docs/s1-migration/06-strategy-revision.md`, section 4.9, describes
`field_sirius_aat` as a variable-length external identifier. This distinguishes
its migration meaning from a quantity, but does not establish that a last-four
fragment is safe or that no external system uses it as a credential.
The approved **full-withholding** decision therefore remains unchanged.

## Current implementation status

Application behavior is unchanged. No Mask Mode code, configuration, role grant
or help entry has shipped. No live sends, charges, exports, test records,
database mutations or app restarts were performed in recording this approval.
The task remains incomplete pending the required inventory and full
implementation/verification.
