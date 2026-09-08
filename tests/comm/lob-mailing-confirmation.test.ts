import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/config/env-registry", () => ({
  getEnvironmentVariable: (name: string) => name === "LOB_WEBHOOK_SECRET" ? "test-webhook-secret" : undefined,
  registerEnvironmentVariables: () => undefined,
}));

const { isLobMailingConfirmedEvent, LobStatusHandler } = await import(
  "../../server/services/comm/callback-handlers/lob"
);

describe("Lob mailing confirmation", () => {
  it.each([
    "letter.mailed",
    "letter.in_transit",
    "letter.in_local_area",
    "letter.processed_for_delivery",
    "letter.delivered",
    "letter.re-routed",
    "letter.certified.mailed",
    "letter.certified.pickup_available",
  ])("accepts mailed-or-later event %s", (event) => {
    expect(isLobMailingConfirmedEvent(event)).toBe(true);
  });

  it.each([
    "letter.created",
    "letter.rendered",
    "letter.rendered_pdf",
    "letter.deleted",
    "letter.returned_to_sender",
    "letter.certified.returned_to_sender",
    "letter.certified.issue",
  ])("does not accept non-mailing event %s", (event) => {
    expect(isLobMailingConfirmedEvent(event)).toBe(false);
  });
});

describe("Lob webhook authentication", () => {
  it("accepts a current signature over the exact raw request body", async () => {
    const rawBody = Buffer.from('{"event_type":{"id":"letter.mailed"}}');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "test-webhook-secret")
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest("hex");
    const req = {
      rawBody,
      header: (name: string) => ({
        "lob-signature": signature,
        "lob-signature-timestamp": timestamp,
      })[name.toLowerCase()],
    };
    await expect(new LobStatusHandler().validateRequest(req as never))
      .resolves.toEqual({ valid: true });
  });

  it("rejects a bad signature and an expired replay", async () => {
    const rawBody = Buffer.from("{}");
    const currentTimestamp = String(Math.floor(Date.now() / 1000));
    const expiredTimestamp = String(Math.floor(Date.now() / 1000) - 301);
    const handler = new LobStatusHandler();
    await expect(handler.validateRequest({
      rawBody,
      header: (name: string) => name.toLowerCase() === "lob-signature-timestamp" ? currentTimestamp : "bad",
    } as never)).resolves.toMatchObject({ valid: false, error: "Invalid Lob webhook signature" });
    await expect(handler.validateRequest({
      rawBody,
      header: (name: string) => name.toLowerCase() === "lob-signature-timestamp" ? expiredTimestamp : "bad",
    } as never)).resolves.toMatchObject({ valid: false, error: "Lob signature timestamp is outside the allowed window" });
  });
});