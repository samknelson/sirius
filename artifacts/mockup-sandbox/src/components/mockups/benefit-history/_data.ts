export interface BenefitHistoryRecord {
  id: string;
  month: number;
  year: number;
  benefit: { id: string; name: string };
  employer: { id: string; name: string };
  /** A source relation marks a benefit received through another worker. */
  sourceRelationId: string | null;
  sourceRelation: {
    id: string;
    relationTypeName: string | null;
    sourceWorkerId: string | null;
    sourceWorkerName: string;
  } | null;
}

export const benefitOptions = [
  { id: "benefit-medical", name: "Medical" },
  { id: "benefit-dental", name: "Dental" },
  { id: "benefit-vision", name: "Vision" },
  { id: "benefit-life", name: "Basic Life" },
];

export const employerOptions = [
  { id: "employer-northstar", name: "Northstar Manufacturing" },
  { id: "employer-lakeside", name: "Lakeside Health Partners" },
  { id: "employer-pioneer", name: "Pioneer Community Services" },
];

const receivedThroughPartner: BenefitHistoryRecord["sourceRelation"] = {
  id: "relation-illustrative-01",
  relationTypeName: "Spouse",
  sourceWorkerId: null,
  sourceWorkerName: "Jordan Lee",
};

const medicalMonths: BenefitHistoryRecord[] = [];
for (let year = 2022; year <= 2024; year += 1) {
  for (let month = 1; month <= 12; month += 1) {
    // One uncovered illustrative month makes the otherwise stable history visible.
    if (year === 2023 && month === 7) continue;
    const isLaterEmployer = year === 2024;
    const isReceivedCoverage = year === 2024;
    medicalMonths.push({
      id: `medical-${year}-${String(month).padStart(2, "0")}`,
      month,
      year,
      benefit: { id: "benefit-medical", name: "Medical" },
      employer: isLaterEmployer ? employerOptions[1] : employerOptions[0],
      sourceRelationId: isReceivedCoverage ? "relation-illustrative-01" : null,
      sourceRelation: isReceivedCoverage ? receivedThroughPartner : null,
    });
  }
}

const additionalBenefits: BenefitHistoryRecord[] = [
  {
    id: "medical-2025-01",
    month: 1,
    year: 2025,
    benefit: { id: "benefit-medical", name: "Medical" },
    employer: employerOptions[1],
    sourceRelationId: null,
    sourceRelation: null,
  },
  {
    id: "dental-2025-01",
    month: 1,
    year: 2025,
    benefit: { id: "benefit-dental", name: "Dental" },
    employer: employerOptions[1],
    sourceRelationId: null,
    sourceRelation: null,
  },
  {
    id: "vision-2025-01",
    month: 1,
    year: 2025,
    benefit: { id: "benefit-vision", name: "Vision" },
    employer: employerOptions[1],
    sourceRelationId: null,
    sourceRelation: null,
  },
  {
    id: "life-2024-12",
    month: 12,
    year: 2024,
    benefit: { id: "benefit-life", name: "Basic Life" },
    employer: employerOptions[1],
    sourceRelationId: null,
    sourceRelation: null,
  },
  {
    id: "dental-2023-08",
    month: 8,
    year: 2023,
    benefit: { id: "benefit-dental", name: "Dental" },
    employer: employerOptions[0],
    sourceRelationId: null,
    sourceRelation: null,
  },
  {
    id: "vision-2023-08-received",
    month: 8,
    year: 2023,
    benefit: { id: "benefit-vision", name: "Vision" },
    employer: employerOptions[2],
    sourceRelationId: "relation-illustrative-01",
    sourceRelation: receivedThroughPartner,
  },
  {
    id: "dental-2022-01",
    month: 1,
    year: 2022,
    benefit: { id: "benefit-dental", name: "Dental" },
    employer: employerOptions[0],
    sourceRelationId: null,
    sourceRelation: null,
  },
];

/** Illustrative requested-worker benefit history for the standalone preview. */
export const illustrativeBenefitHistory: BenefitHistoryRecord[] = [
  ...medicalMonths,
  ...additionalBenefits,
].sort((a, b) => b.year - a.year || b.month - a.month || a.id.localeCompare(b.id));

export interface IllustrativeDependentProvidedBenefit {
  id: string;
  dependentName: string;
  relationship: string;
  month: number;
  year: number;
  benefitName: string;
  employerName: string;
  providedByWorkerName: string;
}

/**
 * Separate, explicitly illustrative design data only.
 * GET /api/workers/:id/benefits returns the requested worker's records, not
 * benefits that worker provides to dependents. sourceRelationId means a
 * record was received from another worker; it does not mean provided.
 */
export const illustrativeBenefitsProvidedToDependents: IllustrativeDependentProvidedBenefit[] = [
  {
    id: "dependent-medical-2025-01",
    dependentName: "Casey Lee",
    relationship: "Child",
    month: 1,
    year: 2025,
    benefitName: "Medical",
    employerName: "Lakeside Health Partners",
    providedByWorkerName: "Alex Morgan",
  },
  {
    id: "dependent-dental-2025-01",
    dependentName: "Casey Lee",
    relationship: "Child",
    month: 1,
    year: 2025,
    benefitName: "Dental",
    employerName: "Lakeside Health Partners",
    providedByWorkerName: "Alex Morgan",
  },
];