import { describe, expect, it } from "vitest";
import {
  classifyS1Log,
  deriveS1LogNoteSubject,
  extractS1LogNoteBody,
  resolveS1LogCreator,
} from "../scripts/s1-migration/lib/log-notes";
import { classifyRow, combineFingerprints, contentHashOf } from "../scripts/s1-migration/lib/sync";

describe("S1 log-to-note classification", () => {
  it("uses the creator display name in every imported subject", () => {
    expect(deriveS1LogNoteSubject({ displayName: "Maria Garcia", s1Uid: 7 }))
      .toBe("Imported Note [user: Maria Garcia]");
    expect(deriveS1LogNoteSubject({ displayName: null, s1Uid: 7 }))
      .toBe("Imported Note [user: S1 user 7]");
    expect(deriveS1LogNoteSubject({ displayName: null, s1Uid: null }))
      .toBe("Imported Note [user: Unknown S1 user]");
  });

  it("uses mapped authors while retaining unmapped S1 creator provenance", () => {
    expect(resolveS1LogCreator({
      s1Uid: 17,
      mappedS2UserId: "s2-user-17",
      displayName: "  Maria Garcia  ",
    })).toEqual({
      s1Uid: 17,
      s2UserId: "s2-user-17",
      displayName: "Maria Garcia",
    });
    const unmatched = resolveS1LogCreator({
      s1Uid: 18,
      displayName: "  Unknown Staff  ",
    });
    expect(unmatched).toEqual({
      s1Uid: 18,
      s2UserId: null,
      displayName: "Unknown Staff",
    });
    expect(deriveS1LogNoteSubject(unmatched)).toBe("Imported Note [user: Unknown Staff]");
  });

  it("preserves long and multi-part Drupal note content", () => {
    const first = "A".repeat(500);
    const second = "second delta";
    const result = extractS1LogNoteBody({
      field_sirius_summary: { value: "Summary", format: "plain_text" },
      field_sirius_notes: [
        { value: first, format: "full_html" },
        { value: second, format: "full_html" },
      ],
    }, "Original log title");
    expect(result.title).toBe("Original log title");
    expect(result.summary).toBe("Summary");
    expect(result.notes).toBe(`${first}\n\n${second}`);
    expect(result.body).toBe(`Original log title\n\nSummary\n\n${first}\n\n${second}`);
  });

  it("preserves title-only and title-plus-content logs", () => {
    expect(extractS1LogNoteBody({}, "Title-only source").body).toBe("Title-only source");
    expect(extractS1LogNoteBody({
      field_sirius_notes: { value: "Note body", format: "plain_text" },
    }, "Substantive title").body).toBe("Substantive title\n\nNote body");
  });

  it("reconciles when creator mapping or display name changes", () => {
    const sourceHash = contentHashOf({ nid: 99, body: "same source" });
    const unmapped = resolveS1LogCreator({ s1Uid: 20, displayName: "Former Staff" });
    const mapped = resolveS1LogCreator({
      s1Uid: 20,
      mappedS2UserId: "s2-user-20",
      displayName: "Former Staff",
    });
    const before = combineFingerprints([
      ["source", sourceHash],
      ["creator", contentHashOf(unmapped)],
    ]);
    const after = combineFingerprints([
      ["source", sourceHash],
      ["creator", contentHashOf(mapped)],
    ]);
    expect(after).not.toBe(before);
    expect(classifyRow({
      stub: false,
      consumedFingerprint: before,
      logicVersion: 3,
    }, after, 3, false)).toBe("changed");
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
    expect(classifyS1Log("smf:notes", "raw")).toMatchObject({
      noteType: "Legacy Notes",
      medium: null,
      issues: [],
    });
  });

  it("classifies whitespace/case variants of smf:notes raw as the immutable legacy population", () => {
    // Must stay in lockstep with the loader's SQL immutable predicate
    // (IMMUTABLE_PREDICATE_SQL in load-log-notes.ts): trim, lowercase,
    // collapsed inner whitespace, first-array-element/{value} extraction.
    for (const [category, type] of [
      ["smf:notes", "raw"],
      ["  SMF:Notes ", " Raw  "],
      ["smf:notes", "RAW"],
    ] as const) {
      expect(classifyS1Log(category, type)).toMatchObject({ noteType: "Legacy Notes" });
    }
    expect(classifyS1Log("smf:notes", "cooked")).toBeNull();
  });

  it("keeps a created-but-unverified row retryable (mapping without fingerprint)", () => {
    const fp = combineFingerprints([["source", contentHashOf({ nid: 1 })]]);
    // putMappings stamps fingerprint NULL at insert; only a verified batch
    // advances it — so a failed initial import is classified "changed" on
    // the next run and re-attempted, never frozen behind the immutable skip.
    expect(classifyRow({ stub: false, consumedFingerprint: null, logicVersion: 3 }, fp, 3, false)).toBe("changed");
    expect(classifyRow({ stub: false, consumedFingerprint: fp, logicVersion: 3 }, fp, 3, false)).toBe("unchanged");
    // Logic-version bump reopens even completed rows once re-fetched.
    expect(classifyRow({ stub: false, consumedFingerprint: fp, logicVersion: 2 }, fp, 3, false)).toBe("changed");
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