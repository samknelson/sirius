import {
  BusinessCalendarLayout,
  useBusinessCalendarLayout,
} from "@/components/layouts/BusinessCalendarLayout";
import { DayToggleTab } from "./day-toggle-tab";

function OpenDaysContent() {
  const { full } = useBusinessCalendarLayout();
  return (
    <DayToggleTab
      title="Forced-Open Days"
      description="Days that are always business days, overriding every closure. Click a day on the calendar to toggle it."
      emptyText="No forced-open days."
      endpoint="manual-open"
      rows={full.manualOpen}
      testIdPrefix="open-day"
      addErrorFallback="Failed to add open day."
      deleteErrorFallback="Failed to delete open day."
    />
  );
}

export default function BusinessCalendarOpenDaysPage() {
  return (
    <BusinessCalendarLayout activeTab="open-days">
      <OpenDaysContent />
    </BusinessCalendarLayout>
  );
}
