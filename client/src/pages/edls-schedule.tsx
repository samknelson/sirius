import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert, ThumbsDown, ThumbsUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { addDaysYmd, ymdToLocalDate, type Ymd } from "@shared/utils/date";
import { useAuth } from "@/contexts/AuthContext";
import { assignmentUpdateAge } from "@/lib/assignment-update-age";

/** Number of dated sections rendered, counting today. Mirrors the endpoint's window. */
const SCHEDULE_DAYS = 7;

interface ScheduleAssignment {
  assignmentId: string;
  ymd: string;
  sheetId: string;
  sheetTitle: string;
  sheetStatus: string;
  updatedAt: string | null;
  crewId: string;
  crewTitle: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  facility: { id: string; name: string } | null;
  jobGroup: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  employer: { id: string; name: string } | null;
  showStatus: { id: string; name: string } | null;
  task: { id: string; name: string } | null;
  classification?: { name: string; code: string | null } | null;
  /**
   * This worker's own answer: null not answered yet, true accepted, false
   * declined. Optional so an older payload without the field reads as
   * unanswered rather than breaking the page.
   */
  accepted?: boolean | null;
  data: Record<string, unknown> | null;
}

interface PublicWorkerSchedule {
  workerName: string;
  startYmd: string;
  endYmd: string;
  assignments: ScheduleAssignment[];
  workerBackPath?: string;
}

/** All card dates use the same yearless weekday and month/day format. */
function formatDayHeading(ymd: Ymd): string {
  return ymdToLocalDate(ymd).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours, 10);
  if (Number.isNaN(hour)) return "";
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

/**
 * The time this worker is due: the per-assignment override when one was
 * entered, otherwise the crew's start time.
 */
function effectiveStartTime(assignment: ScheduleAssignment): string {
  const override = assignment.data && typeof (assignment.data as { startTime?: unknown }).startTime === "string"
    ? (assignment.data as { startTime: string }).startTime
    : null;
  return formatTime(override || assignment.startTime);
}

/** A labelled field. Empty values render blank rather than being hidden. */
function Field({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <span className="text-sm font-medium text-muted-foreground sm:w-40 sm:shrink-0">{label}</span>
      <span className="text-sm min-h-5" data-testid={testId}>{value}</span>
    </div>
  );
}

/**
 * The worker's answer to one assignment.
 *
 * While unanswered it offers accept and decline. Once answered the buttons
 * are gone for good and the recorded answer stands in their place.
 *
 * A refused answer (a stale tab, a second tap, an assignment edited out from
 * under the page) says so plainly and re-reads the schedule, so the page
 * never claims an answer that did not land.
 */
function AssignmentAnswer({
  scheduleId,
  assignment,
}: {
  scheduleId: string;
  assignment: ScheduleAssignment;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const answer = useMutation({
    mutationFn: (accepted: boolean) =>
      apiRequest(
        "POST",
        `/api/public/edls/schedule/${scheduleId}/assignments/${assignment.assignmentId}/answer`,
        { accepted },
      ),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: [`/api/public/edls/schedule/${scheduleId}`] });
    },
    onError: () => {
      setError("That answer could not be recorded. Your schedule has been refreshed below.");
      queryClient.invalidateQueries({ queryKey: [`/api/public/edls/schedule/${scheduleId}`] });
    },
  });

  if (assignment.accepted === true || assignment.accepted === false) {
    const accepted = assignment.accepted;
    const Icon = accepted ? ThumbsUp : ThumbsDown;
    return (
      <div
        className={`flex items-center gap-2 text-sm font-medium ${
          accepted ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500"
        }`}
        data-testid={`text-answer-${assignment.assignmentId}`}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>You {accepted ? "accepted" : "declined"} this assignment.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={answer.isPending}
          onClick={() => answer.mutate(true)}
          data-testid={`button-accept-${assignment.assignmentId}`}
        >
          <ThumbsUp className="h-4 w-4" aria-hidden="true" />
          Accept
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          disabled={answer.isPending}
          onClick={() => answer.mutate(false)}
          data-testid={`button-decline-${assignment.assignmentId}`}
        >
          <ThumbsDown className="h-4 w-4" aria-hidden="true" />
          Decline
        </Button>
      </div>
      {error && (
        <p
          className="text-sm text-destructive"
          role="alert"
          data-testid={`text-answer-error-${assignment.assignmentId}`}
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function AssignmentDetails({
  assignment,
  scheduleId,
  now,
}: {
  assignment: ScheduleAssignment;
  scheduleId: string;
  now: number;
}) {
  if (assignment.sheetStatus === "request") {
    return (
      <div
        className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        data-testid={`assignment-${assignment.assignmentId}`}
      >
        <p data-testid={`text-requested-review-${assignment.assignmentId}`}>
          The assignment for this day is being reviewed. This page will be updated when the assignment is final.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid={`assignment-${assignment.assignmentId}`}>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Field label="Event" value={assignment.jobGroup?.name ?? ""} testId="text-event" />
          <Field label="Event Status" value={assignment.showStatus?.name ?? ""} testId="text-event-status" />
          <Field label="Department" value={assignment.department?.name ?? ""} testId="text-department" />
          <Field label="Job #" value={assignment.sheetTitle ?? ""} testId="text-job-number" />
          <Field label="Facility" value={assignment.facility?.name ?? ""} testId="text-facility" />
        </div>
        <div className="space-y-2">
          <Field label="Crew" value={assignment.crewTitle ?? ""} testId="text-crew" />
          <Field label="Task" value={assignment.task?.name ?? ""} testId="text-task" />
          {assignment.classification && (
            <Field
              label="Classification"
              value={assignment.classification.code || assignment.classification.name}
              testId="text-classification"
            />
          )}
          <Field label="Start Time" value={effectiveStartTime(assignment)} testId="text-start-time" />
          <Field label="Checkin Location" value={assignment.location ?? ""} testId="text-checkin-location" />
        </div>
      </div>
      <AssignmentAnswer scheduleId={scheduleId} assignment={assignment} />
      <p
        className="text-right text-xs text-muted-foreground"
        data-testid={`text-updated-${assignment.assignmentId}`}
      >
        {assignmentUpdateAge(assignment.updatedAt, now)}
      </p>
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="container mx-auto max-w-3xl p-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-6 w-6 text-destructive" />
            <CardTitle data-testid="text-access-denied">Access denied</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This schedule link is not valid. Please check the link or contact your dispatcher.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function EdlsSchedulePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const scheduleUrl = `/api/public/edls/schedule/${id}`;

  const { data, isLoading, isError } = useQuery<PublicWorkerSchedule>({
    queryKey: [scheduleUrl, { viewer: user?.id ?? "public" }],
    queryFn: () => apiRequest("GET", scheduleUrl),
    enabled: !!id,
  });

  // The seven dated sections, today first, each with whatever the endpoint
  // returned for that date (a day with nothing gets an empty list).
  const days = useMemo(() => {
    if (!data) return [];
    const byYmd = new Map<string, ScheduleAssignment[]>();
    for (const assignment of data.assignments) {
      const list = byYmd.get(assignment.ymd);
      if (list) list.push(assignment);
      else byYmd.set(assignment.ymd, [assignment]);
    }
    return Array.from({ length: SCHEDULE_DAYS }, (_, offset) => {
      const ymd = addDaysYmd(data.startYmd, offset);
      const relative: "Today" | "Tomorrow" | undefined =
        offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : undefined;
      return { ymd, relative, assignments: byYmd.get(ymd) ?? [] };
    });
  }, [data]);

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return <AccessDenied />;
  }

  return (
    <div className="container mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-bold" data-testid="text-schedule-title">
        Upcoming Schedule for {data.workerName}
      </h1>
      {data.workerBackPath && (
        <Link href={data.workerBackPath}>
          <Button type="button" variant="outline" data-testid="button-back-to-worker">
            Back to worker
          </Button>
        </Link>
      )}

      {days.map((day) => (
        <Card
          key={day.ymd}
          className={day.relative ? "border-2 border-blue-500 dark:border-blue-400" : undefined}
          data-testid={`card-day-${day.ymd}`}
        >
          <CardHeader className={day.relative ? "flex-row flex-wrap items-start gap-2 space-y-0" : undefined}>
            <CardTitle
              className={day.relative === "Today" ? "text-xl" : "text-lg"}
              data-testid={`text-day-heading-${day.ymd}`}
            >
              {formatDayHeading(day.ymd)}
            </CardTitle>
            {day.relative && (
              <Badge
                variant="outline"
                className="ml-auto shrink-0 border-blue-600 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-200"
                data-testid={`badge-day-${day.ymd}`}
              >
                {day.relative}'s Schedule
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            {day.assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid={`text-no-assignment-${day.ymd}`}>
                No assignments
              </p>
            ) : (
              day.assignments.map((assignment) => (
                <AssignmentDetails
                  key={assignment.assignmentId}
                  assignment={assignment}
                  scheduleId={id}
                  now={now}
                />
              ))
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
