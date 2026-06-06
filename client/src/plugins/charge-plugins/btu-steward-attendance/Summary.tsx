import { useQuery } from "@tanstack/react-query";
import type { ChargePluginSummaryProps } from "../registry";

interface BtuStewardAttendanceSettings {
  amount?: number;
  eventTypeIds?: string[];
  attendedStatuses?: string[];
}

interface EventType {
  id: string;
  name: string;
  category: string;
}

export default function BtuStewardAttendanceSummary({
  config,
}: ChargePluginSummaryProps<BtuStewardAttendanceSettings>) {
  const { data: eventTypes = [] } = useQuery<EventType[]>({
    queryKey: ["/api/options/event-type"],
  });

  const getEventTypeNames = (eventTypeIds?: string[]) => {
    if (!eventTypeIds || eventTypeIds.length === 0) return "None configured";
    return eventTypeIds.map((id) => eventTypes.find((et) => et.id === id)?.name || id).join(", ");
  };

  return (
    <>
      <p data-testid={`text-config-points-${config.id}`}>
        <strong>Points per Attendance:</strong> {config.settings.amount ?? "Not set"}
      </p>
      <p data-testid={`text-config-event-types-${config.id}`}>
        <strong>Event Types:</strong> {getEventTypeNames(config.settings.eventTypeIds)}
      </p>
      <p data-testid={`text-config-statuses-${config.id}`}>
        <strong>Attended Statuses:</strong> {config.settings.attendedStatuses?.join(", ") || "Not set"}
      </p>
    </>
  );
}
