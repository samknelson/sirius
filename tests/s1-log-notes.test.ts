import { describe, expect, it } from "vitest";
import {
  classifyS1Log,
  deriveS1LogNoteSubject,
  S1_LOG_NOTE_SUBJECT_MAX_LENGTH,
} from "../scripts/s1-migration/lib/log-notes";

describe("S1 log-to-note classification", () => {
  it("selects and truncates the summary, title, or fallback subject", () => {
    const longSummary = "Summary ".repeat(20);
    expect(deriveS1LogNoteSubject({ summary: longSummary, title: "Title", nid: 1 }))
      .toBe(longSummary.slice(0, S1_LOG_NOTE_SUBJECT_MAX_LENGTH));
    expect(deriveS1LogNoteSubject({ summary: "  ", title: "Title ".repeat(20), nid: 2 }))
      .toBe(("Title ".repeat(20)).slice(0, S1_LOG_NOTE_SUBJECT_MAX_LENGTH));
    expect(deriveS1LogNoteSubject({ summary: null, title: null, nid: 3 }))
      .toBe("S1 log 3");
  });

  it("maps approved inbound, outbound, no-medium, and multi-issue rows", () => {
    expect(classifyS1Log("Call from Member", "Enrrolment")).toMatchObject({
      noteType: "Member Inbound",
      medium: "Call",
      issues: ["Enrollment"],
    });
    expect(classifyS1Log("Call to Member", "Disability/FMLA")).toMatchObject({
      noteType: "Member Outreach",
      medium: "Call",
      issues: ["Disability"],
    });
    expect(classifyS1Log("Issue Reported for Member", "Eligibility")).toMatchObject({
      noteType: "Member Inbound",
      medium: null,
      issues: ["Enrollment"],
    });
    expect(classifyS1Log("Hotline Call from Member", "ID card not received")).toMatchObject({
      issues: ["MLK", "ID Card"],
    });
  });

  it("normalizes the workbook's spelling and visit aliases", () => {
    expect(classifyS1Log("Issue Reported for Member", "Dyntl")?.issues).toEqual(["Dental"]);
    expect(classifyS1Log("Office Visit", "Walk In")).toMatchObject({
      noteType: "Member Inbound",
      medium: "In-Person",
    });
    expect(classifyS1Log("In person Visit ", "Enrollment")?.medium).toBe("In-Person");
  });

  it("keeps material and member correspondence in scope", () => {
    expect(classifyS1Log("material", "material")?.noteType).toBe("Document Detail");
    expect(classifyS1Log("Email from Member", "Eligibility")?.medium).toBe("Email");
    expect(classifyS1Log("Letter", "Appeal Denial")?.medium).toBe("Letter");
    expect(classifyS1Log("smf:notes", "raw")).toBeNull();
  });

  it("excludes every prohibited disposition family before workbook matching", () => {
    const excluded = [
      ["bulk:queue", "sent"],
      ["auditlog", "dispatch_seniority"],
      ["election", "election"],
      ["email", "sending"],
      ["letter", "draft"],
      ["letter", "sent"],
      ["twilio:conversation", "incoming_sms"],
      ["sms", "STOP"],
      ["smf", "importraw"],
      ["trust:wb:scan", "terminated"],
    ];
    for (const [category, type] of excluded) expect(classifyS1Log(category, type)).toBeNull();
  });
});