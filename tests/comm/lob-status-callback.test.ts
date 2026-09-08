import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const state = vi.hoisted(() => ({
  comm: {
    id: "comm-1",
    medium: "postal",
    contactId: "contact-1",
    status: "queued",
    sent: null as Date | null,
    data: {} as Record<string, unknown>,
    postalDetails: {
      id: "postal-1",
      lobLetterId: "ltr_test",
      data: {} as Record<string, unknown>,
    },
  },
  updateComm: vi.fn(),
  updatePostal: vi.fn(),
  transactionTail: Promise.resolve() as Promise<unknown>,
}));

vi.mock("../../server/storage/comm", () => ({
  createCommStorage: () => ({
    getCommWithDetails: async (id: string) => id === state.comm.id ? state.comm : undefined,
    updateComm: state.updateComm,
    lockComm: vi.fn(),
  }),
  createCommSmsStorage: () => ({ updateCommSms: vi.fn() }),
  createCommEmailStorage: () => ({ updateCommEmail: vi.fn() }),
  createCommPostalStorage: () => ({
    getCommPostalByLobLetterId: async (letterId: string) =>
      letterId === state.comm.postalDetails.lobLetterId
        ? { commPostal: state.comm.postalDetails, comm: state.comm }
        : undefined,
    updateCommPostal: state.updatePostal,
    mergeCommPostalData: async (
      _id: string,
      patch: Record<string, unknown>,
      preserveMailingConfirmation: boolean,
    ) => {
      const existing = state.comm.postalDetails.data;
      state.comm.postalDetails.data = {
        ...existing,
        ...patch,
        ...(preserveMailingConfirmation && existing.mailingConfirmedAt
          ? {
              mailingConfirmedAt: existing.mailingConfirmedAt,
              mailingConfirmedEvent: existing.mailingConfirmedEvent,
            }
          : {}),
      };
      return state.comm.postalDetails;
    },
  }),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    baoCases: {
      tableExists: async () => false,
    },
  },
}));

vi.mock("../../server/logger", () => ({
  storageLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: (fn: () => Promise<unknown>) => {
    const run = state.transactionTail.then(fn);
    state.transactionTail = run.catch(() => undefined);
    return run;
  },
}));

import { handleLobStatusCallback } from "../../server/services/comm/callback-handlers/handler";

const secret = "test-lob-webhook-secret";

function signedRequest(eventType: string, eventCreated: string, validSignature = true): Request {
  const body = {
    id: `evt_${eventType}`,
    event_type: { id: eventType },
    date_created: eventCreated,
    body: {
      id: "ltr_test",
      metadata: { commId: "comm-1", contactId: "contact-1" },
    },
  };
  const rawBody = Buffer.from(JSON.stringify(body));
  const signatureTimestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", validSignature ? secret : "wrong-secret")
    .update(`${signatureTimestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
  const headers: Record<string, string> = {
    "lob-signature": signature,
    "lob-signature-timestamp": signatureTimestamp,
  };
  return {
    body,
    rawBody,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function response() {
  const result = {
    statusCode: 200,
    body: "",
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(body: string) {
      this.body = body;
      return this;
    },
  };
  return result as typeof result & Response;
}

describe("account-level Lob status callback", () => {
  beforeEach(() => {
    process.env.LOB_WEBHOOK_SECRET = secret;
    state.comm.status = "queued";
    state.comm.sent = null;
    state.comm.data = {};
    state.comm.postalDetails.data = {};
    state.transactionTail = Promise.resolve();
    state.updateComm.mockReset().mockImplementation(async (_id, update) => {
      Object.assign(state.comm, update);
      return state.comm;
    });
    state.updatePostal.mockReset().mockImplementation(async (_id, update) => {
      Object.assign(state.comm.postalDetails, update);
      return state.comm.postalDetails;
    });
  });

  it("resolves the provider letter ID and advances the same queued row to sent at Lob's event time", async () => {
    const mailedAt = "2026-09-08T12:00:00.000Z";
    const res = response();

    await handleLobStatusCallback(signedRequest("letter.mailed", mailedAt), res);

    expect(res.statusCode).toBe(200);
    expect(state.comm.status).toBe("sent");
    expect(state.comm.sent?.toISOString()).toBe(mailedAt);
    expect(state.updateComm).toHaveBeenCalledWith(
      "comm-1",
      expect.objectContaining({
        status: "sent",
        sent: new Date(mailedAt),
      }),
    );
  });

  it("keeps terminal state and sent time when an older callback arrives later", async () => {
    await handleLobStatusCallback(
      signedRequest("letter.delivered", "2026-09-08T13:00:00.000Z"),
      response(),
    );
    await handleLobStatusCallback(
      signedRequest("letter.rendered", "2026-09-08T11:00:00.000Z"),
      response(),
    );

    expect(state.comm.status).toBe("delivered");
    expect(state.comm.sent?.toISOString()).toBe("2026-09-08T13:00:00.000Z");
    expect(state.comm.data.lastProviderStatus).toBe("letter.rendered");
  });

  it("refuses forged callbacks before mutating a communication", async () => {
    const res = response();

    await handleLobStatusCallback(
      signedRequest("letter.mailed", "2026-09-08T12:00:00.000Z", false),
      res,
    );

    expect(res.statusCode).toBe(403);
    expect(state.updateComm).not.toHaveBeenCalled();
  });

  it("serializes concurrent later and earlier callbacks without regressing", async () => {
    await Promise.all([
      handleLobStatusCallback(
        signedRequest("letter.delivered", "2026-09-08T13:00:00.000Z"),
        response(),
      ),
      handleLobStatusCallback(
        signedRequest("letter.rendered", "2026-09-08T11:00:00.000Z"),
        response(),
      ),
    ]);

    expect(state.comm.status).toBe("delivered");
    expect(state.comm.sent?.toISOString()).toBe("2026-09-08T13:00:00.000Z");
  });
});