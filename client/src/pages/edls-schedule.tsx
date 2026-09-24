import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert, ThumbsDown, ThumbsUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { addDaysYmd, ymdToLocalDate, type Ymd } from "@shared/utils/date";

/** Number of dated sections rendered, counting today. Mirrors the endpoint's window. */
const SCHEDULE_DAYS = 7;

interface ScheduleAssignment {
  assignmentId: string;
  ymd: string;
  sheetId: string;
  sheetTitle: string;
  sheetStatus: string;
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
}

/** "Sunday, August 23, 2026" — full weekday, matching the legacy page's headings. */
function formatDayHeading(ymd: Ymd): string {
  return ymdToLocalDate(ymd).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
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
 * While unanswered it offers accept and decline, with the finality said up
 * front — the choice cannot be changed from this page, and a worker reading
 * a text on their phone should know that before they tap, not in a dialog
 * afterwards. Once answered the buttons are gone for good and the recorded
 * answer stands in their place.
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
      <p className="text-sm text-muted-foreground" data-testid={`text-answer-finality-${assignment.assignmentId}`}>
        Accept or decline this assignment. Your answer is final — once you choose, you cannot change
        it here. Call your dispatcher if something changes.
      </p>
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

function AssignmentDetails({
  assignment,
  scheduleId,
}: {
  assignment: ScheduleAssignment;
  scheduleId: string;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide">Job Information</h3>
          <Field label="Employer" value={assignment.employer?.name ?? ""} testId="text-employer" />
          <Field label="Event" value={assignment.sheetTitle ?? ""} testId="text-event" />
          <Field label="Event Status" value={assignment.showStatus?.name ?? ""} testId="text-event-status" />
          <Field label="Department" value={assignment.department?.name ?? ""} testId="text-department" />
          <Field label="Job #" value={assignment.jobGroup?.name ?? ""} testId="text-job-number" />
          <Field label="Facility" value={assignment.facility?.name ?? ""} testId="text-facility" />
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide">Crew</h3>
          <Field label="Crew" value={assignment.crewTitle ?? ""} testId="text-crew" />
          <Field label="Task" value={assignment.task?.name ?? ""} testId="text-task" />
          <Field label="Start Time" value={effectiveStartTime(assignment)} testId="text-start-time" />
          <Field label="Checkin Location" value={assignment.location ?? ""} testId="text-checkin-location" />
        </div>
      </div>
      <AssignmentAnswer scheduleId={scheduleId} assignment={assignment} />
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

  const { data, isLoading, isError } = useQuery<PublicWorkerSchedule>({
    queryKey: [`/api/public/edls/schedule/${id}`],
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
      return { ymd, assignments: byYmd.get(ymd) ?? [] };
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

      {days.map((day) => (
        <Card key={day.ymd} data-testid={`card-day-${day.ymd}`}>
          <CardHeader>
            <CardTitle className="text-lg" data-testid={`text-day-heading-${day.ymd}`}>
              {formatDayHeading(day.ymd)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {day.assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid={`text-no-assignment-${day.ymd}`}>
                There is no assignment for {formatDayHeading(day.ymd)}
              </p>
            ) : (
              day.assignments.map((assignment) => (
                <AssignmentDetails
                  key={assignment.assignmentId}
                  assignment={assignment}
                  scheduleId={id}
                />
              ))
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
