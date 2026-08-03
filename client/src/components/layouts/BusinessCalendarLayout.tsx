import { createContext, useContext, ReactNode } from "react";
import { ArrowLeft, CalendarDays, Loader2 } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type {
  BusinessCalendar,
  BusinessCalendarManualByday,
  BusinessCalendarManualVacation,
  BusinessCalendarManualOpen,
  BusinessCalendarSource,
} from "@shared/schema";
import { Button } from "@/components/ui/button";
import { useBusinessCalendarTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

export interface CalendarWithRules {
  calendar: BusinessCalendar;
  manualByday: BusinessCalendarManualByday[];
  manualVacations: BusinessCalendarManualVacation[];
  manualOpen: BusinessCalendarManualOpen[];
}

interface BusinessCalendarLayoutContextValue {
  full: CalendarWithRules;
  calendarId: string;
}

const BusinessCalendarLayoutContext =
  createContext<BusinessCalendarLayoutContextValue | null>(null);

export function useBusinessCalendarLayout() {
  const context = useContext(BusinessCalendarLayoutContext);
  if (!context) {
    throw new Error("useBusinessCalendarLayout must be used within BusinessCalendarLayout");
  }
  return context;
}

/** Which calendar source each manual tab depends on. */
const TAB_SOURCE_REQUIREMENTS: Record<string, BusinessCalendarSource> = {
  "closed-days": "manual-byday",
  vacations: "manual-vacation",
  "open-days": "manual-open",
};

interface BusinessCalendarLayoutProps {
  activeTab: string;
  children: ReactNode;
}

export function BusinessCalendarLayout({ activeTab, children }: BusinessCalendarLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: full, isLoading } = useQuery<CalendarWithRules>({
    queryKey: ["/api/business-calendars", id],
    enabled: !!id,
  });
  const calendar = full?.calendar;

  const { tabs } = useBusinessCalendarTabAccess(id || "");

  usePageTitle(calendar ? `Calendar: ${calendar.name}` : "Business Calendar");

  if (isLoading) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!full || !calendar || !id) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <p className="text-muted-foreground" data-testid="text-calendar-not-found">
          Business calendar not found.
        </p>
        <Link href="/config/business-calendars">
          <Button variant="outline" className="mt-4" data-testid="button-back-to-list">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to calendars
          </Button>
        </Link>
      </div>
    );
  }

  const sources = (calendar.sources || []) as BusinessCalendarSource[];
  const visibleTabs = tabs.filter((tab) => {
    const requiredSource = TAB_SOURCE_REQUIREMENTS[tab.id];
    return !requiredSource || sources.includes(requiredSource);
  });

  return (
    <BusinessCalendarLayoutContext.Provider value={{ full, calendarId: id }}>
      <div className="px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/config/business-calendars">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <CalendarDays className="h-6 w-6 text-muted-foreground" />
          <h1
            className="text-xl md:text-2xl font-bold text-foreground"
            data-testid="heading-calendar-name"
          >
            {calendar.name}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
          {visibleTabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return isActive ? (
              <Button
                key={tab.id}
                variant="default"
                size="sm"
                data-testid={`button-calendar-tab-${tab.id}`}
              >
                {tab.label}
              </Button>
            ) : (
              <Link key={tab.id} href={tab.href}>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid={`button-calendar-tab-${tab.id}`}
                >
                  {tab.label}
                </Button>
              </Link>
            );
          })}
        </div>

        {children}
      </div>
    </BusinessCalendarLayoutContext.Provider>
  );
}
