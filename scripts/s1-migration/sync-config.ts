/**
 * Checked-in dual-run sync configuration — the single source of truth the
 * one-command orchestrator (`sync.ts`) executes. RUNBOOK §11.
 *
 * Everything an operator used to hand-copy from RUNBOOK §3/§4/§5 lives here
 * as reviewable code:
 *   - fleet order (§3/§4, including beneficiaries and cardchecks),
 *   - per-loader RULED allow-reject classes per environment profile (§5),
 *   - expected loader LOGIC_VERSIONs (the orchestrator fails the run when a
 *     loader emits a different version — the §10 "bump in the same commit"
 *     rule now has teeth: bump the loader AND this table together),
 *   - open-end horizon policy (§4 row 9),
 *   - parity month selection (§6: freeze month, one mid-history month, plus
 *     the CURRENT open-span month computed fresh every run),
 *   - mode-specific report-only finding policy (§10/§11: daily surfaces the
 *     ruled kinds for triage; final-freeze blocks on ALL findings).
 *
 * FAIL-CLOSED: unknown reject classes are refused by loaders themselves
 * (--allow-rejects is exact-match), and unknown finding kinds are refused
 * both here (validateSyncConfig) and by loaders (--allow-findings is
 * exact-match). Nothing unlisted can pass silently.
 */

/** Report-only finding kinds that exist in the fleet today. A NEW kind must
 * be added here (and given a mode policy) before any profile may allow it —
 * validateSyncConfig refuses unknown kinds. */
export const KNOWN_FINDING_KINDS = [
  "deleted_in_s1", // framework standard (§10): S1 source vanished, rows preserved
  "source_worker_missing", // beneficiaries: staged worker vanished entirely (fund ruling required)
  "pending_retention", // cardchecks: signed authorization vanished (retention ruling required)
  // Structural: a loader's deletion sweep could not run AT ALL (packet-tags
  // when no keep-tag terms are staged). Dev-structural there (synthetic gap);
  // in production a skipped sweep means retained rows never clean up — triage
  // it, never blanket-allow.
  "sweep_skipped_no_keep_tag_terms",
] as const;
export type FindingKind = (typeof KNOWN_FINDING_KINDS)[number];

export type SyncMode = "daily" | "final-freeze";
export type SyncProfileName = "dev" | "production";

export interface FleetStep {
  /** Stable step id (also the per-step key in profiles). */
  id: string;
  /** Script filename under scripts/s1-migration/. */
  script: string;
  /** Envelope `loader` name the script must emit (result contract). */
  loader: string;
  /** Expected envelope logicVersion. Mismatch fails the run: a transform fix
   * must bump the loader constant AND this table in the same commit. */
  logicVersion: number;
  /** Loader accepts --force-reconcile (fingerprint-converted loaders). */
  supportsForceReconcile: boolean;
  /** Loader accepts --allow-findings (has a report-only deletion sweep). */
  supportsAllowFindings: boolean;
  /** Loader accepts --allow-rejects. (hours has NO reject gate by design —
   * problem rows are counted skips; §4 row 12.) */
  supportsAllowRejects: boolean;
  /** Args always passed, both profiles (e.g. --migration-mode). */
  extraArgs?: string[];
}

/**
 * Fleet in dependency order — RUNBOOK §3/§4. Ordering rules that matter:
 * options first (everything resolves options), contacts-workers before every
 * worker consumer (beneficiaries, users, ...), employers before
 * employer-policies/rates, policies before employer-policies, elections
 * before benefit-history (employer fallback via election), payments BEFORE
 * ledger (payment refs + cascade re-create, §10), hours after ledger.
 */
export const FLEET: FleetStep[] = [
  { id: "seed-trust-config", script: "seed-trust-config.ts", loader: "seed-trust-config", logicVersion: 1, supportsForceReconcile: false, supportsAllowFindings: false, supportsAllowRejects: false },
  { id: "options", script: "load-options.ts", loader: "t4-options", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: true, supportsAllowRejects: false },
  { id: "contacts-workers", script: "load-contacts-workers.ts", loader: "t3t1-contacts-workers", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: true, supportsAllowRejects: true },
  { id: "beneficiaries", script: "load-beneficiaries.ts", loader: "t-bao-beneficiaries", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: true, supportsAllowRejects: true },
  { id: "member-statuses", script: "load-member-statuses.ts", loader: "t6-member-statuses", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: true, supportsAllowRejects: true },
  { id: "employers", script: "load-employers.ts", loader: "t7t24-employers", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: true, supportsAllowRejects: true },
  { id: "policies", script: "load-policies.ts", loader: "t-policies", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: true, supportsAllowRejects: true },
  { id: "employer-policies", script: "load-employer-policies.ts", loader: "t-employer-policies", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: true, supportsAllowRejects: true },
  { id: "employer-rates", script: "load-employer-rates.ts", loader: "t-employer-rates", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: true, supportsAllowRejects: true },
  { id: "relationships", script: "load-relationships.ts", loader: "t15-relationships", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: true, supportsAllowRejects: true },
  { id: "employee-ids", script: "load-employee-ids.ts", loader: "n4-employee-ids", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: true, supportsAllowRejects: true },
  { id: "elections", script: "load-elections.ts", loader: "t16-elections", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: true, supportsAllowRejects: true },
  { id: "benefit-history", script: "load-benefit-history.ts", loader: "t17-benefit-history", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: true, supportsAllowRejects: true },
  { id: "payments", script: "load-payments.ts", loader: "t19-payments", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: false, supportsAllowRejects: true },
  { id: "ledger", script: "load-ledger.ts", loader: "t18-ledger", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: false, supportsAllowRejects: true },
  { id: "hours", script: "load-hours.ts", loader: "t20-hours", logicVersion: 1, supportsForceReconcile: false, supportsAllowFindings: false, supportsAllowRejects: false, extraArgs: ["--migration-mode"] },
  { id: "call-logs", script: "load-call-logs.ts", loader: "n21-call-logs", logicVersion: 2, supportsForceReconcile: true, supportsAllowFindings: true, supportsAllowRejects: true, extraArgs: ["--migration-mode"] },
  { id: "cardchecks", script: "load-cardchecks.ts", loader: "cardchecks", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: true, supportsAllowRejects: true, extraArgs: ["--migration-mode"] },
  { id: "enrollment-packet-tags", script: "load-enrollment-packet-tags.ts", loader: "t29-enrollment-packet-tags", logicVersion: 1, supportsForceReconcile: true, supportsAllowFindings: true, supportsAllowRejects: true, extraArgs: ["--migration-mode"] },
  { id: "users", script: "load-users.ts", loader: "t27-users", logicVersion: 1, supportsForceReconcile: false, supportsAllowFindings: false, supportsAllowRejects: true },
];

export interface StepPolicy {
  /** RULED allow-reject classes for this loader in this profile (§5). */
  allowRejects?: string[];
  /** Profile-specific extra CLI args for this step (e.g. dev-only overrides
   * that must NEVER apply in production). */
  extraArgs?: string[];
  /** Config-RULED report-only finding kinds for THIS step in THIS profile:
   * forwarded via --allow-findings on top of the profile's
   * dailyAllowedFindings AND exempt from final-freeze blocking (a ruled
   * structural finding is not an "unresolved/unruled" deletion finding).
   * Keep rare; every entry needs a ruling comment. */
  allowFindings?: string[];
}

export interface SyncProfile {
  /** Extra args for stage.ts (none today; the default in-scope run). */
  stageArgs: string[];
  /** Dev-only: staged-fake seed scripts that must re-run after EVERY restage
   * (restage sweeps them). Paths relative to scripts/s1-migration/. Each seed
   * declares the fleet step it depends on (all three read s1_staging.id_map
   * rows that only exist once contacts-workers has run on a fresh target), so
   * the orchestrator runs it right AFTER that step succeeds — before the
   * seeded fakes' consumers (beneficiaries, call-logs, cardchecks) run. */
  postStageSeeds: Array<{ script: string; afterStep: string }>;
  /** T17 open-end horizon (§4 row 9). "current-la-month" = omit the flag and
   * let the loader default to the current America/Los_Angeles month — the
   * daily dual-run policy (the open-end month advances per sync). An explicit
   * "YYYY-MM" pins it (dev synthetic convention / ruled final-cutover month).
   * Month parity always receives the SAME horizon (§6 rule). */
  openEndThrough: "current-la-month" | string;
  parity: {
    /** Balance parity: 0¢ drift is the standing rule (§6). */
    toleranceCents: number;
    /** Balance parity mismatch classes ruled allowable (default none). */
    allowMismatches: string[];
    /** Month parity threshold; 0 is the target and any non-zero value is an
     * explicit fund decision (§6). */
    maxDisagreementPct: number;
    /** Rolling ruled month set (§6 + task ruling): the freeze month, one
     * mid-history month; the third month — the CURRENT open-span month — is
     * computed fresh each run and advances with the calendar. */
    months: { freeze: string; midHistory: string };
    /** Extra --allow-unresolved classes BEYOND the mirror of the
     * benefit-history allow-rejects (the §6 rule is "mirror EXACTLY";
     * anything here needs its own ruling). */
    extraAllowUnresolved: string[];
  };
  /** Report-only finding kinds RULED acceptable to surface (not resolve) in
   * DAILY mode. Forwarded to loaders via --allow-findings in both modes so
   * the whole fleet completes and reports; in final-freeze mode the
   * ORCHESTRATOR blocks the run on every finding regardless (§11). A kind a
   * loader emits that is NOT listed here fails that loader (exit 1) in both
   * modes — unknown/unruled classes fail closed. */
  dailyAllowedFindings: FindingKind[];
  /** Per-step ruled reject allowances. Key = FleetStep.id. */
  steps: Record<string, StepPolicy>;
}

export const PROFILES: Record<SyncProfileName, SyncProfile> = {
  /** Dev rehearsal target — RUNBOOK §4 dev columns (seeded synthetic traps
   * make most classes fire exactly once so the gates stay exercised). */
  dev: {
    stageArgs: [],
    postStageSeeds: [
      { script: "dev/seed-beneficiary-fakes.ts", afterStep: "contacts-workers" },
      { script: "dev/seed-call-log-traps.ts", afterStep: "contacts-workers" },
      { script: "dev/seed-cardcheck-fakes.ts", afterStep: "contacts-workers" },
    ],
    openEndThrough: "2026-12", // dev synthetic convention (§4 row 9)
    parity: {
      toleranceCents: 0,
      allowMismatches: [],
      maxDisagreementPct: 0,
      // 2025-06 = mid-history rehearsal month (82/82 matched), freeze 2026-08
      // = synthetic generation freeze; the open-span month is computed.
      months: { freeze: "2026-08", midHistory: "2025-06" },
      extraAllowUnresolved: [],
    },
    dailyAllowedFindings: ["deleted_in_s1", "source_worker_missing", "pending_retention"],
    steps: {
      "seed-trust-config": {},
      options: {},
      // §5: RULED annotation family (non-fatal by ruling; the row still
      // loads) — the standard reject gate requires the explicit allowance.
      // 2 each in synthetic data.
      "contacts-workers": { allowRejects: ["ssn_collision_q36", "worker_contact_unresolved"] },
      beneficiaries: {
        // §4 row 2b: seeded traps, one each.
        allowRejects: [
          "worker_unmapped",
          "percent_sum_mismatch",
          "pct_unusable",
          "bad_json",
          "unexpected_tier",
          "list_exists_foreign",
          "worker_map_broken",
        ],
      },
      "member-statuses": {},
      employers: {},
      policies: { allowRejects: ["policy_unmatched_unreferenced"] }, // synthetic workers_v1 node
      "employer-policies": {},
      "employer-rates": { allowRejects: ["bad_rate"] }, // §4 row 5c
      relationships: {},
      "employee-ids": { allowRejects: ["duplicate_code"] }, // 2 synthetic
      elections: { allowRejects: ["relation_unmapped"] }, // synthetic dangling relation refs
      "benefit-history": {
        // §4 row 9 traps + relation_unmapped (dangling relation refs reach
        // t17 in the regenerated staging — same list the elections/benefits
        // sync smoke runs green with).
        allowRejects: [
          "start_missing",
          "subscriber_worker_mismatch",
          "relation_subscriber_mismatch",
          "relation_unmapped",
          "employer_unresolved",
        ],
      },
      payments: {},
      ledger: { allowRejects: ["non_cleared_status"] }, // 2 synthetic Pending
      hours: {},
      "call-logs": {
        // §4 row 13: 5 synthetic traps, one each.
        allowRejects: ["category_missing", "category_unmapped", "handler_missing", "handler_unresolved", "handler_dangling"],
      },
      cardchecks: {
        // §4 row 13b seeded traps. disclaimer_missing only re-fires when its
        // definition reprocesses (composite fingerprints) — harmless to keep allowed.
        allowRejects: ["disclaimer_missing", "handler_dangling", "bad_json", "handler_unresolved"],
      },
      // Synthetic staging has no keep-tag terms, so the retention sweep
      // cannot run — a permanent dev-structural finding (RULED here), NOT a
      // deletion finding pending fund ruling. Production does not allow it.
      "enrollment-packet-tags": { allowFindings: ["sweep_skipped_no_keep_tag_terms"] },
      users: { allowRejects: ["missing_mail", "invalid_mail", "duplicate_user_email"] }, // synthetic traps
    },
  },

  /** Production dual-run — §5 ruled classes ONLY. Every entry cites its §5
   * ruling; a class not listed fails the run (fail closed) and needs triage
   * + a ruling before being added here in a reviewed commit. */
  production: {
    stageArgs: [],
    postStageSeeds: [],
    // Daily dual-run policy (§4 row 9, amended 2026-08-09): omit the flag —
    // the loader defaults to the current LA month, advancing per sync. The
    // final-cutover run uses the SAME policy (transition month = the month
    // the migration run happens in).
    openEndThrough: "current-la-month",
    parity: {
      toleranceCents: 0, // §6: zero tolerance unless the fund rules otherwise
      allowMismatches: [],
      maxDisagreementPct: 0, // §6: any non-zero threshold is an explicit fund decision
      // freeze = 2026-08 initial production load month; midHistory 2025-06 =
      // the ruled rehearsal evidence month (82/82) — re-rule at cutover if
      // the fund prefers a different mid-history sample.
      months: { freeze: "2026-08", midHistory: "2025-06" },
      extraAllowUnresolved: [],
    },
    dailyAllowedFindings: ["deleted_in_s1", "source_worker_missing", "pending_retention"],
    steps: {
      "seed-trust-config": {},
      options: {},
      // §5: RULED annotation family (rows still load; review counts in the
      // report) — ssn collisions (Q36), unresolvable contact/gender refs,
      // sequential sirius_id assignment for workers without one.
      "contacts-workers": {
        allowRejects: ["ssn_collision_q36", "worker_contact_unresolved", "worker_gender_unresolved", "sirius_id_assigned"],
      },
      beneficiaries: {
        // §5: worker_unmapped = deleted/merged S1 contacts family (verify
        // sampled nids); unexpected_tier = ANNOTATION (contingent tier out of
        // scope by ruling). All other classes must run clean.
        allowRejects: ["worker_unmapped", "unexpected_tier"],
      },
      "member-statuses": {},
      employers: {},
      // §5: allow ONLY after inspecting reported titles (non-policy JSON definitions).
      policies: { allowRejects: ["policy_unmatched_unreferenced"] },
      "employer-policies": {},
      "employer-rates": { allowRejects: ["bad_rate"] }, // §5/§4 row 5c: 2 known colon typos, ruled
      relationships: {},
      // §5: may genuinely occur — inspect, allow observed count. Rerun shape
      // becomes adopt + code_owned_by_other_worker.
      "employee-ids": { allowRejects: ["duplicate_code"] },
      // §5 RULED 2026-08-09: benefit_unmapped (deleted benefit nid 2457521),
      // worker_unmapped (deleted/merged contacts). 2026-08-09 run: 943
      // rejects, all allowed after triage.
      elections: { allowRejects: ["benefit_unmapped", "worker_unmapped"] },
      "benefit-history": {
        // §5 RULED 2026-08-09 set (observed counts in the table). Month
        // parity mirrors this list EXACTLY (§6) — it is derived, not repeated.
        allowRejects: [
          "start_missing",
          "subscriber_worker_mismatch",
          "end_before_start",
          "benefit_ref_missing",
          "benefit_unmapped",
          "worker_unmapped",
          "relation_unmapped",
          "employer_unresolved",
        ],
      },
      payments: {},
      // §5: expected — verify count == frozen S1 non-cleared AR count.
      ledger: { allowRejects: ["non_cleared_status"] },
      hours: {},
      // §5: prod expectation handler_dangling=2 (nids 17748264, 17748261 —
      // verified deleted S1 nodes on the 2026-08 prod run).
      "call-logs": { allowRejects: ["handler_dangling"] },
      // §5: same taxonomy as call-logs; triage nid samples first.
      cardchecks: { allowRejects: ["handler_dangling"] },
      "enrollment-packet-tags": {},
      // §5: run clean first; these are the triaged classes (accounts without
      // usable mail cannot use Okta and need manual handling).
      users: { allowRejects: ["missing_mail", "invalid_mail", "duplicate_user_email"] },
    },
  },
};

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Fail-closed config validation — refuses to run on any inconsistency. */
export function validateSyncConfig(): void {
  const ids = new Set<string>();
  for (const s of FLEET) {
    if (ids.has(s.id)) throw new Error(`sync-config: duplicate fleet step id "${s.id}"`);
    ids.add(s.id);
  }
  const pay = FLEET.findIndex((s) => s.id === "payments");
  const led = FLEET.findIndex((s) => s.id === "ledger");
  if (pay < 0 || led < 0 || pay > led) throw new Error("sync-config: payments must run before ledger (§10)");
  const known = new Set<string>(KNOWN_FINDING_KINDS);
  for (const [name, p] of Object.entries(PROFILES)) {
    for (const kind of p.dailyAllowedFindings) {
      if (!known.has(kind)) throw new Error(`sync-config[${name}]: unknown finding kind "${kind}" — fail closed`);
    }
    for (const key of Object.keys(p.steps)) {
      if (!ids.has(key)) throw new Error(`sync-config[${name}]: step policy for unknown fleet id "${key}"`);
    }
    for (const seed of p.postStageSeeds) {
      if (!ids.has(seed.afterStep)) {
        throw new Error(`sync-config[${name}]: seed "${seed.script}" afterStep "${seed.afterStep}" is not a fleet step id`);
      }
    }
    for (const [sid, pol] of Object.entries(p.steps)) {
      for (const k of pol.allowFindings ?? []) {
        if (!known.has(k)) throw new Error(`sync-config[${name}]: "${sid}" allowFindings has unknown kind "${k}" — fail closed`);
      }
    }
    for (const s of FLEET) {
      const pol = p.steps[s.id];
      if (!pol) throw new Error(`sync-config[${name}]: missing step policy for "${s.id}" (add {} explicitly)`);
      if (pol.allowRejects?.length && !s.supportsAllowRejects) {
        throw new Error(`sync-config[${name}]: "${s.id}" has allowRejects but the loader has no reject gate`);
      }
      if (pol.allowRejects?.some((r) => !/^[a-z0-9_]+$/.test(r))) {
        throw new Error(`sync-config[${name}]: "${s.id}" allowRejects contains a malformed class name`);
      }
    }
    if (p.openEndThrough !== "current-la-month" && !YM_RE.test(p.openEndThrough)) {
      throw new Error(`sync-config[${name}]: openEndThrough must be "current-la-month" or YYYY-MM`);
    }
    for (const m of [p.parity.months.freeze, p.parity.months.midHistory]) {
      if (!YM_RE.test(m)) throw new Error(`sync-config[${name}]: parity month "${m}" is not YYYY-MM`);
    }
    if (p.parity.toleranceCents !== 0) {
      // Not forbidden forever, but a non-zero tolerance is a fund decision —
      // force the diff to show a config change plus this comment.
      throw new Error(`sync-config[${name}]: toleranceCents must stay 0 (0¢ drift rule) unless the fund re-rules`);
    }
  }
}

/** Current month in America/Los_Angeles as YYYY-MM (the fund's clock — same
 * convention as the t17 loader default and getTodayYmd()). */
export function currentLaMonth(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit" });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

/** Resolve the t17/month-parity horizon for a profile. */
export function resolveOpenEndThrough(profile: SyncProfile, now = new Date()): string {
  return profile.openEndThrough === "current-la-month" ? currentLaMonth(now) : profile.openEndThrough;
}

/** The rolling parity month set: freeze, mid-history, current open-span
 * month (deduped, chronological). The open-span month advances per sync. */
export function parityMonths(profile: SyncProfile, now = new Date()): string[] {
  const set = new Set([profile.parity.months.freeze, profile.parity.months.midHistory, currentLaMonth(now)]);
  return [...set].sort();
}
