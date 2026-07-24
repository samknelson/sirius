import { useMemo } from "react";
import { DispatchJobTypeLayout, useDispatchJobTypeLayout } from "@/components/layouts/DispatchJobTypeLayout";
import { usePageTitle } from "@/contexts/PageTitleContext";
import GenericPluginConfigsPage from "@/pages/admin/plugin-configs";

/**
 * "Eligibility Plugins" tab on the dispatch job type detail page. Reuses the
 * generic plugin-configs page (the same one behind
 * /admin/plugin-configs/dispatch-eligibility) in embedded mode, with the
 * jobType filter locked to the current job type: the list is pre-filtered,
 * the Job Type filter is hidden, and configs created here are automatically
 * associated with this job type.
 */
function EligibilityPluginsContent() {
  const { jobType } = useDispatchJobTypeLayout();
  const lockedFilters = useMemo(() => ({ jobType: jobType.id }), [jobType.id]);

  return (
    <GenericPluginConfigsPage
      kind="dispatch-eligibility"
      lockedFilters={lockedFilters}
      embedded
    />
  );
}

export default function DispatchJobTypeEligibilityPluginsPage() {
  usePageTitle("Eligibility Plugins");
  return (
    <DispatchJobTypeLayout activeTab="eligibility-plugins">
      <EligibilityPluginsContent />
    </DispatchJobTypeLayout>
  );
}
