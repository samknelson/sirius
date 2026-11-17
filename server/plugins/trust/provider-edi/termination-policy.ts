import type { JsonSchema } from "@shared/json-schema-form";

/** Bounded replay, not a delivery ledger or an unlimited historical export. */
export const MAX_TERMINATION_LOOKBACK_MONTHS = 12;
export const terminationProperties: Record<string, JsonSchema> = {
  explicitSubscriberTerminations: {
    type: "boolean", title: "Explicit subscriber terminations", default: true,
    description: "Include evidenced ended subscribers. Does not remove active members. Off means termination by omission.",
  },
  explicitDependentTerminations: {
    type: "boolean", title: "Explicit dependent terminations", default: false,
    description: "Include evidenced ended dependents independently of subscribers. Off means termination by omission.",
  },
  terminationLookbackMonths: {
    type: "integer", title: "Termination lookback months", minimum: 1,
    maximum: MAX_TERMINATION_LOOKBACK_MONTHS, default: 1,
    description: "Completed calendar months before the reporting month (1–12). November with 1 includes October coverage ends; with 2 includes September and October.",
  },
};

/** Written at creation only. Never use these defaults when reading old runs. */
export const newRunTerminationPolicy = {
  explicitSubscriberTerminations: true,
  explicitDependentTerminations: false,
  terminationLookbackMonths: 1,
};

export function terminationPolicyFields(policy: ReturnType<typeof readTerminationPolicy>) {
  return {
    explicitSubscriberTerminations: policy.subscribers,
    explicitDependentTerminations: policy.dependents,
    terminationLookbackMonths: policy.months,
  };
}

/** Only the saved run or its historical snapshot is authoritative, never live config. */
export function effectiveRunTerminationPolicy(data: Record<string, any>) {
  return readTerminationPolicy(data.terminationPolicy ?? data.config?.data ?? {});
}

export function assertTerminationContract(pluginId: string, policy: ReturnType<typeof readTerminationPolicy>) {
  const blocker = terminationContractBlocker(pluginId);
  if ((policy.subscribers || policy.dependents) && blocker) {
    throw new Error(`Explicit termination generation blocked: ${blocker} Turn both settings off in Parameters and Save to retain omission mode.`);
  }
}

export function readTerminationPolicy(data: Record<string, unknown> = {}) {
  for (const name of ["explicitSubscriberTerminations", "explicitDependentTerminations"]) {
    if (data[name] !== undefined && typeof data[name] !== "boolean") {
      throw new Error(`${name} must be a boolean`);
    }
  }
  const months = data.terminationLookbackMonths === undefined ? 1 : data.terminationLookbackMonths;
  if (typeof months !== "number" || !Number.isInteger(months) || months < 1 ||
      months > MAX_TERMINATION_LOOKBACK_MONTHS) {
    throw new Error("Termination lookback months must be an integer from 1 to 12");
  }
  return {
    subscribers: data.explicitSubscriberTerminations === true,
    dependents: data.explicitDependentTerminations === true,
    months,
  };
}

export const monthIndex = (year: number, month: number) => year * 12 + month - 1;
export function monthParts(index: number) {
  return { year: Math.floor(index / 12), month: index % 12 + 1 };
}
export function monthStart(index: number): string {
  const { year, month } = monthParts(index);
  return `${year}-${String(month).padStart(2, "0")}-01`;
}
export function monthEnd(index: number): string {
  const { year, month } = monthParts(index);
  return `${year}-${String(month).padStart(2, "0")}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
}
export function terminationWindow(asOf: string, months: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
      !Number.isFinite(Date.parse(asOf)) || new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf) {
    throw new Error("Termination reporting date must be a valid YYYY-MM-DD date");
  }
  const report = monthIndex(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)));
  return { report, firstEnd: report - months, lastEnd: report - 1 };
}

/** Evidence inventory: see docs/edi/termination-policy.md. No invented status codes. */
export function terminationContractBlocker(id: string): string | null {
  switch (id) {
    case "sitespecific-smf-delta":
    case "sitespecific-smf-hinge":
    case "sitespecific-smf-mlk":
      return null;
    case "sitespecific-smf-carelon":
      return "Carelon MSTACD: the reference only establishes A/C for active/COBRA members, not the status for an explicit termination.";
    case "sitespecific-smf-dentwell":
      return "Dentwell / Dyntl (LADC) Status: confirm whether blank is valid with TerminationDate, or supply the required termination code.";
    case "sitespecific-smf-vsp":
      return "VSP Subscriber Status Code: A/C is documented only for active/COBRA members; explicit termination coding is unverified.";
    case "sitespecific-bao-healthnet":
      return "Health Net Pay Status Code: AC/CO does not establish explicit termination coding for subscribers or dependents.";
    case "sitespecific-bao-kaiser":
      return "Kaiser Current Eligibility Status / Eligibility Status: blank validity with Termination Date is unverified.";
    case "sitespecific-smf-expressscripts":
      return "Express Scripts Coverage Code Status: blank validity with Participant Expiration Date is unverified.";
    default:
      return "No explicit termination contract has been documented for this membership carrier.";
  }
}
