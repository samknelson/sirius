import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { invalidateMailCsvQueries, requestMailCsv } from "../../client/src/lib/bulk-mail-csv";

const state = vi.hoisted(() => ({
  bulkMessage: {
    id: "message", name: "Mailing", medium: ["postal"], status: "draft",
    sendDate: null, data: { offline: true },
  },
}));
vi.mock("@/components/layouts/BulkMessageLayout", () => ({
  BulkMessageLayout: ({ children }: { children: ReactNode }) => children,
  useBulkMessageLayout: () => state,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/bulk/TokenCoverageCard", () => ({ TokenCoverageCard: () => null }));

import DeliverPage from "../../client/src/pages/bulk-message-deliver";

function render(status: string, offline: boolean, medium = ["postal"], stats?: unknown) {
  state.bulkMessage = {
    ...state.bulkMessage, status, medium, data: { offline },
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (stats) client.setQueryData(["/api/bulk-messages", "message", "delivery-stats"], stats);
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}><DeliverPage /></QueryClientProvider>,
  );
  client.clear();
  return markup;
}

describe("offline postal delivery controls", () => {
  it.each(["draft", "queued", "sent"])("offers the download for %s without a separate Mark Sent step", status => {
    const markup = render(status, true);
    expect(markup).toContain('data-testid="button-download-mail-csv"');
    expect(markup).toContain("marks the message as sent");
    expect(markup).not.toContain('data-testid="button-queue"');
    expect(markup).not.toContain('data-testid="button-mark-sent"');
    expect(markup).toContain("Only recipients not yet mailed");
    expect(markup).toContain("All recipients (re-download)");
    expect(markup).not.toContain("included with blank address fields");
  });

  it("preserves online queue controls and other-media controls on mixed offline mailings", () => {
    expect(render("draft", false)).toContain('data-testid="button-queue"');
    expect(render("draft", false)).not.toContain('data-testid="button-download-mail-csv"');
    const mixed = render("draft", true, ["postal", "email"]);
    expect(mixed).toContain('data-testid="button-download-mail-csv"');
    expect(mixed).toContain('data-testid="button-queue"');
    expect(mixed).toContain("Other media are not included and must be handled separately");
  });

  it("classifies completed offline communications separately from errors", () => {
    const markup = render("sent", true, ["postal"], {
      total: 12,
      pending: 2,
      sendFailed: 0,
      seeComm: 10,
      commBreakdown: { offline: 2, failed: 1, undelivered: 1, sent: 3, delivered: 1, queued: 2 },
      byMedium: {
        postal: {
          total: 12,
          pending: 2,
          sendFailed: 0,
          seeComm: 10,
          commBreakdown: { offline: 2, failed: 1, undelivered: 1, sent: 3, delivered: 1, queued: 2 },
        },
      },
    });
    expect(markup).toContain('data-testid="stat-offline-completed"');
    expect(markup).toContain("Completed offline");
    expect(markup).toContain("does not confirm physical delivery");
    expect(markup).toContain('data-testid="stat-successful-count">4</p>');
    expect(markup).toContain('data-testid="stat-error-count">2</p>');
    expect(markup).toContain('data-testid="stat-offline-count">2</p>');
    expect(markup).toContain("Sent / confirmed");
    expect(markup).toContain("Errors");
    expect(markup).toContain("Completed offline: 2");
  });
});

describe("mail CSV API interaction", () => {
  it("posts the selected mode with credentials and JSON content type", async () => {
    const request = vi.fn(async () => new Response("name\nA", {
      headers: {
        "Content-Type": "text/csv",
        "X-Recipient-Count": "1",
      },
    }));
    const result = await requestMailCsv("/api/bulk-messages/message/mail-csv", "all", request as typeof fetch);
    expect(request).toHaveBeenCalledWith("/api/bulk-messages/message/mail-csv", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "all" }),
    }));
    expect(result).toMatchObject({ kind: "file", recipientCount: 1, blockedCount: 0 });
  });

  it("returns no-file and mixed-batch counts without treating JSON as a download", async () => {
    const noFileRequest = vi.fn(async () => new Response(JSON.stringify({
      noFile: true,
      message: "All remaining recipients are blocked.",
      recipientCount: 0,
      blockedCount: 3,
      missingAddressCount: 1,
    }), { headers: { "Content-Type": "application/json" } }));
    await expect(requestMailCsv("/mail-csv", "outstanding", noFileRequest as typeof fetch))
      .resolves.toMatchObject({ kind: "no-file", blockedCount: 3, missingAddressCount: 1 });

    const mixedRequest = vi.fn(async () => new Response("name\nA", {
      headers: {
        "Content-Type": "text/csv",
        "X-Recipient-Count": "4",
        "X-Blocked-Recipient-Count": "2",
        "X-Missing-Address-Count": "1",
      },
    }));
    await expect(requestMailCsv("/mail-csv", "outstanding", mixedRequest as typeof fetch))
      .resolves.toMatchObject({ kind: "file", recipientCount: 4, blockedCount: 2, missingAddressCount: 1 });
  });

  it("refreshes message, list, participants, delivery stats, and token coverage", () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    invalidateMailCsvQueries(client, "message");
    expect(invalidate.mock.calls.map(([filter]) => filter?.queryKey)).toEqual([
      ["/api/bulk-messages", "message"],
      ["/api/bulk-messages"],
      ["/api/bulk-messages", "message", "participants"],
      ["/api/bulk-messages", "message", "delivery-stats"],
      ["/api/bulk-messages", "message", "token-coverage"],
    ]);
    client.clear();
  });
});
