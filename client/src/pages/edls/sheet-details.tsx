import { format } from "date-fns";
import { Building2, Calendar, Users, FileText, Clock, MapPin, Lock, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EdlsSheetLayout, useEdlsSheetLayout } from "@/components/layouts/EdlsSheetLayout";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { EdlsSheetStatus, EdlsCrew } from "@shared/schema";

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

function EdlsSheetDetailsContent() {
  const { sheet } = useEdlsSheetLayout();
  const sheetData = (sheet.data as Record<string, any>) || {};
  const hasTrashLock = !!sheetData.trashLock;

  const { data: crews = [], isLoading: crewsLoading } = useQuery<EdlsCrew[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "crews"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/crews`);
      if (!response.ok) throw new Error("Failed to fetch crews");
      return response.json();
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Sheet Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-1">Title</h3>
              <p className="text-foreground" data-testid="text-title">{sheet.title}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-1">Employer</h3>
              <p className="text-foreground flex items-center gap-2" data-testid="text-employer">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                {sheet.employer ? (
                  <Link href={`/employers/${sheet.employer.id}`} className="text-primary hover:underline">
                    {sheet.employer.name}
                  </Link>
                ) : (
                  "Unknown"
                )}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-1">Date</h3>
              <p className="text-foreground flex items-center gap-2" data-testid="text-date">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                {format(new Date(sheet.date), "PPP")}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-1">Worker Count</h3>
              <p className="text-foreground flex items-center gap-2" data-testid="text-worker-count">
                <Users className="h-4 w-4 text-muted-foreground" />
                {sheet.workerCount}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-1">Status</h3>
              <div className="flex items-center gap-2" data-testid="text-status">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <Badge className={statusColors[(sheet.status as EdlsSheetStatus) || "draft"]}>
                  {statusLabels[(sheet.status as EdlsSheetStatus) || "draft"]}
                </Badge>
                {hasTrashLock && (
                  <Badge variant="outline" className="gap-1" data-testid="badge-trash-lock">
                    <Lock className="h-3 w-3" />
                    Trash Lock
                  </Badge>
                )}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-1">Supervisor</h3>
              <p className="text-foreground flex items-center gap-2" data-testid="text-supervisor">
                <User className="h-4 w-4 text-muted-foreground" />
                {formatUserName((sheet as any).supervisorUser)}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-1">Assignee</h3>
              <p className="text-foreground flex items-center gap-2" data-testid="text-assignee">
                <User className="h-4 w-4 text-muted-foreground" />
                {formatUserName((sheet as any).assigneeUser)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Crews ({crews.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {crewsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : crews.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No crews assigned to this sheet.</p>
          ) : (
            <div className="space-y-3">
              {crews.map((crew) => (
                <div
                  key={crew.id}
                  className="border rounded-md p-4"
                  data-testid={`crew-card-${crew.id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                    <h4 className="font-medium" data-testid={`crew-title-${crew.id}`}>
                      {crew.title}
                    </h4>
                    <Badge variant="secondary" data-testid={`crew-workers-${crew.id}`}>
                      <Users className="h-3 w-3 mr-1" />
                      {crew.workerCount} workers
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1" data-testid={`crew-time-${crew.id}`}>
                      <Clock className="h-4 w-4" />
                      {formatTime(crew.startTime)} - {formatTime(crew.endTime)}
                    </div>
                    {crew.location && (
                      <div className="flex items-center gap-1" data-testid={`crew-location-${crew.id}`}>
                        <MapPin className="h-4 w-4" />
                        {crew.location}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function EdlsSheetDetailsPage() {
  return (
    <EdlsSheetLayout activeTab="details">
      <EdlsSheetDetailsContent />
    </EdlsSheetLayout>
  );
}
