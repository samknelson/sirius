import { useQuery } from "@tanstack/react-query";
import type { ChargePluginConfigProps } from "../registry";
import SharedConfigList from "../SharedConfigList";

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

export default function BtuStewardAttendanceConfigList({ pluginId }: ChargePluginConfigProps) {
  const { data: eventTypes = [] } = useQuery<EventType[]>({
    queryKey: ["/api/options/event-type"],
  });

  const getEventTypeNames = (eventTypeIds?: string[]) => {
    if (!eventTypeIds || eventTypeIds.length === 0) return "None configured";
    return eventTypeIds.map((id) => eventTypes.find((et) => et.id === id)?.name || id).join(", ");
  };

  return (
    <SharedConfigList<BtuStewardAttendanceSettings>
      pluginId={pluginId}
      title="BTU Steward Attendance Configurations"
      description="Award points to shop stewards when they attend configured event types"
      cardDescription="Each configuration awards points for the selected event types"
      emptyMessage="No steward attendance configurations yet."
      renderSummary={(config) => (
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
      )}
    />
  );
}
