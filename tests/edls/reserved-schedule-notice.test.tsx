import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { AssignmentDetails } from "../../client/src/pages/edls-schedule";

const assignment = {
  assignmentId: "assignment-1",
  ymd: "2026-09-25",
  sheetId: "sheet-1",
  sheetTitle: "Private job details",
  sheetStatus: "reserved",
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

function renderAssignment(sheetStatus: string) {
  const client = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AssignmentDetails
        assignment={{ ...assignment, sheetStatus }}
        scheduleId="schedule-1"
        now={Date.parse("2026-09-24T13:00:00.000Z")}
      />
    </QueryClientProvider>,
  );
}

describe("Reserved EDLS assignment on the public schedule", () => {
  it("shows only the review notice, with no details, answer controls or update age", () => {
    const html = renderAssignment("reserved");
    expect(html).toContain(notice);
    expect(html).not.toContain("Private job details");
    expect(html).not.toContain("Private crew details");
    expect(html).not.toContain("Private check-in details");
    expect(html).not.toContain("button-accept");
    expect(html).not.toContain("button-decline");
    expect(html).not.toContain("text-updated");
  });

  it("returns to the assignment view when Locked; Requested retains its draft view", () => {
    const locked = renderAssignment("lock");
    expect(locked).not.toContain(notice);
    expect(locked).toContain("Private job details");
    expect(locked).toContain("button-accept");
    expect(locked).toContain("text-updated");

    const requested = renderAssignment("request");
    expect(requested).not.toContain(notice);
    expect(requested).toContain("Private job details");
    expect(requested).toContain("Draft - Awaiting Confirmation");
    expect(requested).not.toContain("button-accept");
  });
});