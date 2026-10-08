/** A side-effecting upload's record is reconciliation evidence, not a draft. */
export function isBaoProcessAdmitted(wizard: { type: string; data?: unknown }): boolean {
  if (wizard.type !== "bao_monthly_hours") return false;
  const data = wizard.data as { progress?: { process?: { status?: string; protocol?: string } } } | null;
  return Boolean(data?.progress?.process?.status ||
    data?.progress?.process?.protocol === "bao-process-v1" ||
    (data && Object.prototype.hasOwnProperty.call(data, "processResults")));
}

export const BAO_PROCESS_DELETE_REFUSAL =
  "This BAO upload has entered Process and must be retained for tracking and reconciliation. It cannot be deleted, including after completion or an unconfirmed final status.";
