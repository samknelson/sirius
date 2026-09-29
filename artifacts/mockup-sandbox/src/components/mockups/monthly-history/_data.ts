export interface Month {
  year: number;
  month: number;
  label: string;
}

export interface BenefitIcon {
  name: string;
  icon: string | null;
  color: string | null;
}

export interface MonthlyCoverageRow {
  coverageMonth: Month;
  workMonth: Month;
  employerHours?: Array<{ employerId: string | null; employerName: string; reported: number | null }> | null;
  hours: { reported: number | null; required: number | null } | null;
  status: "active" | "inactive" | "unknown";
  reasons: string[];
  medical: string[];
  dental: string[];
  other: string[];
  medicalBenefitIcons?: BenefitIcon[];
  dentalBenefitIcons?: BenefitIcon[];
  otherBenefitIcons?: BenefitIcon[];
  charge: string | null;
}

export interface MonthlyCoveragePage {
  months: MonthlyCoverageRow[];
  total: number;
  showCharges: boolean;
  partial: boolean;
}

const monthLabels = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function month(year: number, monthNumber: number): Month {
  return { year, month: monthNumber, label: `${monthLabels[monthNumber - 1]} ${year}` };
}

const benefitsByStatus: Record<MonthlyCoverageRow["status"], {
  medical: string[];
  dental: string[];
  other: BenefitIcon[];
}> = {
  active: {
    medical: ["BlueCross PPO 2500"],
    dental: ["Delta Dental PPO"],
    other: [
      { name: "Vision plan", icon: "Eye", color: "#2563eb" },
      { name: "Health savings account", icon: "Wallet", color: "#0f766e" },
    ],
  },
  inactive: {
    medical: [],
    dental: [],
    other: [],
  },
  unknown: {
    medical: [],
    dental: [],
    other: [],
  },
};

function statusFor(year: number, monthNumber: number): MonthlyCoverageRow["status"] {
  if (year > 2025 || (year === 2025 && monthNumber >= 6)) return "active";
  if (year === 2025 && monthNumber >= 3) return "inactive";
  if (year === 2025 && monthNumber === 2) return "unknown";
  if (year === 2025 && monthNumber === 1) return "active";
  if (year === 2024 && monthNumber >= 11) return "active";
  if (year === 2024 && monthNumber === 10) return "inactive";
  return "unknown";
}

function createRow(year: number, monthNumber: number): MonthlyCoverageRow {
  const status = statusFor(year, monthNumber);
  const coverageDate = new Date(year, monthNumber - 1);
  coverageDate.setMonth(coverageDate.getMonth() - 3);
  const workMonth = month(coverageDate.getFullYear(), coverageDate.getMonth() + 1);
  const benefits = benefitsByStatus[status];
  const monthOffset = (year - 2024) * 12 + monthNumber;
  const reportedHours = status === "unknown"
    ? null
    : status === "inactive"
      ? 74 + (monthOffset * 7 % 42)
      : 132 + (monthOffset * 7 % 35);
  const hours = reportedHours === null
    ? null
    : { reported: reportedHours, required: 130 };

  return {
    coverageMonth: month(year, monthNumber),
    workMonth,
    employerHours: reportedHours === null
      ? null
      : [
          { employerId: "employer-northstar", employerName: "Northstar Logistics", reported: reportedHours - 18 },
          ...(monthOffset % 3 === 0
            ? [{ employerId: "employer-riverbend", employerName: "Riverbend Distribution", reported: 18 }]
            : []),
        ],
    hours,
    status,
    reasons: status === "inactive"
      ? monthNumber === 10 && year === 2024
        ? ["Insufficient hours reported for the work month"]
        : ["Reported hours were below the applicable threshold"]
      : [],
    medical: benefits.medical,
    dental: benefits.dental,
    other: benefits.other.map((benefit) => benefit.name),
    medicalBenefitIcons: benefits.medical.map((name) => ({
      name,
      icon: "HeartPulse",
      color: "#2563eb",
    })),
    dentalBenefitIcons: benefits.dental.map((name) => ({
      name,
      icon: "Smile",
      color: "#0891b2",
    })),
    otherBenefitIcons: benefits.other,
    charge: status === "unknown" ? null : status === "active" ? "42.00" : "0.00",
  };
}

// The coverage and work dates are a continuous monthly sequence, newest first.
export const MONTHLY_COVERAGE_ROWS: MonthlyCoverageRow[] = Array.from(
  { length: 25 },
  (_, index) => {
    const date = new Date(2026, 8 - index);
    return createRow(date.getFullYear(), date.getMonth() + 1);
  },
);

export const MONTHLY_COVERAGE_PAGE: MonthlyCoveragePage = {
  months: MONTHLY_COVERAGE_ROWS,
  total: MONTHLY_COVERAGE_ROWS.length,
  showCharges: true,
  partial: true,
};