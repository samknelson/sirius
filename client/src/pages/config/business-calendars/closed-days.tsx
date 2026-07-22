import {
  BusinessCalendarLayout,
  useBusinessCalendarLayout,
} from "@/components/layouts/BusinessCalendarLayout";
import { DayToggleTab } from "./day-toggle-tab";

function ClosedDaysContent() {
  const { full } = useBusinessCalendarLayout();
  return (
    <DayToggleTab
      title="Closed Days"
      description="Single days on which the business is closed. Click a day on the calendar to toggle it."
      emptyText="No closed days."
      endpoint="manual-byday"
      rows={full.manualByday}
      testIdPrefix="closed-day"
      addErrorFallback="Failed to add closed day."
      deleteErrorFallback="Failed to delete closed day."
    />
  );
}

export default function BusinessCalendarClosedDaysPage() {
  return (
    <BusinessCalendarLayout activeTab="closed-days">
      <ClosedDaysContent />
    </BusinessCalendarLayout>
  );
}
