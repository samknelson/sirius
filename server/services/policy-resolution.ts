import type { Policy } from "@shared/schema";

/**
 * Central "which policy is in effect for this employer as of this date"
 * resolver.
 *
 * Elections no longer carry an authoritative policy of their own — the
 * employer's policy history (`employer_policy_history`) records which policy
 * is in effect over time, so plan-rule changes take effect without touching
 * existing elections. Every reader (benefits scan, charge/quote plugins,
 * election views) resolves the policy through this single helper so the
 * fallback chain is identical everywhere:
 *
 *   1. employer policy history entry effective as of the date,
 *   2. the employer's current denormalized policy (`denorm_policy_id`),
 *   3. the system default policy (`policy_default` variable).
 *
 * All DB access goes through the storage layer passed in by the caller (no
 * static import of the storage singleton, so storage-layer modules can use
 * this without an import cycle).
 */

/** The minimal slice of the storage layer the resolver needs. */
export interface PolicyResolutionStorage {
  employerPolicyHistory: {
    getEmployerPolicyHistory(employerId: string): Promise<any[]>;
  };
  employers: {
    getEmployer(id: string): Promise<any | undefined>;
  };
  policies: {
    getPolicyById(id: string): Promise<Policy | undefined>;
  };
  variables: {
    getByName(name: string): Promise<{ value: unknown } | undefined | null>;
  };
}

export interface ResolvedEmployerPolicy {
  policy: Policy | null;
  /** Human-readable provenance, e.g. "Employer policy history (Acme)". */
  policySource: string;
}

/**
 * The authoritative employer/policy source for coverage granted to a
 * subscriber.  The WMB row is a materialized coverage result and can outlive
 * a corrected election, so it must not supply the policy employer.  The
 * election employer(s) are used only to identify the employer; legacy
 * election policy fields remain deliberately ignored.
 */
export interface GrantingPolicyResolutionStorage extends PolicyResolutionStorage {
  workers: {
    getWorker(id: string): Promise<{
      denormHomeEmployerId?: string | null;
    } | undefined>;
  };
  workerTrustElections: {
    listByWorker(
      workerId: string,
    ): Promise<Array<{
      employerId?: string | null;
      startYmd: string;
      endYmd?: string | null;
    }>>;
  };
}

export interface ResolvedGrantingWorkerPolicy extends ResolvedEmployerPolicy {
  /** Employer selected from the historical granting election/home assignment. */
  employerId: string | null;
  resolutionStatus: "resolved" | "missing" | "ambiguous";
}

interface EmployerPolicyCacheEntry {
  employerLabel: string | null;
  /** History rows sorted by date DESC, each with its joined policy. */
  history: Array<{ date: string; policy: Policy | null }>;
  denormPolicy: Policy | null;
}

/**
 * Per-run cache so per-worker scan loops don't re-fetch the same employer's
 * history (and the system default policy) once per worker. Create one per
 * batch run and pass it to every `resolveEmployerPolicyAsOf` call in that
 * run; single-shot callers can omit it.
 */
export interface PolicyResolutionCache {
  employers: Map<string, EmployerPolicyCacheEntry>;
  /** undefined = not looked up yet; null = looked up, none configured. */
  defaultPolicy: Policy | null | undefined;
}

export function createPolicyResolutionCache(): PolicyResolutionCache {
  return { employers: new Map(), defaultPolicy: undefined };
}

async function loadEmployerEntry(
  storage: PolicyResolutionStorage,
  employerId: string,
  cache: PolicyResolutionCache,
): Promise<EmployerPolicyCacheEntry> {
  const cached = cache.employers.get(employerId);
  if (cached) return cached;

  // The employer row and its history are independent reads — fetch them
  // side by side; history still only counts when the employer exists.
  const [employer, historyRowsIfEmployer] = await Promise.all([
    storage.employers.getEmployer(employerId),
    storage.employerPolicyHistory.getEmployerPolicyHistory(employerId),
  ]);
  const historyRows = employer ? historyRowsIfEmployer : [];
  const history = historyRows
    .map((row: any) => ({
      date: String(row.date).slice(0, 10),
      policy: (row.policy as Policy | null) ?? null,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  let denormPolicy: Policy | null = null;
  if (employer?.denormPolicyId) {
    denormPolicy =
      (await storage.policies.getPolicyById(employer.denormPolicyId)) ?? null;
  }

  const entry: EmployerPolicyCacheEntry = {
    employerLabel: employer ? employer.name || employer.siriusId || null : null,
    history,
    denormPolicy,
  };
  cache.employers.set(employerId, entry);
  return entry;
}

async function loadDefaultPolicy(
  storage: PolicyResolutionStorage,
  cache: PolicyResolutionCache,
): Promise<Policy | null> {
  if (cache.defaultPolicy !== undefined) return cache.defaultPolicy;
  let policy: Policy | null = null;
  const defaultVar = await storage.variables.getByName("policy_default");
  if (defaultVar?.value) {
    policy =
      (await storage.policies.getPolicyById(defaultVar.value as string)) ??
      null;
  }
  cache.defaultPolicy = policy;
  return policy;
}

/**
 * Resolve the policy in effect for `employerId` as of `asOfYmd`
 * (YYYY-MM-DD). Pass `employerId: null` to skip straight to the system
 * default. Never throws for a missing employer — falls through the chain.
 */
export async function resolveEmployerPolicyAsOf(
  storage: PolicyResolutionStorage,
  employerId: string | null | undefined,
  asOfYmd: string,
  cache: PolicyResolutionCache = createPolicyResolutionCache(),
): Promise<ResolvedEmployerPolicy> {
  if (employerId) {
    const entry = await loadEmployerEntry(storage, employerId, cache);
    const label = entry.employerLabel ? ` (${entry.employerLabel})` : "";
    const effective = entry.history.find((h) => h.date <= asOfYmd);
    if (effective?.policy) {
      return {
        policy: effective.policy,
        policySource: `Employer policy history${label}`,
      };
    }
    if (entry.denormPolicy) {
      return {
        policy: entry.denormPolicy,
        policySource: `Employer current policy${label}`,
      };
    }
  }

  const defaultPolicy = await loadDefaultPolicy(storage, cache);
  if (defaultPolicy) {
    return { policy: defaultPolicy, policySource: "System default policy" };
  }
  return { policy: null, policySource: "None" };
}

/**
 * Resolve a subscriber's granting policy as of a coverage month.  This is the
 * worker-facing companion to `resolveEmployerPolicyAsOf`: it obtains the
 * employer(s) from active historical elections (then the subscriber's home
 * employer), and only then applies employer policy history/current/default
 * fallback. Consumers must not use a dependent WMB's employer for this; an
 * unresolved or conflicting multi-election result is deliberately surfaced.
 */
export async function resolveGrantingWorkerPolicyAsOf(
  storage: GrantingPolicyResolutionStorage,
  workerId: string,
  asOfYmd: string,
  cache: PolicyResolutionCache = createPolicyResolutionCache(),
): Promise<ResolvedGrantingWorkerPolicy> {
  // Benefits scans select the granting election at the *last* day of the
  // coverage month, while policy/rate effective dating remains anchored to
  // the first day. Match that established convention so a mid-month employer
  // correction has the same grant attribution here as in WMB generation.
  const [year, month] = asOfYmd.slice(0, 7).split("-").map(Number);
  const electionAsOfYmd =
    Number.isInteger(year) && Number.isInteger(month)
      ? `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`
      : asOfYmd;
  const [elections, worker] = await Promise.all([
    storage.workerTrustElections.listByWorker(workerId),
    storage.workers.getWorker(workerId),
  ]);
  const electionEmployerIds = Array.from(
    new Set(
      elections
        .filter(
          (election) =>
            election.startYmd <= electionAsOfYmd &&
            (!election.endYmd || election.endYmd >= electionAsOfYmd),
        )
        .flatMap((election) =>
          election.employerId ? [election.employerId] : [],
        ),
    ),
  );
  const employerIds =
    electionEmployerIds.length > 0
      ? electionEmployerIds
      : [worker?.denormHomeEmployerId ?? null];
  const resolved = await Promise.all(
    employerIds.map((employerId) =>
      resolveEmployerPolicyAsOf(storage, employerId, asOfYmd, cache),
    ),
  );

  // Do not let one resolvable employer conceal another that is unresolvable.
  // A partial result is not sound billing configuration and must be surfaced,
  // rather than selecting a policy arbitrarily.
  if (resolved.some((result) => !result.policy)) {
    return {
      policy: null,
      policySource: "Unresolved granting policy",
      employerId: employerIds.length === 1 ? employerIds[0] : null,
      resolutionStatus: "missing",
    };
  }
  const policyIds = Array.from(new Set(resolved.map((result) => result.policy!.id)));
  if (policyIds.length !== 1) {
    return {
      policy: null,
      policySource: `Ambiguous granting policy (${policyIds.join(", ")})`,
      employerId: employerIds.length === 1 ? employerIds[0] : null,
      resolutionStatus: "ambiguous",
    };
  }
  const first = resolved[0];
  return {
    policy: first.policy,
    policySource: first.policySource,
    employerId: employerIds.length === 1 ? employerIds[0] : null,
    resolutionStatus: "resolved",
  };
}
