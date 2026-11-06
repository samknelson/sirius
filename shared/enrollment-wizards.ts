/** Guided worker enrollment, distinct from manual election management. */
export function isEnrollmentWizard(type: string): boolean {
  return [
    "benefit_election_enrollment",
    "open_enrollment_enrollment",
    "life_event_enrollment",
    "bao_cobra_enrollment",
  ].includes(type);
}
