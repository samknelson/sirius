import type { Wizard } from "@shared/schema";
import { isEnrollmentWizard } from "@shared/enrollment-wizards";
export { isEnrollmentWizard } from "@shared/enrollment-wizards";

/** Saved identity is never inferred from request data. Old unscoped drafts
 * remain staff-only, even when their saved worker happens to be the viewer. */
export function enrollmentIdentityError(wizard: Wizard): string | undefined {
  if (!isEnrollmentWizard(wizard.type)) return;
  const data = wizard.data as Record<string, any> | null;
  if (!data?.workerId || (wizard.entityId && wizard.entityId !== data.workerId) ||
      (data.launchArguments?.workerId && data.launchArguments.workerId !== data.workerId) ||
      (data.coveredPersonWorkerId && data.coveredPersonWorkerId !== data.workerId)) {
    return "Enrollment worker identity does not match its authorized scope";
  }
}
