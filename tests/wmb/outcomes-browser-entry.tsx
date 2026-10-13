import React from "react";
import { createRoot } from "react-dom/client";
import { BenefitDetailsModal } from "@/pages/admin/wmb-scan-detail";
import "@/index.css";

const failed = new URLSearchParams(location.search).has("execution");
const action = (benefitName: string, scanType: "start" | "continue", extra = {}) => ({
  workerId: "child", sourceRelationId: "relation", benefitId: benefitName, benefitName,
  scanType, eligible: false, action: "none", executed: false,
  pluginResults: [{ pluginKey: "ageout", eligible: false, reason: "Dependent Child fixture: Worker is 26 years 1 month old, above maximum age of 26 years" }],
  ...extra,
});
createRoot(document.getElementById("root")!).render(
  <BenefitDetailsModal open onClose={() => {}} entry={{
    id: "queue", workerId: "subscriber", status: failed ? "failed" : "success",
    triggerSource: "fixture", attempts: 1, completedAt: null, lastError: failed ? "Plugin error: fixture outage" : null,
    workerSiriusId: 1, workerDisplayName: "Subscriber fixture",
    resultSummary: {
      policyName: "Fixture policy",
      people: [{ workerId: "child", sourceRelationId: "relation", name: "Child fixture" }],
      actions: [
        action("Medical refused start", "start"),
        action("Dental refused continuation", "continue"),
        action("Removed coverage", "continue", { action: "delete", executed: true }),
        ...(failed ? [action("Execution failure", "continue", { executionError: "Plugin error: fixture outage" }),
          action("Create failure", "start", { eligible: true, action: "create", executionError: "Write failed" })] : []),
      ],
    },
  }} />,
);
