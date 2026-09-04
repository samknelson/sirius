import { Server } from "lucide-react";
import { DashboardPluginProps } from "../registry";
import { useDashboardContent } from "../useDashboardContent";
import { UsageCard, type UsageContent } from "../UsageCard";

/**
 * What other people called us for, per service. The per-day and per-operation
 * detail lives on the admin Incoming Stats page, which this card links to.
 */
export function WsUsageByPlugin(_props: DashboardPluginProps) {
  const { data, isLoading } = useDashboardContent<UsageContent>("ws-usage-byplugin");

  if (isLoading) return null;
  if (!data) return null;

  return (
    <UsageCard
      title="Web Services - Incoming"
      icon={Server}
      testId="ws-usage-byplugin"
      columnLabel="Service"
      windowLabel="Incoming calls"
      emptyLabel={`No incoming calls were served in the last ${data.windowDays} days.`}
      data={data}
    />
  );
}
