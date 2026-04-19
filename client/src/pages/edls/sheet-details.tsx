import { formatYmd } from "@shared/utils/date";
import { Calendar, Users, FileText, Clock, MapPin, Lock, User, UserX, Building, ClipboardList, Layers, Factory } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EdlsSheetLayout, useEdlsSheetLayout } from "@/components/layouts/EdlsSheetLayout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearch, useLocation } from "wouter";
import type { EdlsSheetStatus, EdlsCrew, AssignmentExtra } from "@shared/schema";

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

interface AssignmentWithWorker {
  id: string;
  crewId: string;
  workerId: string;
  date: string;
  data: AssignmentExtra | null;
  worker: {
    id: string;
    siriusId: number | null;
    displayName: string | null;
    given: string | null;
    family: string | null;
    memberStatusId: string | null;
    memberStatusCode: string | null;
    memberStatusName: string | null;
  };
}

function formatUserName(user: UserInfo | undefined): string {
  if (!user) return "Not assigned";
  if (user.firstName || user.lastName) {
    return [user.firstName, user.lastName].filter(Boolean).join(" ");
  }
  return user.email;
}

function formatWorkerName(worker: AssignmentWithWorker["worker"]): string {
  if (worker.family && worker.given) {
    return `${worker.family}, ${worker.given}`;
  }
  if (worker.family) return worker.family;
  if (worker.given) return worker.given;
  if (worker.displayName) return worker.displayName;
  return `Worker ${worker.siriusId || worker.id.slice(0, 8)}`;
}

function formatTime12h(time: string | null | undefined): string {
  if (!time) return "";
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
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
  const search = useSearch();
  const [location, navigate] = useLocation();
  const selectedCrewId = new URLSearchParams(search).get("crew") || "all";

  const setSelectedCrewId = (id: string) => {
    const params = new URLSearchParams(search);
    if (id === "all") {
      params.delete("crew");
    } else {
      params.set("crew", id);
    }
    const qs = params.toString();
    navigate(qs ? `${location}?${qs}` : location, { replace: false });
  };

  const { data: crews = [], isLoading: crewsLoading } = useQuery<EdlsCrewWithRelations[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "crews"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/crews`);
      if (!response.ok) throw new Error("Failed to fetch crews");
      return response.json();
    },
  });

  const { data: assignments = [] } = useQuery<AssignmentWithWorker[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "assignments"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/assignments`);
      if (!response.ok) throw new Error("Failed to fetch assignments");
      return response.json();
    },
  });

  const { data: displayIdData } = useQuery<{ workerIdTypeConfigured: boolean; values: Record<string, string> }>({
    queryKey: ["/api/edls/sheets", sheet.id, "worker-display-ids"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/worker-display-ids`);
      if (!response.ok) throw new Error("Failed to fetch worker display IDs");
      return response.json();
    },
  });
  const workerIdTypeConfigured = !!displayIdData?.workerIdTypeConfigured;
  const displayIdValues = displayIdData?.values ?? {};

  const { data: classifications = [] } = useQuery<{ id: string; name: string; code: string | null; sequence: number }[]>({
    queryKey: ["/api/options/classification"],
  });

  const { data: eligibleWorkers, isLoading: eligibleLoading } = useQuery<{ id: string }[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "available-workers"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/available-workers`);
      if (!response.ok) throw new Error("Failed to fetch available workers");
      return response.json();
    },
  });

  const eligibleWorkerIds = useMemo(
    () => new Set((eligibleWorkers ?? []).map(w => w.id)),
    [eligibleWorkers],
  );

  const classificationsMap = useMemo(() => new Map(classifications.map(c => [c.id, c])), [classifications]);

  const assignmentsByCrewId = useMemo(() => {
    return assignments.reduce((acc, a) => {
      if (!acc[a.crewId]) acc[a.crewId] = [];
      acc[a.crewId].push(a);
      return acc;
    }, {} as Record<string, AssignmentWithWorker[]>);
  }, [assignments]);

  const totalSlots = crews.reduce((sum, c) => sum + c.workerCount, 0);
  const filledSlots = assignments.length;

  return (
    <TooltipProvider>
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Sheet Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:grid-cols-2 print:gap-x-4 print:gap-y-1">
            <div className="print:flex print:items-baseline print:gap-2">
              <h3 className="text-sm font-medium text-muted-foreground mb-1 print:mb-0 print:after:content-[':']">Title</h3>
              <p className="text-foreground" data-testid="text-title">{sheet.title}</p>
            </div>
            <div className="print:flex print:items-baseline print:gap-2">
              <h3 className="text-sm font-medium text-muted-foreground mb-1 print:mb-0 print:after:content-[':']">Date</h3>
              <p className="text-foreground flex items-center gap-2" data-testid="text-date">
                <Calendar className="h-4 w-4 text-muted-foreground print:hidden" />
                {formatYmd(sheet.ymd, 'long')}
              </p>
            </div>
            <div className="print:flex print:items-baseline print:gap-2">
              <h3 className="text-sm font-medium text-muted-foreground mb-1 print:mb-0 print:after:content-[':']">Department</h3>
              <p className="text-foreground flex items-center gap-2" data-testid="text-department">
                <Building className="h-4 w-4 text-muted-foreground print:hidden" />
                {(sheet as any).department?.name || "Not assigned"}
              </p>
            </div>
            <div className="print:flex print:items-baseline print:gap-2">
              <h3 className="text-sm font-medium text-muted-foreground mb-1 print:mb-0 print:after:content-[':']">Event</h3>
              <p className="text-foreground flex items-center gap-2" data-testid="text-job-group">
                <Layers className="h-4 w-4 text-muted-foreground print:hidden" />
                {(sheet as any).jobGroup?.name || "None"}
              </p>
            </div>
            <div className="print:flex print:items-baseline print:gap-2">
              <h3 className="text-sm font-medium text-muted-foreground mb-1 print:mb-0 print:after:content-[':']">Facility</h3>
              <p className="text-foreground flex items-center gap-2" data-testid="text-facility">
                <Factory className="h-4 w-4 text-muted-foreground print:hidden" />
                {(sheet as any).facility?.name || "None"}
              </p>
            </div>
            <div className="print:flex print:items-baseline print:gap-2">
              <h3 className="text-sm font-medium text-muted-foreground mb-1 print:mb-0 print:after:content-[':']">Worker Count</h3>
              <p className="text-foreground flex items-center gap-2" data-testid="text-worker-count">
                <Users className="h-4 w-4 text-muted-foreground print:hidden" />
                <span data-testid="text-assigned-total">{filledSlots}/{totalSlots}</span>
              </p>
            </div>
            <div className="print:flex print:items-baseline print:gap-2">
              <h3 className="text-sm font-medium text-muted-foreground mb-1 print:mb-0 print:after:content-[':']">Status</h3>
              <div className="flex items-center gap-2" data-testid="text-status">
                <FileText className="h-4 w-4 text-muted-foreground print:hidden" />
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
            <div className="print:flex print:items-baseline print:gap-2">
              <h3 className="text-sm font-medium text-muted-foreground mb-1 print:mb-0 print:after:content-[':']">Supervisor</h3>
              <p className="text-foreground flex items-center gap-2" data-testid="text-supervisor">
                <User className="h-4 w-4 text-muted-foreground print:hidden" />
                {formatUserName((sheet as any).supervisorUser)}
              </p>
            </div>
            <div className="print:flex print:items-baseline print:gap-2">
              <h3 className="text-sm font-medium text-muted-foreground mb-1 print:mb-0 print:after:content-[':']">Assignee</h3>
              <p className="text-foreground flex items-center gap-2" data-testid="text-assignee">
                <User className="h-4 w-4 text-muted-foreground print:hidden" />
                {formatUserName((sheet as any).assigneeUser)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {crewsLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : crews.length === 0 ? (
        <p className="text-muted-foreground text-center py-4" data-testid="text-no-crews">
          No crews assigned to this sheet.
        </p>
      ) : (
        <div className="space-y-3">
          {crews.length > 1 && (
            <div className="flex items-center gap-2 print:hidden">
              <Label htmlFor="crew-filter" className="text-sm text-muted-foreground">
                Crew:
              </Label>
              <Select value={selectedCrewId} onValueChange={setSelectedCrewId}>
                <SelectTrigger
                  id="crew-filter"
                  className="w-[240px]"
                  data-testid="select-crew-filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-crew-all">
                    All crews ({crews.length})
                  </SelectItem>
                  {crews.map((c) => (
                    <SelectItem key={c.id} value={c.id} data-testid={`option-crew-${c.id}`}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {crews
            .filter((c) => selectedCrewId === "all" || c.id === selectedCrewId)
            .map((crew) => {
                const crewAssignments = assignmentsByCrewId[crew.id] || [];
                const crewFilled = crewAssignments.length;
                return (
                  <div
                    key={crew.id}
                    className="border rounded-md p-4 print:break-inside-avoid print:p-2 print:mb-2"
                    data-testid={`crew-card-${crew.id}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                      <h4 className="font-medium" data-testid={`crew-title-${crew.id}`}>
                        {crew.title}
                      </h4>
                      <Badge 
                        variant={crewFilled === crew.workerCount ? "default" : "secondary"} 
                        data-testid={`crew-workers-${crew.id}`}
                      >
                        <Users className="h-3 w-3 mr-1" />
                        {crewFilled}/{crew.workerCount} workers
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
                      <div className="flex items-center gap-1" data-testid={`crew-supervisor-${crew.id}`}>
                        <User className="h-4 w-4" />
                        Supervisor: {formatUserName(crew.supervisorUser)}
                      </div>
                      {crew.task && (
                        <div className="flex items-center gap-1" data-testid={`crew-task-${crew.id}`}>
                          <ClipboardList className="h-4 w-4" />
                          Task: {crew.task.name}
                        </div>
                      )}
                    </div>
                    {crew.workerCount > 0 && (() => {
                      const leftCount = Math.ceil(crew.workerCount / 2);
                      const renderSlot = (idx: number) => {
                        const positionNumber = idx + 1;
                        const assignment = crewAssignments[idx];
                        if (!assignment) {
                          return (
                            <div
                              key={`empty-${crew.id}-${idx}`}
                              className="flex items-center gap-3 text-sm text-muted-foreground"
                              data-testid={`position-empty-${crew.id}-${positionNumber}`}
                            >
                              <span className="w-6 text-right tabular-nums">{positionNumber}.</span>
                              <span className="flex-1">&nbsp;</span>
                            </div>
                          );
                        }
                        const assignmentData = (assignment.data as AssignmentExtra) || {};
                        const isOutOfPopulation =
                          !eligibleLoading && !!eligibleWorkers && !eligibleWorkerIds.has(assignment.workerId);
                        return (
                          <div
                            key={assignment.id}
                            className="flex items-center gap-3 text-sm"
                            data-testid={`assignment-${assignment.id}`}
                          >
                            <span className="text-muted-foreground w-6 text-right tabular-nums">
                              {positionNumber}.
                            </span>
                            <span
                              className="w-12 text-left text-xs tabular-nums text-muted-foreground truncate"
                              title={assignment.worker.memberStatusName ?? undefined}
                              data-testid={`text-member-status-${assignment.id}`}
                            >
                              {assignment.worker.memberStatusCode ?? "—"}
                            </span>
                            <span
                              className="text-muted-foreground w-16 text-left tabular-nums"
                              data-testid={`text-assignment-display-id-${assignment.id}`}
                            >
                              {workerIdTypeConfigured
                                ? (displayIdValues[assignment.workerId] ?? "—")
                                : (assignment.worker.siriusId ? `#${assignment.worker.siriusId}` : "—")}
                            </span>
                            <span className="flex items-center gap-1.5 min-w-0">
                              {isOutOfPopulation && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      tabIndex={0}
                                      className="inline-flex items-center"
                                      aria-label="Out of population"
                                      data-testid={`icon-out-of-population-${assignment.id}`}
                                    >
                                      <UserX
                                        className="h-4 w-4 text-red-600 dark:text-red-500 shrink-0"
                                        aria-hidden="true"
                                      />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>Out of population</TooltipContent>
                                </Tooltip>
                              )}
                              <span className="truncate">{formatWorkerName(assignment.worker)}</span>
                            </span>
                            <span className="flex-1" />
                            {(() => {
                              const parts: string[] = [];
                              if (assignmentData.classificationId) {
                                const c = classificationsMap.get(assignmentData.classificationId);
                                if (c) parts.push(c.code || c.name);
                              }
                              if (assignmentData.startTime) {
                                parts.push(assignmentData.startTime.slice(0, 5));
                              }
                              if (assignmentData.note) parts.push(assignmentData.note);
                              if (parts.length === 0) return null;
                              return (
                                <span
                                  className="text-xs text-muted-foreground truncate max-w-[200px]"
                                  title={parts.join(" ")}
                                  data-testid={`text-assignment-extras-${assignment.id}`}
                                >
                                  ({parts.join(" ")})
                                </span>
                              );
                            })()}
                          </div>
                        );
                      };
                      return (
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-xs text-muted-foreground mb-2">Assigned Workers:</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 print:grid-cols-2">
                            <div className="space-y-1" data-testid={`column-left-${crew.id}`}>
                              {Array.from({ length: leftCount }).map((_, i) => renderSlot(i))}
                            </div>
                            <div className="space-y-1" data-testid={`column-right-${crew.id}`}>
                              {Array.from({ length: crew.workerCount - leftCount }).map((_, i) => renderSlot(leftCount + i))}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}

export default function EdlsSheetDetailsPage() {
  return (
    <EdlsSheetLayout activeTab="details">
      <EdlsSheetDetailsContent />
    </EdlsSheetLayout>
  );
}
