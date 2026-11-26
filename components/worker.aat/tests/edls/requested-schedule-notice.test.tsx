import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import EdlsSchedulePage, { AssignmentDetails, ScheduleDayCard, ScheduleHeading } from "../../client/src/pages/edls-schedule";

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useQuery: vi.fn(),
}));
vi.mock("wouter", async (importOriginal) => ({
  ...await importOriginal<typeof import("wouter")>(),
  useParams: () => ({ id: "schedule-1" }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));

const assignment = {
  assignmentId: "assignment-1",
  generationId: "77777777-7777-4777-8777-777777777777",
  ymd: "2026-09-25",
  sheetId: "sheet-1",
  sheetTitle: "Private job details",
  sheetStatus: "request",
  revision: 4,
  updatedAt: "2026-09-24T12:00:00.000Z",
  crewId: "crew-1",
  crewTitle: "Private crew details",
  startTime: "08:00",
  endTime: null,
  location: "Private check-in details",
  facility: null,
  jobGroup: null,
  department: null,
  employer: null,
  showStatus: null,
  task: null,
  accepted: null,
  data: null,
};

const notice = "The assignment for this day is being reviewed. This page will be updated when the assignment is final.";
type Status = "draft" | "request" | "lock" | "reserved";
type DayAssignments = React.ComponentProps<typeof ScheduleDayCard>["day"]["assignments"];

function renderAssignment(sheetStatus: Status, accepted: boolean | null = null) {
  const visibleAssignment: DayAssignments[number] =
    sheetStatus === "draft" || sheetStatus === "request"
      ? { assignmentId: assignment.assignmentId, ymd: assignment.ymd, sheetStatus }
      : { ...assignment, sheetStatus, accepted };
  const client = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AssignmentDetails
        assignment={visibleAssignment}
        scheduleId="schedule-1"
        now={Date.parse("2026-09-24T13:00:00.000Z")}
      />
    </QueryClientProvider>,
  );
}

function renderDay(assignments: DayAssignments) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ScheduleDayCard
        day={{ ymd: assignment.ymd, relative: "Today", assignments }}
        scheduleId="schedule-1"
        now={Date.parse("2026-09-24T13:00:00.000Z")}
      />
    </QueryClientProvider>,
  );
}

describe("EDLS assignment states on the public schedule", () => {
  it("shows no freshness subtitle while loading or after access is denied", () => {
    const renderPage = () => renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}><EdlsSchedulePage /></QueryClientProvider>,
    );
    vi.mocked(useQuery).mockReturnValue({ isLoading: true, isError: false, data: undefined } as ReturnType<typeof useQuery>);
    expect(renderPage()).not.toContain("Current as of");
    vi.mocked(useQuery).mockReturnValue({ isLoading: false, isError: true, data: undefined } as ReturnType<typeof useQuery>);
    expect(renderPage()).toContain("Access denied");
    expect(renderPage()).not.toContain("Current as of");
  });

  it("shows the fetched instant in the response zone, not a running age or viewer's zone", () => {
    const schedule: React.ComponentProps<typeof ScheduleHeading>["schedule"] = {
      workerName: "Example, Worker",
      readAt: "2026-07-11T18:15:00.000Z",
      siteTimeZone: "America/Los_Angeles",
      startYmd: "2026-07-11",
      endYmd: "2026-07-17",
      assignments: [],
    };
    const renderHeading = () => renderToStaticMarkup(<ScheduleHeading schedule={schedule} />);
    expect(renderHeading()).toContain("Upcoming Schedule for Example, Worker</h1><p");
    expect(renderHeading()).toContain("Current as of 2026-07-11 11:15 AM America/Los_Angeles");
    // A page rerender on the assignment-age timer has no effect on this response value.
    expect(renderHeading()).toContain("Current as of 2026-07-11 11:15 AM America/Los_Angeles");
    schedule.readAt = "2026-07-11T18:17:00.000Z";
    expect(renderHeading()).toContain("Current as of 2026-07-11 11:17 AM America/Los_Angeles");
    schedule.siteTimeZone = "UTC";
    expect(renderHeading()).toContain("Current as of 2026-07-11 06:17 PM UTC");
    schedule.siteTimeZone = "invalid-zone";
    expect(renderHeading()).not.toContain("Current as of");
  });

  it.each(["draft", "request"])("shows only the review notice for %s, without details or answers", (status) => {
    const html = renderAssignment(status as Status);
    expect(html).toContain(notice);
    expect(html).not.toContain("Private job details");
    expect(html).not.toContain("Private crew details");
    expect(html).not.toContain("Private check-in details");
    expect(html).not.toContain("Draft - Awaiting Confirmation");
    expect(html).not.toContain("button-accept");
    expect(html).not.toContain("button-decline");
    expect(html).not.toContain("text-updated");
    expect(html).not.toContain("Rev. #");
  });

  it.each(["lock", "reserved"])("returns to the assignment and answer view when %s", (status) => {
    const html = renderAssignment(status as Status);
    expect(html).not.toContain(notice);
    expect(html).toContain("Private job details");
    expect(html).toContain("button-accept");
    expect(html).toContain("button-decline");
    expect(html).toContain("text-updated");
    expect(html).toContain("(Rev. #4, updated 1 hour ago)");
  });

  it.each([
    ["lock", true, "accepted"],
    ["reserved", false, "declined"],
  ])("shows the recorded answer on %s rather than answer controls", (status, accepted, wording) => {
    const html = renderAssignment(status as Status, accepted);
    expect(html).toContain(`You ${wording} this assignment.`);
    expect(html).not.toContain("button-accept");
    expect(html).not.toContain("button-decline");
  });

  it("shows No assignment on an empty day or one with only a cleared row", () => {
    for (const assignments of [
      [],
      [{ ...assignment, sheetStatus: "lock" as const, sheetId: null as unknown as string, crewId: null as unknown as string }],
    ]) {
      const html = renderDay(assignments);
      expect(html).toContain("No assignment");
      expect(html).not.toContain(notice);
      expect(html).not.toContain("Private job details");
      expect(html).not.toContain("button-accept");
    }
  });

  it("handles a reviewed and a scheduled assignment independently on the same day", () => {
    const html = renderDay([
      { assignmentId: assignment.assignmentId, ymd: assignment.ymd, sheetStatus: "draft" },
      { ...assignment, assignmentId: "assignment-2", sheetStatus: "lock", sheetTitle: "Scheduled job" },
    ]);
    expect(html).toContain(notice);
    expect(html).toContain("Scheduled job");
    expect(html).toContain("button-accept-assignment-2");
    expect(html).not.toContain("button-accept-assignment-1");
    expect(html).not.toContain("No assignment");
  });
});