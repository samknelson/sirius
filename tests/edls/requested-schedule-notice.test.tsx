import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { AssignmentDetails, ScheduleDayCard } from "../../client/src/pages/edls-schedule";

const assignment = {
  assignmentId: "assignment-1",
  generationId: "77777777-7777-4777-8777-777777777777",
  ymd: "2026-09-25",
  sheetId: "sheet-1",
  sheetTitle: "Private job details",
  sheetStatus: "request",
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
  });

  it.each(["lock", "reserved"])("returns to the assignment and answer view when %s", (status) => {
    const html = renderAssignment(status as Status);
    expect(html).not.toContain(notice);
    expect(html).toContain("Private job details");
    expect(html).toContain("button-accept");
    expect(html).toContain("button-decline");
    expect(html).toContain("text-updated");
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