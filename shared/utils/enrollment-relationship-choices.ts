/** Only an explicit opt-out hides a type; legacy rows remain available. */
export function isWorkerElectionRelationshipAvailable(
  relationship: { data?: unknown },
): boolean {
  return (relationship.data as { availableToWorkersInElectionWizards?: unknown } | null)
    ?.availableToWorkersInElectionWizards !== false;
}
