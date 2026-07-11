import { registerWizardPlugin } from "../registry";
import type { WizardPlugin } from "../types";
import { createEnrollmentFoundation } from "../enrollment/foundation";
import { isComponentEnabledSync } from "../../../services/component-cache";

const WIZARD_TYPE = "open_enrollment_enrollment";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Open Enrollment.
 *
 * Offered only while today falls inside an admin-configured Open Enrollment
 * window (see the `open_enrollment_windows` table + its admin config page).
 * The wizard reuses the shared enrollment foundation, so it presents every
 * benefit the worker is currently qualified for — including benefits they
 * have newly become eligible for — via the "start" eligibility scan.
 *
 * It differs from first-time enrollment only in:
 *  - `enrollmentType: "open_enrollment"` (stamped onto the posted election),
 *  - the `prepareCreateData` gate, which refuses to start unless a window is
 *    open and forces the election's effective date to January 1 of the
 *    window's plan year (`forcedStartYmd`).
 */
const foundation = createEnrollmentFoundation({
  wizardType: WIZARD_TYPE,
  enrollmentType: "open_enrollment",
  prepareCreateData: async (storage) => {
    if (!isComponentEnabledSync("trust.elections")) {
      return {
        error:
          "Open Enrollment is unavailable because the Trust Elections component is disabled.",
      };
    }
    const window = await storage.openEnrollmentWindows.getActiveWindow(
      todayYmd(),
    );
    if (!window) {
      return {
        error:
          "Open Enrollment is not currently open. It can only be started during a configured enrollment window.",
      };
    }
    const forcedStartYmd = `${window.planYear}-01-01`;
    return {
      data: {
        forcedStartYmd,
        // Seed startYmd so the effective-date step reads as completed from the
        // start — the date is fixed and needs no operator input.
        startYmd: forcedStartYmd,
        openEnrollmentPlanYear: window.planYear,
        openEnrollmentWindowId: window.id,
      },
    };
  },
});

export const openEnrollmentEnrollmentPlugin: WizardPlugin = {
  id: WIZARD_TYPE,
  name: "Open Enrollment",
  description:
    "Run Open Enrollment for a worker while an enrollment window is open: pick the employer/policy, select from every benefit the worker currently qualifies for, add dependents, capture a signature, and post the election. The effective date is fixed to January 1 of the plan year.",
  requiredComponent: "trust.benefits",
  requiredPolicy: "staff",
  category: "enrollment",
  launchSchema: {
    type: "object",
    properties: {
      workerId: {
        type: "string",
        title: "Worker",
        description: "The worker being enrolled",
      },
    },
    required: ["workerId"],
  },
  create: foundation.create,
  prepareUpdate: foundation.prepareUpdate,
  steps: foundation.steps,
};

registerWizardPlugin(openEnrollmentEnrollmentPlugin);
