import { EdlsSheetLayout, useEdlsSheetLayout } from "@/components/layouts/EdlsSheetLayout";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Users, Clock, User } from "lucide-react";
import { ymdToLocalDate } from "@shared/utils/date";
import type { EdlsCrewWithRelations, AssignmentWithWorker } from "@/components/edls/SheetDetailsView";

interface NextAssignment {
  assignmentId: string;
  ymd: string;
  sheetId: string;
  sheetTitle: string;
  sheetStatus: string;
  crewId: string;
  crewTitle: string;
  startTime: string | null;
  endTime: string | null;
  supervisor: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
  facility: { id: string; name: string } | null;
  jobGroup: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  data: Record<string, unknown> | null;
}

function formatWorkerName(worker: AssignmentWithWorker["worker"]): string {
  if (worker.family && worker.given) return `${worker.family}, ${worker.given}`;
  if (worker.family) return worker.family;
  if (worker.given) return worker.given;
  if (worker.displayName) return worker.displayName;
  return `Worker ${worker.siriusId || worker.id.slice(0, 8)}`;
}

function formatUserName(user: NextAssignment["supervisor"]): string {
  if (!user) return "—";
  if (user.firstName || user.lastName) {
    return [user.firstName, user.lastName].filter(Boolean).join(" ");
  }
  return user.email;
}

function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

/** Effective start time: assignment data.startTime override, else crew/sheet start time. Returns "HH:MM" or null. */
function effectiveStartTime(data: Record<string, unknown> | null | undefined, fallback: string | null | undefined): string | null {
  const override = data && typeof (data as { startTime?: unknown }).startTime === "string"
    ? ((data as { startTime: string }).startTime)
    : null;
  const raw = override || fallback;
  return raw ? raw.slice(0, 5) : null;
}

/** "Saturday, Aug 1, 2026" — full weekday, short month. */
function formatYmdFullWeekday(ymd: string): string {
  const d = ymdToLocalDate(ymd);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

/** Local Date at ymd + optional "HH:MM" (midnight when time missing). */
function ymdTimeToDate(ymd: string, time: string | null): Date {
  const d = ymdToLocalDate(ymd);
  if (time) {
    const [h, m] = time.split(":").map(Number);
    d.setHours(h || 0, m || 0, 0, 0);
  }
  return d;
}

/** Interval between two start datetimes, e.g. "2 days 11 hours". */
function formatInterval(from: Date, to: Date): string | null {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return null;
  const totalHours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (parts.length === 0) return "less than an hour";
  return parts.join(" ");
}

function NextAssignmentsContent() {
  const { sheet } = useEdlsSheetLayout();

  const { data: crews = [], isLoading: crewsLoading } = useQuery<EdlsCrewWithRelations[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "crews"],
  });

  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery<AssignmentWithWorker[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "assignments"],
  });

  const { data: nextData, isLoading: nextLoading } = useQuery<{ next: Record<string, NextAssignment | null> }>({
    queryKey: ["/api/edls/sheets", sheet.id, "next-assignments"],
  });

  const assignmentsByCrewId = useMemo(() => {
    return assignments.reduce((acc, a) => {
      if (!acc[a.crewId]) acc[a.crewId] = [];
      acc[a.crewId].push(a);
      return acc;
    }, {} as Record<string, AssignmentWithWorker[]>);
  }, [assignments]);

  const isLoading = crewsLoading || assignmentsLoading || nextLoading;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (crews.length === 0) {
    return (
      <p className="text-muted-foreground text-center py-4" data-testid="text-no-crews">
        No crews assigned to this sheet.
      </p>
    );
  }

  const nextMap = nextData?.next ?? {};

  return (
    <div className="space-y-3">
      {crews.map((crew) => {
        const crewAssignments = assignmentsByCrewId[crew.id] || [];
        return (
          <Card key={crew.id} data-testid={`next-crew-card-${crew.id}`}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base" data-testid={`next-crew-title-${crew.id}`}>
                  {crew.title}
                </CardTitle>
                <Badge variant="secondary" data-testid={`next-crew-count-${crew.id}`}>
                  <Users className="h-3 w-3 mr-1" />
                  {crewAssignments.length} workers
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {crewAssignments.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid={`text-no-workers-${crew.id}`}>
                  No workers assigned to this crew.
                </p>
              ) : (
                <div className="divide-y">
                  {crewAssignments.map((a) => {
                    const next = nextMap[a.workerId] ?? null;
                    const currentStart = effectiveStartTime(a.data as Record<string, unknown> | null, crew.startTime);
                    const nextStart = next ? effectiveStartTime(next.data, next.startTime) : null;
                    const interval = next
                      ? formatInterval(
                          ymdTimeToDate(sheet.ymd, currentStart),
                          ymdTimeToDate(next.ymd, nextStart),
                        )
                      : null;
                    return (
                      <div
                        key={a.id}
                        className="py-2 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4"
                        data-testid={`next-row-${a.id}`}
                      >
                        <div className="sm:w-56 shrink-0 flex items-center gap-2 min-w-0">
                          <span className="truncate font-medium" data-testid={`text-worker-name-${a.id}`}>
                            {formatWorkerName(a.worker)}
                          </span>
                          <span
                            className="w-12 text-left text-xs tabular-nums text-muted-foreground truncate"
                            title={a.worker.memberStatusName ?? undefined}
                            data-testid={`text-member-status-${a.id}`}
                          >
                            {a.worker.memberStatusCode ?? "—"}
                          </span>
                        </div>
                        {next ? (
                          <div
                            className="flex-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground min-w-0"
                            data-testid={`next-assignment-${a.id}`}
                          >
                            <span className="truncate max-w-[240px]" data-testid={`text-next-sheet-${a.id}`}>
                              {next.sheetTitle}
                            </span>
                            <span className="flex items-center gap-1" data-testid={`text-next-when-${a.id}`}>
                              <Clock className="h-3.5 w-3.5" />
                              {formatYmdFullWeekday(next.ymd)}
                              {nextStart ? `, ${formatTime(nextStart)}` : ""}
                              {interval ? ` (${interval})` : ""}
                            </span>
                            {next.department && <span data-testid={`text-next-department-${a.id}`}>{next.department.name}</span>}
                            {next.facility && <span data-testid={`text-next-facility-${a.id}`}>{next.facility.name}</span>}
                            {next.jobGroup && <span data-testid={`text-next-jobgroup-${a.id}`}>{next.jobGroup.name}</span>}
                            {next.supervisor && (
                              <span className="flex items-center gap-1" data-testid={`text-next-supervisor-${a.id}`}>
                                <User className="h-3.5 w-3.5" />
                                {formatUserName(next.supervisor)}
                              </span>
                            )}
                            <span className="flex-1" />
                            <Link
                              href={`/edls/sheet/${next.sheetId}`}
                              className="text-primary hover:underline shrink-0"
                              data-testid={`link-next-sheet-${a.id}`}
                            >
                              View
                            </Link>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground italic" data-testid={`text-none-scheduled-${a.id}`}>
                            None scheduled
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function EdlsSheetNextAssignmentsPage() {
  return (
    <EdlsSheetLayout activeTab="next-assignments">
      <NextAssignmentsContent />
    </EdlsSheetLayout>
  );
}
