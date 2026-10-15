import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

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

function render(status: string, offline: boolean, medium = ["postal"]) {
  state.bulkMessage = {
    ...state.bulkMessage, status, medium, data: { offline },
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    expect(markup).toContain("marks this whole message as sent");
    expect(markup).not.toContain('data-testid="button-queue"');
    expect(markup).not.toContain('data-testid="button-mark-sent"');
  });

  it("preserves online queue controls and other-media controls on mixed offline mailings", () => {
    expect(render("draft", false)).toContain('data-testid="button-queue"');
    expect(render("draft", false)).not.toContain('data-testid="button-download-mail-csv"');
    const mixed = render("draft", true, ["postal", "email"]);
    expect(mixed).toContain('data-testid="button-download-mail-csv"');
    expect(mixed).toContain('data-testid="button-queue"');
    expect(mixed).toContain("Complete delivery for the other media before downloading");
  });
});
