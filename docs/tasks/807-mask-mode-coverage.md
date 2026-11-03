# Coverage ledger and later verification

Companion to the [approval audit](807-mask-mode-audit.md) and [exposure table](807-mask-mode-exposures.md).

## Coverage method and limits

The primary checklist is the actual `workerTabTree` in `shared/tabRegistry.ts`, cross-checked against `client/src/App.tsx` lazy imports/routes and worker page query/mutation paths, then against shared consumers and output transports. Search terms (`ssn`, `family`, `displayName`, `siriusId`, external ID aliases, `res.json/send/write`, CSV/PDF/Blob/print/download) were used to find bypasses, not as the definition of coverage.

**S** below = source traced through the common identity boundary and the named feature's client/server output family. It does not mean runtime verified or every arbitrary plugin column was classified. **D** = dynamic data/configuration cannot be exhausted statically; proposal is to deny until classified. **U** = no runtime verification. Each family maps to the corresponding exposure-table row.

### Worker-tab registry reconciliation

All rows below are **S/U**; rows with text/JSON/files/plugin outputs are also **D**. All use `WorkerLayout` → worker/contact raw APIs in addition to the named feature paths.

| Registry leaves / pages (relative to `/workers/{id}`) | Additional source/transport traced | Coverage / proposed boundary |
| --- | --- | --- |
| Details `/` | `worker-view.tsx`, `server/routes.ts` worker/contact/benefits/hours, worker IDs module | Structured mask plus contact/free-text withholding |
| Identity: `/name`, `/ids` | `NameManagement`, `IDsManagement`, worker PUT/contact GET, worker IDs module | Mask reads; block identity editing |
| Identity: `/birth-date`, `/gender`, `/work-status`, `/member-status` | Worker management components; `worker-work-status.tsx`, `worker-member-status.tsx`; worker PUT, WSH/MSH modules | Common name mask; safe dates/catalog; opaque data withheld |
| Identity: `/user`, `/dashboard` | `worker-user.tsx`, `worker-dashboard.tsx`; workers/users, dashboard-user and plugin host | User names masked; admin/editor and unknown plugin data blocked |
| Identity: `/skills`, `/certifications`, `/ratings`, `/bans` | Worker feature page/component files; workers/skills/certifications/ratings, worker-bans modules | Structured catalogs retained; opaque text/JSON blocked |
| Identity: `/aat` | `worker-aat.tsx`; workers/aat; AAT schema | Block credentials, copy/reveal/generate |
| Contact: `/email`, `/addresses`, `/phone-numbers`, `/relations` | Worker contact components; workers/relations page/module; `/api/contacts/*`, worker search | Related names mask; contact strings withheld; relation UUIDs retained |
| Comm: `/comm/history`, `/comm/send-sms`, `/comm/send-email`, `/comm/send-postal`, `/comm/send-inapp` | Worker wrappers, CommDetailContent, shared compose/senders, comm/comm-compose/comm-postal-preview modules | Block stored prose, recipient detail, sends and previews |
| Employment: `/employment/current`, `/employment/history`, `/employment/monthly`, `/employment/daily`, `/employment/tos` | Worker employment/hour/TOS pages; hours views and worker-tos modules | Common identity mask; free-text/opaque fields withheld |
| Benefits: `/benefits/summary`, `/current`, `/history`, `/eligibility`, `/scan`, `/exemptions` | Worker benefit pages; monthly-coverage-history; benefits scan and exemption/eligibility families | Mask typed identities; unclassified explanations/writes blocked |
| Elections: `/elections/current`, `/elections/list` | Workers election pages; trust-election APIs and enrollment wizard foundation | Mask structured references; block dependent/enrollment workflows |
| Union: `/union/cardchecks`, `/union/bargaining-unit`, `/union/steward` | Worker union pages; cardcheck/steward APIs, admin user lookup | Mask names/IDs; block signatures/documents and unreviewed editor |
| Dispatch: `/dispatch/status`, `/list`, `/do-not-call`, `/departments`, `/hold-for-employer`, `/eba`, `/asi`, `/sitespecific_t631_interviews` | Workers dispatch pages; dispatches, status/dnc/departments/hfe/eba/asi modules and T631 interviews | Mask nested identities; catalogs safe; free text withheld |
| `/political` | Worker political profile; BTU political APIs/SSE | Mask safe rosters; block address/vendor/bulk workflow |
| EDLS: `/edls`, `/edls/assignments` | Worker EDLS pages; edls/workers and sheets/assignments/snapshot-decode | Mask joined identities; raw snapshots blocked |
| `/sitespecific-freeman-2shift` | Worker Freeman page; freeman/second-shift module and configured ID lookups | Mask shadow/source identity; keep internal joins |
| `/sitespecific/bao/beneficiaries` | Worker beneficiary form, beneficiary schema/module | Block (ambiguous full name + whole-list write) |
| `/sitespecific/bao/cobra`, `/sitespecific/bao/dp`, `/sitespecific/bao/disability-credit` | Worker BAO pages, COBRA/DP/DC summaries/queues/cases/intake/documents | Mask approved typed summaries; block opaque medical/case text and documents |
| Accounting: `/ledger/accounts`, `/ledger/payment-methods`, `/ledger/sitespecific/bao/echp` | Worker ledger/payment/ECHP pages; ledger EA, payment methods, pay accounts and ECHP module | Mask safe summaries; block credential/payment actions/memos |
| `/vdb-pension` | worker-vdb-pension; GBHET pension SLA/compute/payout summary APIs | Safe figures retained; unknown report fields/actions blocked |
| `/grievances` | worker-grievances; grievance query/detail/participants; grievance schema and quicksearch | Mask participants; block free-form titles/narrative |
| `/notes` | EntityNotesPanel; entity-notes module/storage/context registry | Block content; counts only if separately projected |
| `/files` | EntityFileManager; entity-files contexts, files module | Block metadata/content/URLs |
| `/cases` | BAO CaseListPanel; BAO cases, case note/file contexts | Block unstructured case records/documents |
| `/logs` | ActivityLogView; logs/by-entity, system/logs, storage logging middleware | Block content/viewer |
| `/delete` | Worker delete page; worker DELETE handler/results | Block destructive training operation/identity-bearing confirmation data |

Other worker routes/actions found outside registry leaves: `/workers/add`, worker hours view/edit/delete, certification detail, worker ledger payment, check-in QR, list filters/exports, worker reports and enrollment wizards. These are covered in the exposure table; they are not silently excluded because no worker tab points at them.

### Cross-feature and plugin checklist

| Boundary | Sources inspected / discovery anchor | Remaining closure before implementation release |
| --- | --- | --- |
| Server and client registration | `server/routes.ts`; `server/app-init.ts`; `client/src/App.tsx`; shared tab registry | Register every endpoint's output contract including literal and generic routes; do not infer registration from filename alone |
| Quicksearch | `server/plugins/quicksearch/index.ts`, worker plugin, runner contract; shared quicksearch; QuickSearch UI | Classify every enabled plugin's title/subtitle/badges/labels/href/query echo or deny it; production config not inspected |
| Wizards (both plugin and legacy) | `server/plugins/wizards/dispatcher.ts`; plugins directory inventory; enrollment foundation; report/import plugins | Both registry paths and raw wizard GET/state need protection; blanket deny unreviewed wizard payloads/exports/actions |
| Token Studio and communication host seeds | `server/modules/token-studio.ts`; worker/contact token plugins; comm-compose; template preview contracts | Real-record labels/seed routes and HTML literals are unsafe independently of token leaf masking; samples must be vetted |
| Dashboard and client injection | `server/app-init.ts` dashboard/client-injection initialization; worker dashboard host; shared component registry | Runtime enabled plugins/injected scripts not inspected; deny unknown response contracts and do not claim custom JS safe |
| Optional site modules | BAO beneficiaries/COBRA/DP/DC/cases/premium/echp; T631 interviews/sync; Freeman second shift; BTU political/cardcheck imports; GBHET pension | Source presence verified, live activation/config/record shapes not verified; configured employee types here do not prove other deployments' type membership |
| Related non-worker pages | Employer worker rosters/contacts, user/masquerade, dispatch jobs/EDLS sheets, grievances, ledger accounts and bulk recipients | Apply semantic worker/contact/user projections regardless of route prefix; block unreviewed free text |
| Notes/files/provenance/log frameworks | Entity-context registries; entity files plus optional DC adapter paths; entity metadata and logging middleware | All registered contexts/aliases must share refusal policy, including direct file reads |
| Exports and printing | Server worker CSV, contact CSV-in-JSON, WMB/premium, wizard custom/EDI; client Blob/PDF builders; invoice/letter renderers | Each MIME/filename/header/redirect/stream needs explicit admission before generation; no live outputs generated here |
| Websocket and SSE | `/ws` union and send sites; BTU political SSE `res.write` | Count-only websocket can remain; SID/actor rebinding required; SSE errors arbitrary, block workflow |
| Public/no-session transports | Public files, signed URLs, external documents, EDLS/AAT and e-sign bearer routes | Session masking does not control copied/no-cookie links; approve limitations or separate link-access redesign |
| Browser caches/defaults | QueryClient, worker/editor state, auth contexts, titles, selected labels and PDF Blob URLs | Authenticated browser/network/DOM/copy/paste checks were **not** done; see matrix |

### Metadata and evidence status

- Development `options_worker_id_type` metadata successfully read; eight types recorded in main audit. No sensitive values read. No live deployment metadata or role assignment query was attempted.
- Permission registry inspected: no dedicated presenter/trainer permission found in the inspected core list; optional roles are DB-configured, not inferred from labels.
- No source evidence found for a single existing formatter or middleware covering outbound worker names, SSNs and IDs across these transports.
- Current websocket payload union is count-only; SSE and HTTP content have separate disclosure concerns.
- Negative findings are scoped to inspected source. Unknown JSON/configuration/binary contents are not “no exposure”; their proposed state is blocked.

## Implementation approval scope

One approved implementation should include the helpers, safe read DTO contracts/egress gate, unsafe-route admission refusals, atomic session policy transitions, permission and masquerade semantics, cache/revision isolation, global banner/toggle, built-in help and the verification below **together**. A piecemeal UI-only release must not be labeled safe for live recording.

Do not implement any of that as part of this audit. No claims are made here about a working toggle or which values “were masked.”

## Later verification matrix (not performed in this audit)

Use fictional fixtures in memory for helper/contract tests; no new live worker records, sends or live exports are necessary. Use preauthorized sessions and metadata-only observations for the live recording readiness check, with sensitive artifacts kept out of the report. Any network traces/screenshots containing real values must not be saved in task docs.

| Area | ON / unknown expected result | OFF / isolation expected result | Verification |
| --- | --- | --- | --- |
| SSN helper | Dashed/undashed valid values → bullets + last4; empty/null → empty; malformed/short values fully withheld | Explicit OFF returns original contract unchanged | Cheap pure helper cases, no DB |
| Display ID helper | Long string/numeric display ID → last4; <=4 entirely hidden; Unicode/whitespace rules explicit; AAT/unknown fully withheld | Original type/value unchanged in OFF DTO | Pure contract cases including leading zeros; no numeric conversion of ID strings |
| Name helper | Hyphenated/multi-word family fully replaced; suffix omitted; family-only, given-only and unstructured single-word policies as main audit | Original parts and displayName unchanged | Pure cases; no last-space parser; fallback must not leak |
| Worker overview/IDs/name and all registry families | No original surname/full SSN/full masked ID in response, nested JSON, DOM, attributes, selected text, clipboard or form defaults | Existing page/result behavior unchanged | Authenticated browser + network + DOM/accessible tree + copy/paste; source inspection alone insufficient |
| Lists/search/relations/quicksearch | Mask nested/result labels, badges and subtitles; no unsafe query echo, arbitrary plugin data or raw cache values | Existing permissions/search remain; separate user/session unchanged | Fixtures for structured projections; authorized browser, direct API methods, exact/prefix/error cases |
| Titles/bookmarks/header/masquerade/QR | Mask surname aliases; UUID routing works; QR classification correct; no raw aria/title/copy values | No unexpected path or user identity changes | Browser page-title/DOM/link/copy inspection; verify target and original presenter identities separately |
| Unsafe notes/log/history/docs/exports/comms | Server refuses direct and indirect routes before payload bytes/side effects; filename/location/response body contains no person values | Existing access gates and stored truth remain | Route/transport fixtures plus approved authenticated refusal checks; **do not** send real comms or generate live outputs |
| Forms and mutation responses | No masked sentinel or suffix can overwrite SSN/family/ID/list; direct protected writes refused; late request refused by revision | Real data validation and ordinary edits unchanged | In-memory handler/storage doubles; inspect browser defaults and no-submit behavior |
| Unknown/error state | Missing/malformed policy, DB failure, permission failure, stale revision: safe structured projection or neutral refusal, never raw | Only successfully loaded explicit OFF is raw | Failure injection fixtures including 4xx/5xx and session-save failure |
| Toggle concurrency | ON-ready only after persisted revision and response barrier; old requests cannot refill raw state; failed transition stays unready | Toggle OFF acknowledged separately, no shared cached masked data | Controlled delayed-request/revision fixtures; concurrent session-save/credential-refresh/masquerade tests |
| Cross-tab/BFCache | Active tabs receive state change; resumed tab reboots protected; warn close old tabs; no absolute recall claim | Another browser session/user unaffected | Multi-tab authenticated browser, focus/restore/BFCache, logout/expiry/relogin; use synthetic responses for races |
| Session persistence/processes | State survives restart until session expiry; ordinary session set cannot undo toggle; process-independent coordination | Independent SID behavior and explicit OFF maintained | Session-store concurrency fixtures; controlled non-live multi-instance check if architecture requires it |
| Masquerade lifecycle | ON remains ON start/stop; target's data permissions retained; presenter-only toggle exception narrowly enforced; socket reconnects | No preference written to target user's other sessions | Separate presenter/target/same-user-other-session cases, revoked toggle permission and stale socket cases |
| Non-JSON/websocket/SSE | Count-only messages safe; unsafe SSE refused; no file/redirect/signed URL generation while protected | Machine integrations/background delivery truthful and unaffected | Transport-level fixtures; no external vendor invocation; per-SID tests if identity ever enters sockets |
| Public/prior-content gaps | Warn and refuse in app where enforceable; do not falsely claim copied URLs/history/downloads revoked | No incidental changes to external access protocols | Source + approved non-sensitive link fixture; explicitly record remaining gap |
| Production readiness | Actual live ID-type metadata classified, components/plugins inventoried; unknown contracts blocked | No environment/config mutations during audit | Authorized metadata-only read and approved source/runtime inventory before training use |

### In-app help that must accompany implementation

Follow `.agents/skills/in-app-help-authoring/SKILL.md`. Add a focused code-owned built-in system entry through `server/help/system/index.ts`; do not seed or overwrite admin-authored help.

The final host/path for the toggle is an implementation decision, so no fictitious help ID or existing page is asserted here. Proposed stable ID: `system:mask-mode`, scoped to the actual control/help page and specific worker/list pages needing contextual warnings. The always-visible banner should link to its guidance rather than relying on a broad `%` pattern to explain global behavior.

Guidance must cover: who can toggle; session/tab behavior; what is masked/retained/blocked; blocked form/export/send/document behavior; waiting/error states; masquerade; why fresh recording sessions are required; first-name/other PHI/public-link/history limitations; turning OFF deliberately; how to recover from unknown state without bypassing protection.

Verification in the implementation task:

1. Confirm shipped labels, permission, defaults and blocked actions match the help.
2. Check built-in registration/unique ID, intended paths and near misses with the existing matcher.
3. Confirm the HTML survives the existing rich-document sanitizer.
4. Restart once after the server/help changes; invalidate help cache.
5. In an authorized session, find System/Built-in help at `/config/helps`, check summary/details, then intended inline help/dialog and an unrelated page.
6. Record actual browser/network/copy checks and any inaccessible states honestly.

**No help update is appropriate in this audit:** the feature and its controls do not exist yet. Publishing usage instructions now would misdescribe the application.
