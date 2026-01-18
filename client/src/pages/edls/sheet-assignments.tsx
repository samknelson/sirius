import { format } from "date-fns";
import { Calendar, Users, Clock, MapPin, User, Building, ClipboardList, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EdlsSheetLayout, useEdlsSheetLayout } from "@/components/layouts/EdlsSheetLayout";
import { useQuery } from "@tanstack/react-query";
import type { EdlsSheetStatus, EdlsCrew } from "@shared/schema";

interface EdlsCrewWithRelations extends EdlsCrew {
  supervisorUser?: UserInfo;
  task?: { id: string; name: string };
}

interface UserInfo {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

function formatUserName(user: UserInfo | undefined): string {
  if (!user) return "Not assigned";
  if (user.firstName || user.lastName) {
    return [user.firstName, user.lastName].filter(Boolean).join(" ");
  }
  return user.email;
}

const statusColors: Record<EdlsSheetStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  request: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  lock: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  trash: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  reserved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

const statusLabels: Record<EdlsSheetStatus, string> = {
  draft: "Draft",
  request: "Request",
  lock: "Locked",
  trash: "Trash",
  reserved: "Reserved",
};

function formatTime(time: string): string {
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

function SheetSummary() {
  const { sheet } = useEdlsSheetLayout();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg" data-testid="text-sheet-title">{sheet.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-1.5" data-testid="text-sheet-date">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            {format(new Date(sheet.date + "T00:00:00"), "EEE, MMM d, yyyy")}
          </div>
          {sheet.employer && (
            <div className="flex items-center gap-1.5" data-testid="text-sheet-employer">
              <Building className="h-4 w-4 text-muted-foreground" />
              {sheet.employer.name}
            </div>
          )}
          <div className="flex items-center gap-1.5" data-testid="text-sheet-workers">
            <Users className="h-4 w-4 text-muted-foreground" />
            {sheet.workerCount} workers needed
          </div>
          <Badge 
            className={statusColors[(sheet.status as EdlsSheetStatus) || "draft"]}
            data-testid="badge-sheet-status"
          >
            {statusLabels[(sheet.status as EdlsSheetStatus) || "draft"]}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

interface AssignmentSlotProps {
  slotIndex: number;
  crewId: string;
}

function AssignmentSlot({ slotIndex, crewId }: AssignmentSlotProps) {
  return (
    <div
      className="flex items-center gap-2 p-2 border border-dashed rounded-md bg-muted/30 hover-elevate cursor-pointer"
      data-testid={`slot-${crewId}-${slotIndex}`}
    >
      <UserPlus className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm text-muted-foreground">Empty slot</span>
    </div>
  );
}

interface CrewCardProps {
  crew: EdlsCrewWithRelations;
}

function CrewCard({ crew }: CrewCardProps) {
  const slots = Array.from({ length: crew.workerCount }, (_, i) => i);

  return (
    <Card data-testid={`crew-card-${crew.id}`}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base" data-testid={`crew-title-${crew.id}`}>
            {crew.title}
          </CardTitle>
          <Badge variant="secondary" data-testid={`crew-worker-count-${crew.id}`}>
            0 / {crew.workerCount}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1" data-testid={`crew-time-${crew.id}`}>
            <Clock className="h-3 w-3" />
            {formatTime(crew.startTime)} - {formatTime(crew.endTime)}
          </div>
          {crew.location && (
            <div className="flex items-center gap-1" data-testid={`crew-location-${crew.id}`}>
              <MapPin className="h-3 w-3" />
              {crew.location}
            </div>
          )}
          {crew.task && (
            <div className="flex items-center gap-1" data-testid={`crew-task-${crew.id}`}>
              <ClipboardList className="h-3 w-3" />
              {crew.task.name}
            </div>
          )}
          <div className="flex items-center gap-1" data-testid={`crew-supervisor-${crew.id}`}>
            <User className="h-3 w-3" />
            {formatUserName(crew.supervisorUser)}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {slots.map((slotIndex) => (
            <AssignmentSlot key={slotIndex} slotIndex={slotIndex} crewId={crew.id} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CrewsList() {
  const { sheet } = useEdlsSheetLayout();

  const { data: crews = [], isLoading } = useQuery<EdlsCrewWithRelations[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "crews"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/crews`);
      if (!response.ok) throw new Error("Failed to fetch crews");
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (crews.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-muted-foreground text-center" data-testid="text-no-crews">
            No crews on this sheet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {crews.map((crew) => (
        <CrewCard key={crew.id} crew={crew} />
      ))}
    </div>
  );
}

function AvailableWorkersPanel() {
  return (
    <Card className="sticky top-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Available Workers
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-center py-8" data-testid="text-workers-placeholder">
          Worker list will be displayed here.
        </p>
      </CardContent>
    </Card>
  );
}

function EdlsSheetAssignmentsContent() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <SheetSummary />
        <CrewsList />
      </div>
      <div className="lg:col-span-1">
        <AvailableWorkersPanel />
      </div>
    </div>
  );
}

export default function EdlsSheetAssignmentsPage() {
  return (
    <EdlsSheetLayout activeTab="assignments">
      <EdlsSheetAssignmentsContent />
    </EdlsSheetLayout>
  );
}
