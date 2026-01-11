import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Users, MapPin, Video, Presentation, Mic, Ticket, Star, Heart, Clock, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import type { Event, EventType, EventOccurrence } from "@shared/schema";
import { createContext, useContext } from "react";
import { useEventTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

const iconMap: Record<string, LucideIcon> = {
  Calendar, Users, MapPin, Video, Presentation, Mic, Ticket, Star, Heart, Clock,
};

interface EventWithOccurrences extends Event {
  occurrences: EventOccurrence[];
}

interface EventLayoutContextValue {
  event: EventWithOccurrences;
  eventType: EventType | undefined;
  category: string | undefined;
  isLoading: boolean;
  isError: boolean;
}

const EventLayoutContext = createContext<EventLayoutContextValue | undefined>(undefined);

export function useEventLayout() {
  const context = useContext(EventLayoutContext);
  if (!context) {
    throw new Error("useEventLayout must be used within EventLayout");
  }
  return context;
}

interface EventLayoutProps {
  children: React.ReactNode;
  activeTab: string;
}

export default function EventLayout({ children, activeTab }: EventLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: event, isLoading, error } = useQuery<EventWithOccurrences>({
    queryKey: ["/api/events", id],
    enabled: !!id,
  });

  const { data: eventTypes = [] } = useQuery<EventType[]>({
    queryKey: ["/api/options/event-type"],
  });

  const { tabs: mainTabs } = useEventTabAccess(id);

  // Set page title based on event title
  usePageTitle(event?.title);

  const getEventType = (eventTypeId: string | null) => {
    if (!eventTypeId) return undefined;
    return eventTypes.find((t) => t.id === eventTypeId);
  };

  const getEventTypeIcon = (eventTypeId: string | null) => {
    const type = getEventType(eventTypeId);
    const data = type?.data as { icon?: string } | null;
    const iconName = data?.icon || "Calendar";
    return iconMap[iconName] || Calendar;
  };

  // Loading state
  if (isLoading || !event) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Calendar className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/events">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-events">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Events
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Skeleton className="h-16 w-16 rounded-full mb-4" />
              <Skeleton className="h-6 w-48 mb-2" />
              <Skeleton className="h-4 w-64" />
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Calendar className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Event Not Found</h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/events">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-events">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Events
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="py-12">
              <p className="text-center text-muted-foreground">
                The event you're looking for doesn't exist or has been removed.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const IconComponent = getEventTypeIcon(event.eventTypeId);
  const eventType = getEventType(event.eventTypeId);
  const category = eventType?.category;

  const contextValue: EventLayoutContextValue = {
    event,
    eventType,
    category,
    isLoading: false,
    isError: false,
  };

  return (
    <EventLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        {/* Header */}
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <IconComponent className="text-primary-foreground" size={16} />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-foreground" data-testid={`text-event-name-${event.id}`}>
                    {event.title}
                  </h1>
                  {eventType && (
                    <p className="text-sm text-muted-foreground">{eventType.name}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/events">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-events">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Events
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        {/* Main Tab Navigation */}
        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-2 py-3">
              {mainTabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return isActive ? (
                  <Button
                    key={tab.id}
                    variant="default"
                    size="sm"
                    data-testid={`button-event-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`button-event-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </EventLayoutContext.Provider>
  );
}
