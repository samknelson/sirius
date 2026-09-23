export interface BaoCoverageSummary {
  workerId: string;
  state: "available" | "unlinked" | "unavailable";
  current: {
    coverageMonth: { year: number; month: number; label: string };
    workMonth: { year: number; month: number; label: string };
    hours: { reported: number; required: number; thresholdMet: boolean } | null;
    coverage: "covered" | "not-covered" | "stale" | "unavailable";
    causes: { hours: boolean | null; balance: boolean | null };
  };
  balance: {
    available: boolean;
    totals: Array<{ currency: string; amount: string; formatted: string }>;
  };
  future: Array<{
    workMonth: { year: number; month: number; label: string };
    coverageMonth: { year: number; month: number; label: string };
    hours: { reported: number; required: number; thresholdMet: boolean };
    status: "met" | "below" | "pending";
    deadline: string;
  }>;
}

export const baoCoverageSummary: BaoCoverageSummary = {
  workerId: "worker/123",
  state: "available",
  current: {
    coverageMonth: { year: 2027, month: 2, label: "February 2027" },
    workMonth: { year: 2026, month: 11, label: "November 2026" },
    hours: { reported: 100, required: 100, thresholdMet: true },
    coverage: "covered",
    causes: { hours: null, balance: null },
  },
  balance: {
    available: true,
    totals: [{ currency: "USD", amount: "0.00", formatted: "$0.00" }],
  },
  future: [
    {
      workMonth: { year: 2026, month: 12, label: "December 2026" },
      coverageMonth: { year: 2027, month: 3, label: "March 2027" },
      hours: { reported: 100, required: 100, thresholdMet: true },
      status: "met",
      deadline: "2027-01-20",
    },
    {
      workMonth: { year: 2027, month: 1, label: "January 2027" },
      coverageMonth: { year: 2027, month: 4, label: "April 2027" },
      hours: { reported: 49.5, required: 100, thresholdMet: false },
      status: "pending",
      deadline: "2027-02-20",
    },
  ],
};