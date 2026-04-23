import { storage } from "../storage";
import { logger } from "../logger";
import type { GbhetPensionAnnualSummary } from "@shared/schema/sitespecific/gbhet-pension/schema";

const VAR_CONTRIB_TARGET_ACCOUNT_VARIABLE = "gbhet_pension_var_contrib_target_account_id";
const SLA_ACCOUNT_VARIABLE = "gbhet_pension_sla_account_id";

export interface PayoutCalculatorInput {
  workerId: string;
  dobc: string;
  electionType: string;
  beneficiaryAge?: number | null;
  earlyRetirementReason?: string | null;
  factorYear?: number | null;
  normalRetirementAge?: number;
}

export interface PayoutCalculatorResult {
  workerName: string;
  dateOfBirth: string;
  dobc: string;
  subscriberAge: number;
  electionType: string;
  totalShares: string;
  currentShareValue: string;
  variableBenefit: string;
  variableBenefitMonthly: string;
  totalSla: string;
  totalSlaMonthly: string;
  accumulatedBenefit: string;
  accumulatedBenefitSource: "variable" | "sla";
  payoutFactor: string;
  payoutFactorDescription: string;
  aiFactor: string | null;
  aiFactorDescription: string | null;
  earlyRetirementFactor: string | null;
  earlyRetirementMonths: number | null;
  earlyRetirementAdjustment: string | null;
  earlyRetirementDescription: string | null;
  finalBenefitAmount: string;
  benefitType: "monthly" | "lump_sum";
  breakdown: string[];
}

export interface ComputeAllPayoutsInput {
  workerId: string;
  dobc: string;
  dot?: string | null;
  paymentDate?: string | null;
  earlyRetirementReason?: string | null;
  factorYear?: number | null;
  spouseDob?: string | null;
  normalRetirementAge?: number;
}

export interface ElectionTypeResult {
  electionType: string;
  label: string;
  benefitType: "monthly" | "lump_sum";
  payoutFactor: string | null;
  aiFactor: string | null;
  finalBenefitAmount: string | null;
  interestRate: string | null;
  interestMonths: number | null;
  interestAmount: string | null;
  finalAmountWithInterest: string | null;
  error: string | null;
}

export interface ComputeAllPayoutsResult {
  workerName: string;
  dateOfBirth: string;
  dobc: string;
  dot: string | null;
  paymentDate: string | null;
  subscriberAge: number;
  spouseDob: string | null;
  beneficiaryAge: number | null;
  totalShares: string;
  currentShareValue: string;
  variableBenefit: string;
  variableBenefitMonthly: string;
  totalSla: string;
  totalSlaMonthly: string;
  accumulatedBenefit: string;
  accumulatedBenefitSource: "variable" | "sla" | "ai705_annuity" | "ai705_share";
  aiFactor: string | null;
  aiFactorDescription: string | null;
  ai705: AI705Result | null;
  dotToDobcAI: DotToDobcAIResult | null;
  perYearAccruals: PerYearAccrual[] | null;
  earlyRetirementFactor: string | null;
  earlyRetirementMonths: number | null;
  earlyRetirementAdjustment: string | null;
  earlyRetirementDescription: string | null;
  lumpSumEligible: boolean;
  results: ElectionTypeResult[];
  breakdown: string[];
}

export interface WorkerPensionSummary {
  workerId: string;
  workerName: string;
  dateOfBirth: string | null;
  totalShares: string;
  totalSla: string;
  currentShareValue: string;
  accumulatedBenefit: string;
  qualifiedYears: number;
  earlyRetirementReasons: string[];
  availableElectionTypes: string[];
}

export interface AIYearDetail {
  aiDate: string;
  ageYear: number;
  ageMonth: number;
  interpolatedFactor: number;
  prevInterpolatedFactor: number;
  aiRatio: number;
  aiEarnedAnnuity: number;
  aiEarnedShare: number;
  aiRunningTotalAnnuity: number;
  aiRunningTotalShare: number;
  accruedBenefitEndAnnuity: number;
  accruedBenefitEndShare: number;
}

export type AI705YearDetail = AIYearDetail;

export interface AI705Result {
  applies: boolean;
  seventyHalfYearMonth: string | null;
  mrd: string | null;
  terminationDateTruncated: string | null;
  totalAnnuity: number;
  totalShares: number;
  aiRunningTotalAnnuity: number;
  aiRunningTotalShare: number;
  accruedBenefitAnnuity: number;
  accruedBenefitShare: number;
  accruedBenefitShareValue: number;
  ai705Total: number;
  ai705Source: "annuity" | "share";
  yearDetails: AIYearDetail[];
  breakdown: string[];
}

export interface DotToDobcAIResult {
  applies: boolean;
  startDate: string;
  startAge: number;
  endDate: string;
  endAge: number;
  totalAnnuity: number;
  totalShares: number;
  aiRunningTotalAnnuity: number;
  aiRunningTotalShare: number;
  accruedBenefitAnnuity: number;
  accruedBenefitShare: number;
  accruedBenefitShareValue: number;
  dotToDobcTotal: number;
  dotToDobcSource: "annuity" | "share";
  yearDetails: AIYearDetail[];
  breakdown: string[];
}

export interface PerYearAccrual {
  year: number;
  plan: string;
  annuity: number;
  shares: number;
}

function calcAgeAtDate(dob: Date, atDate: Date): { ageYear: number; ageMonth: number } {
  let ageYear = atDate.getFullYear() - dob.getFullYear();
  let ageMonth = atDate.getMonth() - dob.getMonth();
  if (atDate.getDate() < dob.getDate()) {
    ageMonth--;
  }
  if (ageMonth < 0) {
    ageYear--;
    ageMonth += 12;
  }
  return { ageYear, ageMonth };
}

function interpolateAiFactor(ageYear: number, ageMonth: number, aiFactorsByAge: Map<number, number>): number {
  const factorAtAge = aiFactorsByAge.get(ageYear) ?? 0;
  const factorAtAgePlus1 = aiFactorsByAge.get(ageYear + 1) ?? 0;
  if (factorAtAge === 0 && factorAtAgePlus1 === 0) return 0;
  return ((factorAtAge * (12 - ageMonth)) + (factorAtAgePlus1 * ageMonth)) / 12;
}

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function runAIInterpolation(
  dob: Date,
  aiDates: Date[],
  totalAnnuity: number,
  totalShares: number,
  shareValueAtPayout: number,
  aiFactorsByAge: Map<number, number>,
  breakdown: string[],
  labelPrefix: string,
): {
  aiRunningTotalAnnuity: number;
  aiRunningTotalShare: number;
  accruedBenefitAnnuity: number;
  accruedBenefitShare: number;
  accruedBenefitShareValue: number;
  total: number;
  source: "annuity" | "share";
  yearDetails: AIYearDetail[];
} {
  let prevInterpolatedFactor = 0;
  let aiRunningTotalAnnuity = 0;
  let aiRunningTotalShare = 0;
  const yearDetails: AIYearDetail[] = [];

  for (let i = 0; i < aiDates.length; i++) {
    const aiDate = aiDates[i];
    const aiDateStr = formatDateStr(aiDate);
    const { ageYear, ageMonth } = calcAgeAtDate(dob, aiDate);

    const interpFactor = interpolateAiFactor(ageYear, ageMonth, aiFactorsByAge);

    let aiRatio = 0;
    if (prevInterpolatedFactor > 0 && interpFactor > 0) {
      aiRatio = (prevInterpolatedFactor / interpFactor) - 1;
    }

    const accruedBeginAnnuity = totalAnnuity + aiRunningTotalAnnuity;
    const accruedBeginShare = totalShares + aiRunningTotalShare;

    const aiEarnedAnnuity = aiRatio * accruedBeginAnnuity;
    const aiEarnedShare = aiRatio * accruedBeginShare;

    aiRunningTotalAnnuity += aiEarnedAnnuity;
    aiRunningTotalShare += aiEarnedShare;

    const accruedEndAnnuity = totalAnnuity + aiRunningTotalAnnuity;
    const accruedEndShare = totalShares + aiRunningTotalShare;

    yearDetails.push({
      aiDate: aiDateStr,
      ageYear,
      ageMonth,
      interpolatedFactor: interpFactor,
      prevInterpolatedFactor,
      aiRatio,
      aiEarnedAnnuity,
      aiEarnedShare,
      aiRunningTotalAnnuity,
      aiRunningTotalShare,
      accruedBenefitEndAnnuity: accruedEndAnnuity,
      accruedBenefitEndShare: accruedEndShare,
    });

    breakdown.push(`${labelPrefix} AI for ${aiDateStr}: age ${ageYear}y ${ageMonth}m, factor=${interpFactor.toFixed(2)}, ratio=${aiRatio.toFixed(6)}, AI annuity=$${aiEarnedAnnuity.toFixed(2)}, AI shares=${aiEarnedShare.toFixed(6)}`);

    prevInterpolatedFactor = interpFactor;
  }

  const accruedBenefitAnnuity = totalAnnuity + aiRunningTotalAnnuity;
  const accruedBenefitShare = totalShares + aiRunningTotalShare;
  const accruedBenefitShareValue = accruedBenefitShare * shareValueAtPayout;

  const total = Math.max(accruedBenefitAnnuity, accruedBenefitShareValue);
  const source = accruedBenefitAnnuity >= accruedBenefitShareValue ? "annuity" as const : "share" as const;

  return {
    aiRunningTotalAnnuity,
    aiRunningTotalShare,
    accruedBenefitAnnuity,
    accruedBenefitShare,
    accruedBenefitShareValue,
    total,
    source,
    yearDetails,
  };
}

function compute705ActuarialIncrease(
  dateOfBirth: string,
  terminationDate: string,
  totalAnnuity: number,
  totalShares: number,
  shareValueAtPayout: number,
  aiFactorsByAge: Map<number, number>,
): AI705Result {
  const breakdown: string[] = [];

  const dob = new Date(dateOfBirth);
  const seventyHalfDate = new Date(dob);
  seventyHalfDate.setFullYear(seventyHalfDate.getFullYear() + 70);
  seventyHalfDate.setMonth(seventyHalfDate.getMonth() + 6);
  const seventyHalfYearMonth = `${seventyHalfDate.getFullYear()}-${seventyHalfDate.getMonth() + 1}`;
  breakdown.push(`70.5 year-month: ${seventyHalfYearMonth}`);

  const mrdYear = seventyHalfDate.getFullYear() + 1;
  const mrd = `${mrdYear}-04-01`;
  breakdown.push(`Mandatory Retirement Date (MRD): ${mrd}`);

  const termDate = new Date(terminationDate);
  const termTruncated = new Date(termDate.getFullYear(), termDate.getMonth(), 1);
  const terminationDateTruncated = formatDateStr(termTruncated);
  breakdown.push(`End date: ${terminationDate}`);
  breakdown.push(`End date truncated: ${terminationDateTruncated}`);

  const mrdDate = new Date(mrd);
  if (termDate < mrdDate) {
    return {
      applies: false,
      seventyHalfYearMonth,
      mrd,
      terminationDateTruncated,
      totalAnnuity,
      totalShares,
      aiRunningTotalAnnuity: 0,
      aiRunningTotalShare: 0,
      accruedBenefitAnnuity: totalAnnuity,
      accruedBenefitShare: totalShares,
      accruedBenefitShareValue: totalShares * shareValueAtPayout,
      ai705Total: Math.max(totalAnnuity, totalShares * shareValueAtPayout),
      ai705Source: totalAnnuity >= totalShares * shareValueAtPayout ? "annuity" : "share",
      yearDetails: [],
      breakdown,
    };
  }

  const aiDates: Date[] = [];
  aiDates.push(mrdDate);

  let nextJan = new Date(mrdDate.getFullYear() + 1, 0, 1);
  while (nextJan <= termTruncated) {
    aiDates.push(new Date(nextJan));
    nextJan = new Date(nextJan.getFullYear() + 1, 0, 1);
  }

  if (termTruncated > mrdDate) {
    const lastAiDate = aiDates[aiDates.length - 1];
    if (termTruncated.getTime() !== lastAiDate.getTime()) {
      aiDates.push(termTruncated);
    }
  }

  const result = runAIInterpolation(dob, aiDates, totalAnnuity, totalShares, shareValueAtPayout, aiFactorsByAge, breakdown, "70.5");

  breakdown.push(`Final accrued benefit (annuity): $${result.accruedBenefitAnnuity.toFixed(2)}`);
  breakdown.push(`Final accrued benefit (shares): ${result.accruedBenefitShare.toFixed(6)} × $${shareValueAtPayout.toFixed(6)} = $${result.accruedBenefitShareValue.toFixed(2)}`);
  breakdown.push(`AI 70.5 Total (greater of annuity vs share value): $${result.total.toFixed(2)} (${result.source} used)`);

  return {
    applies: true,
    seventyHalfYearMonth,
    mrd,
    terminationDateTruncated,
    totalAnnuity,
    totalShares,
    aiRunningTotalAnnuity: result.aiRunningTotalAnnuity,
    aiRunningTotalShare: result.aiRunningTotalShare,
    accruedBenefitAnnuity: result.accruedBenefitAnnuity,
    accruedBenefitShare: result.accruedBenefitShare,
    accruedBenefitShareValue: result.accruedBenefitShareValue,
    ai705Total: result.total,
    ai705Source: result.source,
    yearDetails: result.yearDetails,
    breakdown,
  };
}

function computeDotToDobcAI(
  dateOfBirth: string,
  dot: string,
  dobc: string,
  totalAnnuity: number,
  totalShares: number,
  shareValueAtPayout: number,
  aiFactorsByAge: Map<number, number>,
  normalRetirementAge: number = 65,
): DotToDobcAIResult {
  const breakdown: string[] = [];

  const dob = new Date(dateOfBirth);
  const dobcDate = new Date(dobc);
  const dotDate = new Date(dot);

  const birthday65 = new Date(dob);
  birthday65.setFullYear(birthday65.getFullYear() + normalRetirementAge);

  const startDate = dotDate > birthday65 ? dotDate : birthday65;
  const startDateStr = formatDateStr(startDate);
  const endDateStr = formatDateStr(dobcDate);

  const startAge = calculateAge(dateOfBirth, startDateStr);
  const endAge = calculateAge(dateOfBirth, endDateStr);

  breakdown.push(`DoT-to-DoBC AI: start=${startDateStr} (age ${startAge}), end=${endDateStr} (age ${endAge})`);
  breakdown.push(`Start date = later of ${normalRetirementAge}th birthday (${formatDateStr(birthday65)}) and DoT (${dot})`);

  if (startDate >= dobcDate) {
    breakdown.push(`Start date >= DoBC — no DoT-to-DoBC AI applies`);
    return {
      applies: false,
      startDate: startDateStr,
      startAge,
      endDate: endDateStr,
      endAge,
      totalAnnuity,
      totalShares,
      aiRunningTotalAnnuity: 0,
      aiRunningTotalShare: 0,
      accruedBenefitAnnuity: totalAnnuity,
      accruedBenefitShare: totalShares,
      accruedBenefitShareValue: totalShares * shareValueAtPayout,
      dotToDobcTotal: Math.max(totalAnnuity, totalShares * shareValueAtPayout),
      dotToDobcSource: totalAnnuity >= totalShares * shareValueAtPayout ? "annuity" : "share",
      yearDetails: [],
      breakdown,
    };
  }

  const { ageYear: startAgeYear, ageMonth: startAgeMonth } = calcAgeAtDate(dob, startDate);
  const { ageYear: endAgeYear, ageMonth: endAgeMonth } = calcAgeAtDate(dob, dobcDate);

  const startFactor = interpolateAiFactor(startAgeYear, startAgeMonth, aiFactorsByAge);
  const endFactor = interpolateAiFactor(endAgeYear, endAgeMonth, aiFactorsByAge);

  breakdown.push(`Start age: ${startAgeYear}y ${startAgeMonth}m, interpolated factor: ${startFactor.toFixed(2)}`);
  breakdown.push(`DoBC age: ${endAgeYear}y ${endAgeMonth}m, interpolated factor: ${endFactor.toFixed(2)}`);

  let aiRatio = 0;
  if (startFactor > 0 && endFactor > 0) {
    aiRatio = (startFactor / endFactor) - 1;
  }
  breakdown.push(`AI ratio: ${startFactor.toFixed(2)} / ${endFactor.toFixed(2)} - 1 = ${aiRatio.toFixed(6)}`);

  const aiEarnedAnnuity = aiRatio * totalAnnuity;
  const aiEarnedShare = aiRatio * totalShares;

  const accruedBenefitAnnuity = totalAnnuity + aiEarnedAnnuity;
  const accruedBenefitShare = totalShares + aiEarnedShare;
  const accruedBenefitShareValue = accruedBenefitShare * shareValueAtPayout;

  const total = Math.max(accruedBenefitAnnuity, accruedBenefitShareValue);
  const source: "annuity" | "share" = accruedBenefitAnnuity >= accruedBenefitShareValue ? "annuity" : "share";

  breakdown.push(`AI earned annuity: $${aiEarnedAnnuity.toFixed(2)}`);
  breakdown.push(`AI earned shares: ${aiEarnedShare.toFixed(6)}`);
  breakdown.push(`Accrued benefit (annuity): $${accruedBenefitAnnuity.toFixed(2)}`);
  breakdown.push(`Accrued benefit (shares): ${accruedBenefitShare.toFixed(6)} × $${shareValueAtPayout.toFixed(6)} = $${accruedBenefitShareValue.toFixed(2)}`);
  breakdown.push(`DoT-to-DoBC Total (greater of annuity vs share value): $${total.toFixed(2)} (${source} used)`);

  const yearDetail: AIYearDetail = {
    aiDate: endDateStr,
    ageYear: endAgeYear,
    ageMonth: endAgeMonth,
    interpolatedFactor: endFactor,
    prevInterpolatedFactor: startFactor,
    aiRatio,
    aiEarnedAnnuity,
    aiEarnedShare,
    aiRunningTotalAnnuity: aiEarnedAnnuity,
    aiRunningTotalShare: aiEarnedShare,
    accruedBenefitEndAnnuity: accruedBenefitAnnuity,
    accruedBenefitEndShare: accruedBenefitShare,
  };

  return {
    applies: true,
    startDate: startDateStr,
    startAge,
    endDate: endDateStr,
    endAge,
    totalAnnuity,
    totalShares,
    aiRunningTotalAnnuity: aiEarnedAnnuity,
    aiRunningTotalShare: aiEarnedShare,
    accruedBenefitAnnuity,
    accruedBenefitShare,
    accruedBenefitShareValue,
    dotToDobcTotal: total,
    dotToDobcSource: source,
    yearDetails: [yearDetail],
    breakdown,
  };
}

function cleanVariableValue(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/^["']|["']$/g, "").trim();
  return cleaned || null;
}

function calculateAge(birthDate: string, atDate: string): number {
  const birth = new Date(birthDate);
  const at = new Date(atDate);
  let age = at.getFullYear() - birth.getFullYear();
  const monthDiff = at.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function monthsBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

async function resolveTargetAccountId(): Promise<string | null> {
  const variable = await storage.variables.getByName(VAR_CONTRIB_TARGET_ACCOUNT_VARIABLE);
  return cleanVariableValue(variable?.value);
}

async function resolveSlaAccountId(): Promise<string | null> {
  const variable = await storage.variables.getByName(SLA_ACCOUNT_VARIABLE);
  return cleanVariableValue(variable?.value);
}

export async function getWorkerPensionSummary(workerId: string): Promise<WorkerPensionSummary> {
  const worker = await storage.workers.getWorker(workerId);
  if (!worker) throw new Error("Worker not found");

  const contact = await storage.contacts.getContact(worker.contactId);
  if (!contact) throw new Error("Worker contact not found");

  const workerName = [contact.given, contact.family].filter(Boolean).join(" ");
  const dateOfBirth = contact.birthDate || null;

  let totalShares = "0.00";
  let totalSla = "0.00";
  let currentShareValue = "0.00";
  let accumulatedBenefit = "0.00";

  const targetAccountId = await resolveTargetAccountId();
  if (targetAccountId) {
    const ea = await storage.ledger.ea.getByEntityAndAccount("worker", workerId, targetAccountId);
    if (ea) {
      totalShares = await storage.ledger.ea.getBalance(ea.id);
    }
  }

  const slaAccountId = await resolveSlaAccountId();
  if (slaAccountId) {
    const ea = await storage.ledger.ea.getByEntityAndAccount("worker", workerId, slaAccountId);
    if (ea) {
      totalSla = await storage.ledger.ea.getBalance(ea.id);
    }
  }

  const today = new Date().toISOString().split("T")[0];
  const shareValueRecord = await storage.gbhetPension.shareValues.getCurrentValue(today);
  if (shareValueRecord) {
    currentShareValue = shareValueRecord.shareValue;
  }

  const sharesNum = parseFloat(totalShares);
  const shareValNum = parseFloat(currentShareValue);
  if (sharesNum && shareValNum) {
    accumulatedBenefit = (sharesNum * shareValNum).toFixed(2);
  }

  let qualifiedYears = 0;
  try {
    const planYears = await storage.gbhetPension.planYears.getAll();
    for (const py of planYears) {
      const summary = await storage.gbhetPension.annualSummary.getByWorkerAndYear(workerId, py.year);
      if (summary?.qualified) qualifiedYears++;
    }
  } catch {}

  let earlyRetirementReasons: string[] = [];
  try {
    const factors = await storage.gbhetPension.earlyRetirementFactors.getAll();
    earlyRetirementReasons = factors.map(f => f.reason);
  } catch {}

  const availableElectionTypes = ["life", "5cc", "lump", "lumpearly", "50js", "75js", "100js"];

  return {
    workerId,
    workerName,
    dateOfBirth,
    totalShares,
    totalSla,
    currentShareValue,
    accumulatedBenefit,
    qualifiedYears,
    earlyRetirementReasons,
    availableElectionTypes,
  };
}

export async function computePayout(input: PayoutCalculatorInput): Promise<PayoutCalculatorResult> {
  const {
    workerId,
    dobc,
    electionType,
    beneficiaryAge,
    earlyRetirementReason,
    factorYear,
    normalRetirementAge = 65,
  } = input;

  const breakdown: string[] = [];

  const worker = await storage.workers.getWorker(workerId);
  if (!worker) throw new Error("Worker not found");

  const contact = await storage.contacts.getContact(worker.contactId);
  if (!contact) throw new Error("Worker contact not found");
  if (!contact.birthDate) throw new Error("Worker does not have a date of birth on file");

  const workerName = [contact.given, contact.family].filter(Boolean).join(" ");
  const dateOfBirth = contact.birthDate;
  const subscriberAge = calculateAge(dateOfBirth, dobc);
  breakdown.push(`Subscriber age at DoBC: ${subscriberAge} (DOB: ${dateOfBirth}, DoBC: ${dobc})`);

  const targetAccountId = await resolveTargetAccountId();
  let totalShares = "0.00";
  if (targetAccountId) {
    const ea = await storage.ledger.ea.getByEntityAndAccount("worker", workerId, targetAccountId);
    if (ea) {
      totalShares = await storage.ledger.ea.getBalance(ea.id);
    }
  }
  breakdown.push(`Total accumulated shares: ${totalShares}`);

  const shareValueRecord = await storage.gbhetPension.shareValues.getCurrentValue(dobc);
  const currentShareValue = shareValueRecord?.shareValue || "0.00";
  breakdown.push(`Share value (as of ${dobc}): $${currentShareValue}`);

  const sharesNum = parseFloat(totalShares);
  const shareValNum = parseFloat(currentShareValue);
  const variableBenefit = sharesNum * shareValNum;
  breakdown.push(`Variable benefit (annual): ${sharesNum} shares × $${currentShareValue} = $${variableBenefit.toFixed(2)}`);

  let totalSla = "0.00";
  const slaAccountId = await resolveSlaAccountId();
  if (slaAccountId) {
    const ea = await storage.ledger.ea.getByEntityAndAccount("worker", workerId, slaAccountId);
    if (ea) {
      totalSla = await storage.ledger.ea.getBalance(ea.id);
    }
  }
  const slaNum = parseFloat(totalSla);
  breakdown.push(`SLA floor benefit (annual): $${slaNum.toFixed(2)}`);

  const accumulatedBenefit = Math.max(variableBenefit, slaNum);
  const usedSla = slaNum > variableBenefit;
  breakdown.push(`Accumulated benefit (annual, greater of variable vs SLA): $${accumulatedBenefit.toFixed(2)}${usedSla ? " (SLA floor used)" : " (variable benefit used)"}`);

  const isLumpType = electionType === "lump" || electionType === "lumpearly";
  const isJsType = ["50js", "75js", "100js"].includes(electionType);
  const effectiveFactorYear = isLumpType ? (factorYear || new Date(dobc).getFullYear()) : 0;
  const effectiveBenAge = isJsType ? (beneficiaryAge ?? null) : null;

  const payoutFactorRecord = await storage.gbhetPension.payoutFactors.lookup(
    electionType,
    subscriberAge,
    effectiveBenAge,
    effectiveFactorYear,
  );

  if (!payoutFactorRecord) {
    const parts = [`election type "${electionType}"`, `subscriber age ${subscriberAge}`];
    if (isJsType && effectiveBenAge != null) parts.push(`beneficiary age ${effectiveBenAge}`);
    if (isLumpType) parts.push(`factor year ${effectiveFactorYear}`);
    throw new Error(`No payout factor found for ${parts.join(", ")}. Check that the factor tables are loaded.`);
  }

  const payoutFactor = payoutFactorRecord.factor;
  let payoutFactorDesc = `Payout factor for ${electionType}, age ${subscriberAge}`;
  if (isJsType && effectiveBenAge != null) payoutFactorDesc += `, beneficiary age ${effectiveBenAge}`;
  if (isLumpType) payoutFactorDesc += `, year ${effectiveFactorYear}`;
  payoutFactorDesc += `: ${payoutFactor}`;
  breakdown.push(payoutFactorDesc);

  let earlyRetirementFactor: string | null = null;
  let earlyRetirementMonths: number | null = null;
  let earlyRetirementAdjustment: string | null = null;
  let earlyRetirementDesc: string | null = null;

  if (earlyRetirementReason && subscriberAge < normalRetirementAge) {
    const erFactorRecord = await storage.gbhetPension.earlyRetirementFactors.getByReason(earlyRetirementReason);
    if (erFactorRecord) {
      earlyRetirementFactor = erFactorRecord.monthlyFactor;
      const dobcDate = new Date(dobc);
      const normalRetDate = new Date(dateOfBirth);
      normalRetDate.setFullYear(normalRetDate.getFullYear() + normalRetirementAge);
      const monthsDiff = (normalRetDate.getFullYear() - dobcDate.getFullYear()) * 12 + (normalRetDate.getMonth() - dobcDate.getMonth());
      earlyRetirementMonths = Math.max(0, monthsDiff);
      const monthlyReduction = parseFloat(earlyRetirementFactor);
      const totalReduction = monthlyReduction * earlyRetirementMonths;
      earlyRetirementAdjustment = Math.max(0, 1 - totalReduction).toFixed(6);
      earlyRetirementDesc = `Early retirement: ${earlyRetirementMonths} months early × ${earlyRetirementFactor}/month = ${(totalReduction * 100).toFixed(2)}% reduction (factor: ${earlyRetirementAdjustment})`;
      breakdown.push(earlyRetirementDesc);
    }
  }

  const payoutFactorNum = parseFloat(payoutFactor);
  const earlyAdjNum = earlyRetirementAdjustment ? parseFloat(earlyRetirementAdjustment) : 1;

  let finalBenefit: number;
  let benefitType: "monthly" | "lump_sum";

  if (isLumpType) {
    finalBenefit = accumulatedBenefit * payoutFactorNum;
    benefitType = "lump_sum";
    breakdown.push(`Lump sum: $${accumulatedBenefit.toFixed(2)} × ${payoutFactor} = $${finalBenefit.toFixed(2)}`);
  } else {
    const annualBenefit = accumulatedBenefit * payoutFactorNum * earlyAdjNum;
    finalBenefit = annualBenefit / 12;
    benefitType = "monthly";
    const parts = [`$${accumulatedBenefit.toFixed(2)} × ${payoutFactor}`];
    if (earlyRetirementAdjustment) parts.push(` × ${earlyRetirementAdjustment} (early ret.)`);
    breakdown.push(`Annual benefit: ${parts.join("")} = $${annualBenefit.toFixed(2)}`);
    breakdown.push(`Monthly benefit: $${annualBenefit.toFixed(2)} / 12 = $${finalBenefit.toFixed(2)}`);
  }

  return {
    workerName,
    dateOfBirth,
    dobc,
    subscriberAge,
    electionType,
    totalShares,
    currentShareValue,
    variableBenefit: variableBenefit.toFixed(2),
    variableBenefitMonthly: (variableBenefit / 12).toFixed(2),
    totalSla,
    totalSlaMonthly: (slaNum / 12).toFixed(2),
    accumulatedBenefit: accumulatedBenefit.toFixed(2),
    accumulatedBenefitSource: usedSla ? "sla" as const : "variable" as const,
    payoutFactor,
    payoutFactorDescription: payoutFactorDesc,
    aiFactor: null,
    aiFactorDescription: null,
    earlyRetirementFactor,
    earlyRetirementMonths,
    earlyRetirementAdjustment,
    earlyRetirementDescription: earlyRetirementDesc,
    finalBenefitAmount: finalBenefit.toFixed(2),
    benefitType,
    breakdown,
  };
}

const ELECTION_TYPE_LABELS: Record<string, string> = {
  life: "Life Annuity",
  "5cc": "5-Year Certain & Continuous",
  lump: "Lump Sum",
  lumpearly: "Lump Sum (Early Retirement)",
  "50js": "50% Joint & Survivor",
  "75js": "75% Joint & Survivor",
  "100js": "100% Joint & Survivor",
};

export async function computeAllPayouts(input: ComputeAllPayoutsInput): Promise<ComputeAllPayoutsResult> {
  const {
    workerId,
    dobc,
    dot,
    paymentDate,
    earlyRetirementReason,
    factorYear,
    spouseDob,
    normalRetirementAge = 65,
  } = input;

  const breakdown: string[] = [];

  const worker = await storage.workers.getWorker(workerId);
  if (!worker) throw new Error("Worker not found");

  const contact = await storage.contacts.getContact(worker.contactId);
  if (!contact) throw new Error("Worker contact not found");
  if (!contact.birthDate) throw new Error("Worker does not have a date of birth on file");

  const workerName = [contact.given, contact.family].filter(Boolean).join(" ");
  const dateOfBirth = contact.birthDate;
  const subscriberAge = calculateAge(dateOfBirth, dobc);
  breakdown.push(`Subscriber age at DoBC: ${subscriberAge} (DOB: ${dateOfBirth}, DoBC: ${dobc})`);

  if (dot) {
    breakdown.push(`Date of Termination (DoT): ${dot}`);
  }
  if (paymentDate) {
    breakdown.push(`Payment Date: ${paymentDate}`);
  }

  let beneficiaryAge: number | null = null;
  if (spouseDob) {
    beneficiaryAge = calculateAge(spouseDob, dobc);
    breakdown.push(`Beneficiary age at DoBC: ${beneficiaryAge} (DOB: ${spouseDob})`);
  }

  const targetAccountId = await resolveTargetAccountId();
  let totalShares = "0.00";
  if (targetAccountId) {
    const ea = await storage.ledger.ea.getByEntityAndAccount("worker", workerId, targetAccountId);
    if (ea) {
      totalShares = await storage.ledger.ea.getBalance(ea.id);
    }
  }
  const sharesNum = parseFloat(totalShares);
  breakdown.push(`Total accumulated shares: ${totalShares}`);

  const shareValueRecord = await storage.gbhetPension.shareValues.getCurrentValue(dobc);
  const currentShareValue = shareValueRecord?.shareValue || "0.00";
  const shareValNum = parseFloat(currentShareValue);
  breakdown.push(`Share value (as of ${dobc}): $${currentShareValue}`);

  const variableBenefit = sharesNum * shareValNum;
  breakdown.push(`Variable benefit (annual): $${variableBenefit.toFixed(2)}`);

  let totalSla = "0.00";
  const slaAccountId = await resolveSlaAccountId();
  if (slaAccountId) {
    const ea = await storage.ledger.ea.getByEntityAndAccount("worker", workerId, slaAccountId);
    if (ea) {
      totalSla = await storage.ledger.ea.getBalance(ea.id);
    }
  }
  const slaNum = parseFloat(totalSla);
  breakdown.push(`SLA floor benefit (annual): $${slaNum.toFixed(2)}`);

  let perYearAccruals: PerYearAccrual[] | null = null;
  let ai705Result: AI705Result | null = null;
  let dotToDobcAIResult: DotToDobcAIResult | null = null;
  let accumulatedBenefit: number;
  let accumulatedBenefitSource: "variable" | "sla" | "ai705_annuity" | "ai705_share";

  const dob = new Date(dateOfBirth);
  const seventyHalf = new Date(dob);
  seventyHalf.setFullYear(seventyHalf.getFullYear() + 70);
  seventyHalf.setMonth(seventyHalf.getMonth() + 6);
  const mrdYear = seventyHalf.getFullYear() + 1;
  const mrdDate = new Date(`${mrdYear}-04-01`);
  const dobcDate = new Date(dobc);
  const ai705EndDate = dot ? new Date(dot) : dobcDate;
  const is705Eligible = ai705EndDate >= mrdDate;

  const allAiFactors = await storage.gbhetPension.aiFactors.getAll();
  const aiFactorsByAge = new Map<number, number>();
  for (const f of allAiFactors) {
    aiFactorsByAge.set(f.age, parseFloat(f.factor));
  }

  if (is705Eligible) {
    breakdown.push(`--- 70.5 Actuarial Increase Calculation ---`);
    breakdown.push(`70.5 AI period: MRD to ${dot ? "DoT" : "DoBC"} (${formatDateStr(ai705EndDate)})`);

    let annualSummaries: GbhetPensionAnnualSummary[] = [];
    try {
      annualSummaries = await storage.gbhetPension.annualSummary.getByWorker(workerId);
    } catch {}

    perYearAccruals = annualSummaries
      .filter((s) => (s.annualAccrual && parseFloat(s.annualAccrual) > 0) || s.qualified)
      .map((s) => {
        const data = (s.data ?? {}) as { plan?: string };
        return {
          year: s.year,
          plan: data.plan || "A",
          annuity: s.annualAccrual ? parseFloat(s.annualAccrual) : 0,
          shares: 0,
        };
      });

    breakdown.push(`Annuity (SLA, annual): $${slaNum.toFixed(2)}`);
    breakdown.push(`Total shares: ${sharesNum.toFixed(6)}`);

    ai705Result = compute705ActuarialIncrease(
      dateOfBirth,
      formatDateStr(ai705EndDate),
      slaNum,
      sharesNum,
      shareValNum,
      aiFactorsByAge,
    );

    if (ai705Result.applies) {
      accumulatedBenefit = ai705Result.ai705Total;
      accumulatedBenefitSource = ai705Result.ai705Source === "annuity" ? "ai705_annuity" : "ai705_share";
      breakdown.push(...ai705Result.breakdown);
    } else {
      accumulatedBenefit = Math.max(variableBenefit, slaNum);
      accumulatedBenefitSource = slaNum > variableBenefit ? "sla" : "variable";
      breakdown.push(`${dot ? "DoT" : "DoBC"} before MRD — 70.5 AI does not apply`);
      breakdown.push(`Accumulated benefit (annual, greater of variable vs SLA): $${accumulatedBenefit.toFixed(2)}${accumulatedBenefitSource === "sla" ? " (SLA floor used)" : " (variable benefit used)"}`);
    }
  } else {
    accumulatedBenefit = Math.max(variableBenefit, slaNum);
    const usedSla = slaNum > variableBenefit;
    accumulatedBenefitSource = usedSla ? "sla" : "variable";
    breakdown.push(`Accumulated benefit (annual, greater of variable vs SLA): $${accumulatedBenefit.toFixed(2)}${usedSla ? " (SLA floor used)" : " (variable benefit used)"}`);
  }

  if (dot) {
    breakdown.push(`--- DoT-to-DoBC Actuarial Increase ---`);

    let dotToDobcInputAnnuity = slaNum;
    let dotToDobcInputShares = sharesNum;
    if (ai705Result?.applies) {
      dotToDobcInputAnnuity = ai705Result.accruedBenefitAnnuity;
      dotToDobcInputShares = ai705Result.accruedBenefitShare;
      breakdown.push(`DoT-to-DoBC inputs include 70.5 AI: annuity=$${dotToDobcInputAnnuity.toFixed(2)}, shares=${dotToDobcInputShares.toFixed(6)}`);
    }

    dotToDobcAIResult = computeDotToDobcAI(
      dateOfBirth,
      dot,
      dobc,
      dotToDobcInputAnnuity,
      dotToDobcInputShares,
      shareValNum,
      aiFactorsByAge,
      normalRetirementAge,
    );

    if (dotToDobcAIResult.applies) {
      accumulatedBenefit = dotToDobcAIResult.dotToDobcTotal;
      accumulatedBenefitSource = dotToDobcAIResult.dotToDobcSource === "annuity" ? "sla" : "variable";
      breakdown.push(...dotToDobcAIResult.breakdown);
    } else {
      breakdown.push(`DoT-to-DoBC AI does not apply (start >= end)`);
    }
  }

  let earlyRetirementFactor: string | null = null;
  let earlyRetirementMonths: number | null = null;
  let earlyRetirementAdjustment: string | null = null;
  let earlyRetirementDesc: string | null = null;

  if (earlyRetirementReason && subscriberAge < normalRetirementAge) {
    const erFactorRecord = await storage.gbhetPension.earlyRetirementFactors.getByReason(earlyRetirementReason);
    if (erFactorRecord) {
      earlyRetirementFactor = erFactorRecord.monthlyFactor;
      const normalRetDate = new Date(dateOfBirth);
      normalRetDate.setFullYear(normalRetDate.getFullYear() + normalRetirementAge);
      const monthsDiff = (normalRetDate.getFullYear() - dobcDate.getFullYear()) * 12 + (normalRetDate.getMonth() - dobcDate.getMonth());
      earlyRetirementMonths = Math.max(0, monthsDiff);
      const monthlyReduction = parseFloat(earlyRetirementFactor);
      const totalReduction = monthlyReduction * earlyRetirementMonths;
      earlyRetirementAdjustment = Math.max(0, 1 - totalReduction).toFixed(6);
      earlyRetirementDesc = `Early retirement (${earlyRetirementReason}): ${earlyRetirementMonths} months early × ${earlyRetirementFactor}/month = ${(totalReduction * 100).toFixed(2)}% reduction (factor: ${earlyRetirementAdjustment})`;
      breakdown.push(earlyRetirementDesc);
    }
  }
  const earlyAdjNum = earlyRetirementAdjustment ? parseFloat(earlyRetirementAdjustment) : 1;

  const electionTypes = ["life", "5cc", "lump", "lumpearly", "50js", "75js", "100js"];

  const effectiveFactorYear = factorYear || new Date(dobc).getFullYear();

  const results: ElectionTypeResult[] = [];

  for (const et of electionTypes) {
    const isLump = et === "lump" || et === "lumpearly";
    const isJs = ["50js", "75js", "100js"].includes(et);
    const label = ELECTION_TYPE_LABELS[et] || et;
    const benefitType: "monthly" | "lump_sum" = isLump ? "lump_sum" : "monthly";

    try {
      if (isJs && (beneficiaryAge === null || beneficiaryAge === undefined)) {
        results.push({
          electionType: et,
          label,
          benefitType,
          payoutFactor: null,
          aiFactor: null,
          finalBenefitAmount: null,
          interestRate: null,
          interestMonths: null,
          interestAmount: null,
          finalAmountWithInterest: null,
          error: `Beneficiary date of birth required for ${label}`,
        });
        continue;
      }
      const payoutFactorRecord = await storage.gbhetPension.payoutFactors.lookup(
        et,
        subscriberAge,
        isJs ? beneficiaryAge : null,
        isLump ? effectiveFactorYear : 0,
      );

      if (!payoutFactorRecord) {
        const parts = [`age ${subscriberAge}`];
        if (isJs && beneficiaryAge != null) parts.push(`beneficiary age ${beneficiaryAge}`);
        if (isLump) parts.push(`year ${effectiveFactorYear}`);
        results.push({
          electionType: et,
          label,
          benefitType,
          payoutFactor: null,
          aiFactor: null,
          finalBenefitAmount: null,
          interestRate: null,
          interestMonths: null,
          interestAmount: null,
          finalAmountWithInterest: null,
          error: `No payout factor found for ${parts.join(", ")}`,
        });
        continue;
      }

      const pfNum = parseFloat(payoutFactorRecord.factor);
      let finalAmount: number;
      if (isLump) {
        finalAmount = accumulatedBenefit * pfNum;
      } else {
        const annualAmount = accumulatedBenefit * pfNum * earlyAdjNum;
        finalAmount = annualAmount / 12;
      }

      results.push({
        electionType: et,
        label,
        benefitType,
        payoutFactor: payoutFactorRecord.factor,
        aiFactor: null,
        finalBenefitAmount: finalAmount.toFixed(2),
        interestRate: null,
        interestMonths: null,
        interestAmount: null,
        finalAmountWithInterest: null,
        error: null,
      });
    } catch (err: any) {
      results.push({
        electionType: et,
        label,
        benefitType,
        payoutFactor: null,
        aiFactor: null,
        finalBenefitAmount: null,
        interestRate: null,
        interestMonths: null,
        interestAmount: null,
        finalAmountWithInterest: null,
        error: err.message || "Calculation failed",
      });
    }
  }

  const lifeResult = results.find(r => r.electionType === "life" && r.finalBenefitAmount != null);
  const monthlyLifeBenefit = lifeResult ? parseFloat(lifeResult.finalBenefitAmount!) : 0;
  const lumpSumEligible = monthlyLifeBenefit <= 100;

  if (paymentDate && lumpSumEligible) {
    const interestMonths = monthsBetween(dobc, paymentDate);
    if (interestMonths > 0) {
      const dobcYear = new Date(dobc).getFullYear();
      let annualRate = 0;
      try {
        const interestRateRecord = await storage.gbhetPension.interestRates.getByYear(dobcYear);
        if (interestRateRecord) {
          annualRate = parseFloat(interestRateRecord.rate);
        }
      } catch {}

      if (annualRate > 0) {
        const monthlyRate = annualRate / 12;
        breakdown.push(`--- Lump Sum Interest Calculation ---`);
        breakdown.push(`Monthly life benefit: $${monthlyLifeBenefit.toFixed(2)} (${lumpSumEligible ? "≤ $100, lump sum eligible" : "> $100, not eligible"})`);
        breakdown.push(`Interest rate for ${dobcYear}: ${(annualRate * 100).toFixed(4)}% annual, ${(monthlyRate * 100).toFixed(6)}% monthly`);
        breakdown.push(`Interest months (DoBC to Payment Date): ${interestMonths}`);

        for (const r of results) {
          if (r.benefitType === "lump_sum" && r.finalBenefitAmount != null && r.error == null) {
            const lumpAmount = parseFloat(r.finalBenefitAmount);
            const interestAmount = lumpAmount * monthlyRate * interestMonths;
            const finalWithInterest = lumpAmount + interestAmount;
            r.interestRate = annualRate.toString();
            r.interestMonths = interestMonths;
            r.interestAmount = interestAmount.toFixed(2);
            r.finalAmountWithInterest = finalWithInterest.toFixed(2);
            breakdown.push(`${r.label}: $${lumpAmount.toFixed(2)} + interest $${interestAmount.toFixed(2)} (${interestMonths} mo × ${(monthlyRate * 100).toFixed(6)}%) = $${finalWithInterest.toFixed(2)}`);
          }
        }
      }
    }
  }

  return {
    workerName,
    dateOfBirth,
    dobc,
    dot: dot || null,
    paymentDate: paymentDate || null,
    subscriberAge,
    spouseDob: spouseDob || null,
    beneficiaryAge,
    totalShares,
    currentShareValue,
    variableBenefit: variableBenefit.toFixed(2),
    variableBenefitMonthly: (variableBenefit / 12).toFixed(2),
    totalSla,
    totalSlaMonthly: (slaNum / 12).toFixed(2),
    accumulatedBenefit: accumulatedBenefit.toFixed(2),
    accumulatedBenefitSource,
    aiFactor: null,
    aiFactorDescription: null,
    ai705: ai705Result,
    dotToDobcAI: dotToDobcAIResult,
    perYearAccruals,
    earlyRetirementFactor,
    earlyRetirementMonths,
    earlyRetirementAdjustment,
    earlyRetirementDescription: earlyRetirementDesc,
    lumpSumEligible,
    results,
    breakdown,
  };
}
