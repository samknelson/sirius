import { Users } from "lucide-react";
import { DashboardPluginProps } from "../registry";
import { useDashboardContent } from "../useDashboardContent";
import { UsageCard, type UsageContent } from "../UsageCard";

/**
 * Who called us, and how much. What they called, and when, lives on the admin
 * Incoming Stats page, which this card links to.
 */
export function WsUsageByClient(_props: DashboardPluginProps) {
  const { data, isLoading } = useDashboardContent<UsageContent>("ws-usage-byclient");

  if (isLoading) return null;
  if (!data) return null;

  return (
    <UsageCard
      title="Web Services - Incoming"
      icon={Users}
      testId="ws-usage-byclient"
      columnLabel="Client"
      windowLabel="Incoming calls"
      emptyLabel={`No client called us in the last ${data.windowDays} days.`}
      data={data}
    />
  );
}
