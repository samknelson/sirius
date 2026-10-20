import { addDaysYmd, addMonthsYmd, COBRA_GRACE_PERIOD_DAYS } from "./cobra";

export interface CobraMonthEvidence {
  ym: string;
  caseChargeCents: number;
  paymentCents: number;
  /** Statement allocations do not name a case. A competing positive entry,
   * including a closed case's premium, makes their attribution unprovable. */
  hasOtherObligation?: boolean;
}

export interface CobraLifecycleInput {
  electedYmd: string | null;
  effectiveYmd: string;
  initialDeadlineYmd: string | null;
  maxPeriodYmd: string | null;
  todayYmd: string;
  currentClosed: boolean;
  restoredBenefits?: boolean;
  months: CobraMonthEvidence[];
}

export interface CobraLifecycleDecision {
  status?: "New" | "Pending First Payment" | "Enrolled" | "Delinquent" | "Closed";
  paymentStatus?: "paid" | "grace" | "delinquent" | null;
  initialSatisfied?: boolean;
  blockers: string[];
}

/** Policy: the initial obligation includes coverage start through election month.
 * Only a positive, case-attributed posted premium and sufficient cleared,
 * posted allocations in EACH statement month prove payment. Other credits and
 * other months cannot stand in for that evidence. No forfeiture is inferred.
 */
export function decideCobraLifecycle(input: CobraLifecycleInput): CobraLifecycleDecision {
  if (input.currentClosed) return { blockers: [] };
  if (input.maxPeriodYmd && input.todayYmd > input.maxPeriodYmd) {
    return { status: "Closed", blockers: [] };
  }
  if (!input.electedYmd) {
    return {
      status: input.restoredBenefits ? "Closed" : "New",
      paymentStatus: null,
      blockers: [],
    };
  }
  if (!input.initialDeadlineYmd) return { blockers: ["Initial payment deadline is missing"] };
  const start = input.effectiveYmd.slice(0, 7);
  const election = input.electedYmd.slice(0, 7);
  const initialEnd = election > start ? election : start;
  const evidence = new Map(input.months.map((m) => [m.ym, m]));
  const blockers: string[] = input.months
    .filter((m) => m.ym >= start && m.ym <= input.todayYmd.slice(0, 7) && m.hasOtherObligation)
    .map((m) => `Payment attribution is ambiguous in ${m.ym}: other posted obligations share this statement month`);
  const unpaidInitial: string[] = [];
  // Statutory case periods bound this loop; malformed windows are refused.
  let count = 0;
  for (let ym = start; ym <= initialEnd; ym = addMonthsYmd(`${ym}-01`, 1).slice(0, 7)) {
    if (++count > 60) return { blockers: ["Initial obligation exceeds supported case period"] };
    const month = evidence.get(ym);
    if (!month || month.caseChargeCents <= 0) blockers.push(`No posted case premium for ${ym}`);
    else if (month.paymentCents < month.caseChargeCents) unpaidInitial.push(ym);
  }
  if (blockers.length) return { blockers, initialSatisfied: false };
  const initialSatisfied = unpaidInitial.length === 0;
  const unpaid = input.months.filter((m) =>
    m.ym >= start && m.ym <= input.todayYmd.slice(0, 7) &&
    m.caseChargeCents > 0 && m.paymentCents < m.caseChargeCents,
  );
  const overdue = unpaid.some((m) => {
    let graceEnd = m.ym <= initialEnd
      ? input.initialDeadlineYmd!
      : addDaysYmd(`${m.ym}-01`, COBRA_GRACE_PERIOD_DAYS);
    // Preserve the existing later-of-initial-and-periodic deadline policy,
    // but anchor periodic grace to the actual unpaid obligation's month.
    if (input.initialDeadlineYmd! > graceEnd) graceEnd = input.initialDeadlineYmd!;
    return input.todayYmd > graceEnd;
  });
  return {
    status: overdue ? "Delinquent" : initialSatisfied ? "Enrolled" : "Pending First Payment",
    paymentStatus: overdue ? "delinquent" : unpaid.length ? "grace" : "paid",
    initialSatisfied,
    blockers,
  };
}
