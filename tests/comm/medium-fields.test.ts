import { describe, it, expect } from "vitest";
import {
  MEDIUM_FIELDS,
  applyFieldEligibility,
  authoredFieldValue,
  mediumField,
  tokenCleanerFor,
} from "@shared/delivery-fields";

/**
 * WHAT A SURFACE AUTHORS vs WHAT A MEDIUM REQUIRES.
 *
 * These are the two rules the shared medium declarations exist to
 * settle, and both broke silently while the declarations were being
 * unified: a surface that does not author an optional field had its
 * message reported as undeliverable, and an in-app link that carries a
 * token was sent verbatim from one surface and rendered from another.
 * Neither shows up as a crash or a type error — one produces a message
 * that simply never arrives, the other a link reading "/dispatch/job/
 * {{job.id}}".
 */
describe("medium field declarations", () => {
  it("leaves an unsupplied optional field out instead of requiring it", () => {
    const spec = mediumField("inapp", "linkUrl");
    expect(authoredFieldValue(spec, undefined)).toBeUndefined();
    expect(authoredFieldValue(spec, null)).toBeUndefined();

    const shaped = applyFieldEligibility(MEDIUM_FIELDS.inapp, {
      title: "Job filled",
      body: "Your job has been filled.",
    });
    expect(shaped.deliverable).toBe(true);
    expect(shaped.blankRequired).toEqual([]);
    expect("linkUrl" in shaped.values).toBe(false);
  });

  it("treats a required field the surface never supplied as the blank it is", () => {
    const subject = mediumField("email", "subject");
    expect(authoredFieldValue(subject, undefined)).toBe("");

    const shaped = applyFieldEligibility(MEDIUM_FIELDS.email, {
      subject: "",
      bodyHtml: "<p>Hello.</p>",
    });
    expect(shaped.deliverable).toBe(false);
    expect(shaped.blankRequired).toEqual(["subject"]);
  });

  it("drops a link label whose link came out blank", () => {
    const shaped = applyFieldEligibility(MEDIUM_FIELDS.inapp, {
      title: "Job filled",
      body: "Your job has been filled.",
      linkUrl: "",
      linkLabel: "View job",
    });
    expect(shaped.deliverable).toBe(true);
    expect("linkLabel" in shaped.values).toBe(false);
  });

  it("renders the in-app link like every other field", () => {
    // Not `tokenized: false`: shipped links point at the record the
    // notification is about, so a link that could not carry a token
    // would be a link to nothing in particular — and a surface sending
    // it verbatim would deliver the token expression as text.
    expect(tokenCleanerFor(mediumField("inapp", "linkUrl"))).not.toBeNull();
    expect(mediumField("inapp", "linkUrl").safety).toBe("relative-url");
  });

  it("names each medium's fields once", () => {
    expect(MEDIUM_FIELDS.sms.map((f) => f.key)).toEqual(["body"]);
    // No authored plain-text part: it is derived from the HTML body at
    // send, so the two parts of one email cannot disagree.
    expect(MEDIUM_FIELDS.email.map((f) => f.key)).toEqual(["subject", "bodyHtml"]);
    expect(() => mediumField("email", "bodyText")).toThrow();
  });
});
