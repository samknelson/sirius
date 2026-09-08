import { describe, expect, it } from "vitest";
import type { Request } from "express";
import {
  LobStatusHandler,
  resolveLobCallbackStatus,
} from "../../server/services/comm/callback-handlers/lob";

const handler = new LobStatusHandler();

function parse(eventType: string, timestamp = "2026-09-08T12:00:00.000Z") {
  return handler.parseStatusUpdate({
    body: {
      event_type: { id: eventType },
      date_created: timestamp,
      date_modified: "2026-09-08T14:00:00.000Z",
      body: { id: "ltr_test" },
    },
  } as Request);
}

describe("Lob postal lifecycle", () => {
  it.each([
    ["letter.created", "queued"],
    ["letter.rendered", "queued"],
    ["letter.rendered_pdf", "queued"],
    ["letter.mailed", "sent"],
    ["letter.in_transit", "sent"],
    ["letter.processed_for_delivery", "sent"],
    ["letter.delivered", "delivered"],
    ["letter.returned_to_sender", "undelivered"],
    ["letter.deleted", "failed"],
    ["letter.certified.issue", "failed"],
  ])("maps %s to %s", (eventType, expected) => {
    expect(parse(eventType).status).toBe(expected);
  });

  it("keeps created and rendered callbacks queued", () => {
    expect(resolveLobCallbackStatus("queued", parse("letter.created").status)).toBe("queued");
    expect(resolveLobCallbackStatus("queued", parse("letter.rendered").status)).toBe("queued");
  });

  it("promotes queued to sent when Lob reports mailed", () => {
    const update = parse("letter.mailed");
    expect(update.timestamp.toISOString()).toBe("2026-09-08T12:00:00.000Z");
    expect(resolveLobCallbackStatus("queued", update.status)).toBe("sent");
  });

  it("does not regress sent or delivered communications on late callbacks", () => {
    expect(resolveLobCallbackStatus("sent", parse("letter.rendered").status)).toBe("sent");
    expect(resolveLobCallbackStatus("delivered", parse("letter.mailed").status)).toBe("delivered");
    expect(resolveLobCallbackStatus("delivered", parse("letter.created").status)).toBe("delivered");
  });

  it("is idempotent for duplicate callbacks", () => {
    expect(resolveLobCallbackStatus("sent", parse("letter.mailed").status)).toBe("sent");
    expect(resolveLobCallbackStatus("delivered", parse("letter.delivered").status)).toBe("delivered");
  });

  it("only replaces a terminal outcome with a newer terminal event", () => {
    const deliveredAt = "2026-09-08T12:00:00.000Z";
    expect(
      resolveLobCallbackStatus(
        "delivered",
        parse("letter.returned_to_sender", "2026-09-08T11:00:00.000Z").status,
        deliveredAt,
        new Date("2026-09-08T11:00:00.000Z"),
      ),
    ).toBe("delivered");
    expect(
      resolveLobCallbackStatus(
        "delivered",
        parse("letter.returned_to_sender", "2026-09-08T13:00:00.000Z").status,
        deliveredAt,
        new Date("2026-09-08T13:00:00.000Z"),
      ),
    ).toBe("undelivered");
  });

  it("ignores unknown provider events", () => {
    expect(resolveLobCallbackStatus("sent", parse("letter.future_event").status)).toBe("sent");
  });
});