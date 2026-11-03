# Mask Mode: approval audit

**Status: proposed safeguards and limitations explicitly approved by the user; admin-only toggle. Implementation prerequisites and live inventory remain open.**

The original read-only audit below is preserved as evidence, not a claim of
implementation. See [implementation approval and prerequisites](808-mask-mode-approval.md)
for the subsequent approval, including full withholding of legacy AAT.

Audit date: 2026-11-03. Scope: Step 1 of the supplied Mask Mode specification, not Steps 2–3. This is not a claim of PHI de-identification or a security certification.

## Read first

The application currently sends full worker identity values to the browser. Changing visible formatting alone would not meet the specification. A workable first version needs **structured server-side projections plus server-side refusals for unsafe surfaces**, not just three formatting functions.

Recommended approval package:

1. Preserve first names; replace structured surnames consistently with `••••` (fictional example: `Maria ••••`).
2. Show valid full SSNs as `•••-••-1234`; show approved external display IDs and worker Sirius numbers as `••••1234`. Empty stays empty. Short or malformed values must not be exposed in full.
3. Keep internal navigation/join UUIDs unchanged. Do not confuse these with bearer credentials, even when both use UUID syntax.
4. Block stored free text, historical communications/log payloads, real-record template previews, documents/downloads, bearer-token pages, live exports and identity editing while Mask Mode is on. Structured read-only views can remain available only after their response contracts are covered.
5. Add a dedicated permission, session-local server authority, a global banner, and a transition barrier that clears old client data before claiming the mode is ready.
6. Explicitly accept the remaining recording limitations below, or use an isolated non-live training environment instead.

**Companion documents**

- [Exposure table and evidence](807-mask-mode-exposures.md): UI/action → transport → fields → formatter/bypass → treatment.
- [Coverage checklist and verification plan](807-mask-mode-coverage.md): all worker tab families, extension boundaries, runtime limits and later acceptance checks.

## What was actually done

- Read the supplied specification at `attached_assets/Pasted--Task-Add-Mask-Mode-to-S2-so-training-recordings-don-t-_1793670697544.txt`, the task plan, project instructions, and in-app-help authoring instructions.
- Inspected the current `main` source: React 18/TypeScript/Vite/Wouter/TanStack Query; Express/TypeScript; Drizzle/PostgreSQL; persisted Express sessions. Evidence: `package.json:6–24,70–76,102–108,130–149`; `server/auth/index.ts:70–108`; `shared/schema.ts:196–205`.
- Traced the worker tab tree (`shared/tabRegistry.ts`, `workerTabTree`), `client/src/App.tsx` imports/routes, `server/routes.ts` registrations, and quicksearch, wizard and token registration/output boundaries. Inspected optional BAO, BTU, T631, Freeman and GBHET source paths whether or not enabled here.
- Performed a **development-only configuration SELECT**, projecting identifier-type labels, stable configuration aliases, validator metadata, and the `showOnLists` flag. No `worker_ids.value`, SSNs, person names, session rows, credentials, document contents or live exports were selected.
- The first metadata SELECT referred to a nonexistent description column and failed without mutation. The corrected SELECT matched the declared schema and returned the eight types below. This is not a production configuration inventory.
- Changed only task documentation and project memory. An existing modification to `artifacts/mockup-sandbox/src/.generated/mockup-components.ts` was present before this work and is unrelated.

No Mask Mode code/help/permissions/configuration was added; no application records or test records were created/changed; no sends, vendor operations, live export/download or document generation was invoked. No application startup/restart was needed for this documentation-only task (boot itself has migrations, reconciliation writes and cron initialization). No authenticated UI, network/copy-paste walk-through, deployment inspection, public bearer-link request, or attachment-content inspection was performed.

The tables are a source-backed inventory of the discovered exposure families, not proof that every dynamically configured value or every rendered state is safe. Optional components, injected client code, custom templates, arbitrary JSON and previously issued public links remain explicit closure requirements.

Documentation verification: companion links and newly added memory-topic links resolve; `git diff --check` passed. A public, unauthenticated app-preview screenshot was attempted but the preview server refused the connection. The app was not started just for this audit, because startup can perform writes; no runtime screen verification is claimed. A broader memory-index link check also found a pre-existing missing `env-var-registry.md` target, outside this audit; it was not silently repaired.

## Identifier policy: exact proposed boundary

“ID” is not a sufficient classification. Classify by the entity/field's meaning and output contract, not its spelling.

| Discovered field / aliases | Source contract | Proposed ON behavior and reason |
| --- | --- | --- |
| `workers.ssn`; API `worker.ssn`; token `ssn`; export `SSN` | `shared/schema.ts:332–341`; `shared/utils/ssn.ts:22–64`; `server/plugins/tokens/plugins/worker.ts`; worker export `buildExportRow` | **Mask** full valid nine-digit or dashed SSN to `•••-••-last4`. Null/empty → empty. Do not use `parseSSN`'s zero-padding to invent an apparently valid source value. Unexpected lengths/content → fully withheld, not the formatter's existing raw fallback. |
| Dependent `ssnLast4`; duplicate/matching candidate `ssnLast4`; adjustment metadata `ssnLast4` | `server/plugins/wizards/enrollment/foundation.ts:298,581`; `server/storage/workers.ts:1389–1446`; `server/plugins/ledger/charge/plugins/sitespecific-bao-hourly.ts:213–268` | **Retain last four only**, with the approved SSN prefix if displayed; it is already the permitted fragment, not permission to recover the rest. Block surrounding arbitrary wizard/log/memo payloads. |
| BAO beneficiary `beneficiaries[].ssn` and unstructured `name` | `shared/schema/sitespecific/bao/schema.ts:475–479`; `server/modules/sitespecific/bao/beneficiaries.ts:25–48` | **Block beneficiary payload/editor initially**: SSN itself can be masked, but the full-name string has no reliable first/family split, and the form posts the whole list. Do not claim that masking only its SSN makes the panel safe. |
| `workers.siriusId`, `sirius_id`, `workerSiriusId`, `worker_id` in external Passport output, `#number`, “Worker number”, bare `{{worker}}` | Schema above; `server/plugins/quicksearch/plugins/worker.ts` result subtitle; `server/plugins/tokens/plugins/worker.ts` `WORKER_DEFAULT_LEAF`; `server/modules/webservices/edls-passport-export-mapper.ts:193–202` | **Mask** the worker's human-facing number, including fallback labels, search results and token aliases. Convert to a display string in a presentation DTO; do not change the numeric routing/join contract in place. Short values: fully hide instead of showing the complete identifier. |
| All `worker_ids.value` (`WorkerId.value`, list `value`, quicksearch subtitle detail, EDLS `employeeId` / Passport `worker_empid`) | `shared/schema.ts:837–845`; `server/modules/workers/ids.ts`; `server/storage/workers/ids.ts`; `server/modules/edls/sheets.ts` worker-display-ids route | **Mask approved display-identifier types** to last four characters. Unclassified new types: withhold until classified. Type UUIDs and type names are not person identifiers; retain metadata unless it embeds person-specific content. |
| Configured employee-shop ID types, Legacy NID, Union ID and External ID | Configuration inventory below; `scripts/s1-migration/load-employee-ids.ts:20,106`; `load-contacts-workers.ts:73,1092–1098,1387–1389` | **Mask** values. Legacy source NIDs become human-facing worker IDs even though originally source record keys. Per-employer employee IDs are not internal UUIDs. |
| Configured legacy **AAT** worker ID value | Metadata label; migration maps `field_sirius_aat` to the generic ID type | **Withhold this type completely pending semantic confirmation.** The label/source field proves it exists, not whether a last-four fragment is safe. Do not conflate it with, or assume it is independent of, access credentials. |
| T631 `remoteWorkerId` / vendor `worker_id`; `worker_ein`; `t631` and `freeman_ein` type values | `server/modules/sitespecific/t631/client/sync-workers.ts:405–416,429–441,515–516,566–570` | **Mask** the structured values; **block** sync result/error text that interpolates old/new EINs or remote IDs. These are worker external numbers, not S2 routing UUIDs. EIN here means this integration's employee number, not an inferred company tax ID. |
| Freeman `freeman_ein`, `2nd` type values / shadow-worker identifiers | `server/modules/sitespecific/freeman/second-shift.ts:19,73–78,141–172` | **Mask** display values, preserve underlying source/shadow joins. Type presence/activation not verified in this DB. |
| Cardcheck `externalId`, worker-associated legacy document/source NIDs; integration response IDs | `shared/schema/cardcheck/schema.ts:28`; `server/modules/sitespecific/btu/scraper-import.ts:224–236,412–426`; `server/modules/sitespecific/btu/sig-import.ts:213–214` | **Withhold/block opaque cardcheck/import detail initially**; classify the specific external value before allowing last-four display. It can identify a worker's external record/document even if not a government/member ID. |
| Source/provenance JSON, e.g. `data.s1.nid`; dedicated worker data/beneficiary reads, note/file/wizard/plugin JSON | `shared/schema.ts:341,406`; `server/storage/entity-notes.ts` migration-target documentation; wizard dispatcher results. Generic worker storage already strips `workers.data` (`server/storage/workers.ts:881–895,1250`) | Preserve the existing generic worker-data exclusion. **Block/drop opaque dedicated presentation fields**, not recursively guess at them. Known provenance routing keys can be retained in an explicitly safe metadata DTO, but person/source IDs in arbitrary JSON have no blanket exemption. |
| `workers.id`, `contactId`, relation `worker1`/`worker2`, `userId`, entity IDs; account/payment/file/wizard/dispatch/election UUIDs | Shared schemas; `shared/tabRegistry.ts` href templates; `client/src/App.tsx`; worker QR payload | **Retain for routing/joins only** after semantic classification. They remain linkable identifiers: a known gap, not anonymization. Never mask all `id`/`workerId` keys; doing so breaks navigation and may leave actual external IDs untouched. |
| Employer/provider/benefit/options Sirius IDs, policy IDs, configuration aliases | `shared/schema.ts:425–453,673–681`; optional schemas | **Retain ordinary non-person catalog identifiers**. A configuration ID is not the worker's ID just because the same key name is used. Names/labels containing private content require withholding. |
| `worker_aat.accessUuid`, `accessCode`; `/edls-sched/<accessUuid>`; signed document links; signed object URLs | `shared/schema/worker/aat/schema.ts:12–24`; `client/src/pages/worker-aat.tsx:113–146`; EDLS SMS notifier `workerScheduleUrl`; `server/modules/files.ts:321–342`; esign view | **Block completely**, not “mask last four”. These authorize access or actions; changing their displayed spelling does not revoke existing links. Never emit the full href, QR, copy value or token in masked-session output. Public/previously issued links are a separate limitation. |
| Auth identity `externalId`, email/displayName, provider metadata, access/refresh tokens, session IDs, password hashes; payment provider customer/payment-method/intent IDs/client secrets | `shared/schema.ts:247–263`; auth/ledger modules | **Block identity/provider administration and payment/checkout credential surfaces while ON**. These are account or credential data, not ordinary member IDs; do not expose fragments as a supposed safety measure. Do not change required provider protocols or background delivery data. |
| Payment-method/account last-four summaries | Worker payment-method and ledger surfaces | Already-truncated financial data is not automatically an SSN. Initial recommendation: **block financial editor/checkout/provider detail**; allow balances/structured statements only after safe DTO review. No bank/card masking expansion is silently authorized by this audit. |

### Development identifier-type configuration (read-only)

Query: `SELECT name, sirius_id, validator, data->>'showOnLists' AS show_on_lists FROM options_worker_id_type ORDER BY name`.

| Configured type label | Stable alias metadata | Proposed value treatment |
| --- | --- | --- |
| AAT | none returned | Withhold pending credential/display-ID classification |
| ARAMARK AT ANAHEIM CONVENTION CENTER Employee ID | `s1-employee-shop-2470125` | Mask last four |
| DOUBLETREE DTLA Employee ID | `s1-employee-shop-2470133` | Mask last four |
| External ID | none returned | Mask last four |
| Legacy NID | `s1-legacy-nid` | Mask last four |
| Marshall Retail (UHP - Kaiser) Employee ID | `s1-employee-shop-16489538` | Mask last four |
| PASADENA HILTON Employee ID | `s1-employee-shop-2470150` | Mask last four |
| Union ID | none returned | Mask last four |

Validators were null/empty for these projected rows. Legacy NID returned `showOnLists=true`; the other projected flags were null, **not proof of false or invisibility on every surface**. No identifier values were read. Development metadata cannot establish the configured types on the external live S2 deployment.

Discovered in source but not in this development result: `t631`, `freeman_ein`, `2nd`, and future/dynamic worker-ID types. Production labels, validators, list visibility and complete type membership remain **unresolved**. No passport, driving-license or government-ID-specific column was discovered in the inspected identity schemas; generic worker ID types/opaque data can still hold them. This is not evidence that no such values exist.

## Name contract

- Worker truth lives on `contacts`: `given`, `middle`, `family`, `generational`, `title`, `credentials`, and independently stored `displayName` (`shared/schema.ts:310–324`). API aliases add `firstName`, `lastName`, `displayName`; list/EDLS/report projections also use composed names, `workerName`, `entityName`, `authorName`, and family-first strings.
- Propose `maskName` operating on **structured name parts**, not a global string regex: visible given name plus fixed `••••` when a family value exists. Mask the entire family field, including hyphenated/multi-word surnames. Do not keep the initial (`Maria M.` still discloses surname information).
- Never trust an existing `displayName` fallback after masking `family`. Rebuild display aliases from verified name parts; if parts are absent/ambiguous, return `Name hidden` rather than infer which word is a first name.
- Suffixes/titles/credentials: omit from the initial masked display. `Jr.`, `III` and professional credentials must not be mistaken for the surname or left appended to a raw full name. Preserve stored values unchanged.
- A single-word value in a **verified given-name field** may remain visible; a single-word unstructured name could be a surname and is fully withheld. A family-only structured record displays `••••`; a missing name stays missing/ordinary neutral placeholder.
- Do not split on the final space to decide family name. Compound surnames, particles, different name orders, commas and suffixes make that unreliable. BAO beneficiary names and arbitrary full-name fields need blocking or a separately approved parsing limitation.
- Related workers/dependents use the same rule. Recommend masking surnames on contact/user summaries as well, because a linked worker can reappear as a user, author, recent masquerade target or related person. This broader **presentation-only** contact/user scope requires approval; no stored names, permissions or audit actors change.
- No shared privacy/name formatter currently covers all these aliases. Existing name compositions and the shared SSN formatter are display formatting, not a masking boundary.

## Smallest coherent server design (not implemented)

### 1. Session authority and fail-closed state

Use persisted state keyed by the **Express session ID**, never a user preference, global variable or component setting. Model `on`, **explicitly persisted** `off`, and `unknown/error`, with a monotonic presentation revision. Unknown includes missing legacy flags, malformed state, failed store read, permission resolution failure, and stale policy revision.

- Only a successfully loaded explicit OFF state permits existing raw presentation. Unknown masks approved structured contracts and refuses everything else; it must never default to false.
- On a new successfully authenticated session, persist explicit OFF before sensitive pages are served, preserving ordinary fresh-login behavior. Existing missing-state sessions stay protected until state is resolved through an approved transition or a fresh login. This legacy-session consequence must be approved, especially for users who cannot toggle.
- Persist toggle state before acknowledging success. If persistence fails, return an error and keep a protected loading/refusal shell; never show an ON-ready banner based only on an optimistic checkbox.
- `server/auth/index.ts` uses `resave:false`, rolling cookies, and a storage-backed whole-session payload. Concurrent credential refresh, masquerade or ordinary session saves can overwrite a naive `req.session.maskMode` toggle. Extend the **single session-store write contract** so ordinary `set` operations preserve authoritative policy/revision; use an atomic update/CAS for policy transitions. Do not merely add a field and call `save()`. An alternative separate SID-keyed policy row is possible but adds a table/migration; choose after implementation design review.
- Logout/expiry ends this session's preference; another browser/session/user is unaffected. All tabs sharing the session share the mode.

### 2. Permission and masquerade

Existing `staff`, `admin`, `masquerade` and `workers.ssn` are not trainer permissions (`shared/permissions.ts:147–202`); `workers.ssn` concerns lookup, not privacy mode, and its “never displayed” description is not the actual overview behavior.

Recommend a dedicated **`privacy.mask-mode`** toggle permission rather than grant every staff member a new capability. Alternative for approval: initially admin-only, explicitly accepting that trainers need admin. Do not grant it automatically or silently reuse `masquerade`.

Use `getEffectiveUser` for ordinary data authorization and audit actor semantics. Keep presentation protection attached to the real browser session through masquerade start/stop; it must never inherit the target's preference or auto-switch off. The original authenticated presenter can manage **only their own session's privacy toggle** using their own permission, as an explicit narrow exception—not as authority to view or edit target data. Record original/masqueraded provenance according to existing conventions. Revocation or failed permission lookup must not turn ON into OFF; retain protection and require reauthentication/authorized recovery.

### 3. One response policy, explicit semantic contracts

Install a request-context presentation policy after session/auth resolution and **before any sensitive route** (auth/user, bookmarks, file routes and errors included), coordinated with `server/app-init.ts` and route registration order. Use field-aware reusable `maskSsn`, `maskId`, `maskName` projections over cloned presentation DTOs.

Register output contracts by actual handler/transport, not just a URL prefix. Contracts identify worker/contact/user name parts, external worker IDs, safe catalog data, and opaque/unsafe fields. Shared endpoint families (lists, contacts, autocomplete, plugin results) reuse these contracts. A JSON egress guard enforces coverage, protects mutation/error responses and refuses unclassified responses when ON/unknown. Simply wrapping `res.json` cannot protect `res.send`, redirects, streams, files or public/static content.

Apply projection **after shared raw caches are read**, immediately before response serialization; never mutate cached/storage objects, source data, audit snapshots, token truth or vendor delivery payloads. Masked responses should use safe DTO types/presentation metadata instead of pretending a bullet string remains a numeric ID or editable SSN.

Unknown plugin result columns, `data` JSON, arbitrary strings, errors and debug payloads must refuse or be reduced to an approved safe envelope. Bare key-name replacement is insufficient: `value`, `subtitle`, `name`, `label`, `csv`, before/after snapshots and numeric `worker_id` can contain identity, whereas many `id` and `siriusId` fields are unrelated catalog keys.

Preserve existing authorization/component gates. Mask Mode is a disclosure policy, not a way to see inaccessible records.

### 4. Transitions, concurrency, caches and tabs

Do not show “ready to record” until all of these are true:

1. Immediately cover the initiating tab with a neutral transition shell; stop queries/mutations and clear open editors, selections, search input, toasts and previews. Warn about unsaved drafts; do not save them as part of toggling.
2. Server serializes transition against sensitive response delivery **across all processes**, keyed by SID. Use a shared DB coordination mechanism, not an in-process map. Recheck presentation revision at final egress. Buffer structured responses until checked; unsafe streaming routes are denied. Enabling waits for or terminates pre-transition sensitive responses; bounded timeout leaves transition unready, not falsely successful.
3. Cancel/drain old requests and remove the entire identity-bearing TanStack cache, not merely invalidate it. Abort plus a generation/revision check is needed: an already resolving promise may still repopulate a cache. Include presentation revision/effective actor in cache identity; reject late wrong-revision responses.
4. Clear component state, auth/user/context data, page title, bookmark/recent-target caches, wizard state, local drafts and pending optimistic mutations. Revoke blob URLs; remove iframes/object/image previews and any persistent client copies discovered in implementation. A hard navigation helps reset memory but does not erase browser/network history.
5. Notify every same-session tab (e.g. BroadcastChannel), require a protected rebootstrap on focus/visibility/BFCache restore, and use server revision enforcement rather than trusting a browser broadcast. A sleeping/old tab cannot be made to erase already rendered pixels by server policy alone. **Recording must use one fresh active tab; close the others before recording.** This residual limit is explicit.
6. Reload state and masked DTOs; only then show a persistent, accessible ON banner on every application layout, including errors/not-found/standalone pages. Prefer truthful copy: “MASK MODE ON — Names and IDs are limited. Some content is blocked. Not de-identified.” Include it in print styling for allowed structured print.

Turning OFF is also an explicit, acknowledged transition with cache separation. OFF response contracts/bytes must otherwise match current behavior. Do not leave a permanently masked shared cache or change background jobs. A previously issued OFF response cannot be recalled from network tools, browser caches or a screenshot.

### 5. Writes must not receive masked defaults

Initially make identity/dependent/beneficiary/user editing and opaque bulk/wizard workflows **unavailable while ON/unknown**, including direct POST/PUT/PATCH/delete endpoints where their response or side effects are unsafe. Return a clear refusal before work, uploads, credential creation or vendor calls.

Do not seed editable `ssn`, `family`, `nameComponents`, worker ID `value` or whole-list beneficiary forms from masked display DTOs. Do not rely on stripping bullets: doing so can turn a display fragment into a valid but false identifier. If unrelated edits are later allowed, patch only explicit editable fields and keep server originals for omitted protected fields; reject protected-field submissions, stale presentation revisions and masked sentinel values server-side. No identity mutations, stored aliasing or historical audit rewriting belong to masking.

For an upload/export/report wizard, “read-like” data/preview routes may load arbitrary existing records; creating or running it may also write data or send messages. Block at admission, not merely the final download button.

### 6. Non-JSON and realtime policy

- Worker CSV, embedded CSV-in-JSON, wizard CSV/EDI, invoice/letter PDF, print HTML, attachment bytes, redirects, signed URLs, thumbnails, `srcDoc`, remote URLs and content-disposition filenames need explicit policies. Initial recommendation is block generation/access while ON, with neutral, non-person filenames in any later approved safe export.
- The discovered `/ws` channel currently sends **counts only**, not worker names or SSNs: `alert_update`, `notification_summary`, plus ping/connected messages (`server/services/websocket.ts`). Do not claim current raw-identity websocket leakage. Connections are indexed by effective user, not SID; future identity payloads/state broadcasts need per-session recipient policy and revalidation/reconnect after masquerade. Never mask once and broadcast the same person-bearing payload to every session of a user.
- BTU political bulk lookup uses **SSE** with arbitrary error strings, outside `res.json`. Block admission while ON; a JSON response wrapper does not cover it.
- Background notifications and integrations keep truthful data and existing behavior. A presenter must not trigger real sends/charges in training; block user-initiated unsafe workflows while ON before side effects. Do not propagate a presenter's mask flag into a shared queue or change what recipients receive.

## Limits requiring explicit acceptance

1. **Stored free text:** notes, comments, subjects, job titles, memos, addresses, configuration labels, HTML literals and diagnostic messages can contain surnames/SSNs/IDs. Regex replacement cannot prove absence. The initial policy blocks unstructured bodies and unreviewed strings, not claims they are redacted.
2. **Binary documents:** PDFs, images, signatures and uploaded files may contain text, scanned identities and metadata. No OCR/redaction guarantee is proposed. Block content and person-bearing metadata, thumbnails, previews, signed-URL issuance and download routes.
3. **Bearer/public links:** previously issued S3/object URLs, public-files links, external document URLs, AAT/EDLS schedule links and e-sign links may work without this session. Prevent generating/showing/opening them in masked UI, but ordinary session masking cannot revoke or control someone visiting a copied link externally or without a cookie. Do not enter those routes during recording. Stronger protection requires a separately approved link/proxy/access design.
4. **Browser history and prior content:** tabs, back/forward cache, address-bar suggestions, search queries, clipboard, developer tools, network history, downloads, print spool, OS notifications and prior recordings cannot be erased or guaranteed safe by this feature. Start a fresh recording browser/session; enable before opening a record; close prior tabs; do not show developer tools/history/downloads during recording.
5. **Other identifying data:** first names, DOB, email, phone, address, work/benefit facts, family relationships and retained routing UUIDs can identify people alone or in combination. First-name aliasing is explicitly out of scope. A surname/ID mode is **not comprehensive PHI protection**. If a contact field visibly embeds a surname (email/local-part or address c/o), withholding it is safer than claiming the surname is hidden; approve withholding contact-detail strings initially.
6. **Optional/dynamic code:** production component enablement, custom client-injection code, local help/settings, templates and unknown JSON were not examined as live content. Deny unclassified masked outputs; do not mark them protected merely because the common worker page looks safe.

## Decisions requested before implementation

- Approve fixed `given + ••••`, omitting suffix/title/credentials; neutral withholding for unstructured names?
- Approve masking worker Sirius numbers as well as the seven classified configured display-ID types; fully withhold legacy AAT until classified?
- Approve dedicated `privacy.mask-mode`, its role assignments, the narrow presenter-controlled toggle during masquerade, and the legacy-session fail-closed/re-login behavior?
- Approve masking contact/user surname summaries and blocking name-bearing email/address/contact strings, not just worker surnames?
- Approve initial refusal of unsafe workflows in the exposure table (documents, exports, notes/log content, real-record previews, sends, payment/credential operations and identity edits)?
- Accept the public-link, sleeping-tab, retained UUID, first-name and previous-content limitations—or require a non-live training environment/stronger link design instead?
- Obtain metadata-only inventory from the actual live deployment before enabling training use. No production identity values are needed.

No built-in help entry is changed now: no behavior has shipped, and help must not describe a nonexistent toggle. The implementation must ship its built-in guidance and verification together (see companion coverage plan).
