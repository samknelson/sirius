import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { hasRecordMetadataPermission } from "../client/src/hooks/useRecordMetadata";
import { RecordMetadataAccess } from "../client/src/components/shared/RecordMetadataAccess";

const { hasPermission } = vi.hoisted(() => ({
  hasPermission: vi.fn((permission: string) => permission === "metadata.view"),
}));

vi.mock("../client/src/contexts/AuthContext", () => ({
  useAuth: () => ({ hasPermission }),
}));

const paymentView = readFileSync("client/src/pages/payment-view.tsx", "utf8");
const dispatchDetails = readFileSync("client/src/pages/dispatch/job-details.tsx", "utf8");
const userAccount = readFileSync("client/src/pages/admin/user-account.tsx", "utf8");
const webServicePages = [
  "client/src/pages/config/ws/client-settings.tsx",
  "client/src/pages/config/ws/client-credentials.tsx",
  "client/src/pages/config/ws/client-ip-rules.tsx",
].map((path) => readFileSync(path, "utf8"));

describe("record metadata UI permission gate", () => {
  it("recognizes only the dedicated metadata.view permission", () => {
    expect(hasRecordMetadataPermission(["staff", "metadata.view"])).toBe(true);
    expect(hasRecordMetadataPermission(["staff", "admin"])).toBe(false);
  });

  it("omits gated content when the user lacks metadata.view", () => {
    hasPermission.mockReturnValue(false);
    const markup = renderToStaticMarkup(
      createElement(
        RecordMetadataAccess,
        null,
        createElement("span", null, "created by Sam"),
      ),
    );

    expect(markup).toBe("");
  });

  it("renders gated content for metadata viewers", () => {
    hasPermission.mockImplementation((permission) => permission === "metadata.view");
    const markup = renderToStaticMarkup(
      createElement(
        RecordMetadataAccess,
        null,
        createElement("span", null, "created by Sam"),
      ),
    );

    expect(markup).toContain("created by Sam");
  });

  it("keeps every provenance consumer behind the shared permission-aware path", () => {
    expect(paymentView).toContain("useRecordMetadata");
    expect(dispatchDetails).toContain("useRecordMetadata");
    expect(userAccount).toContain("useRecordMetadata");
    for (const source of webServicePages) {
      expect(source).toContain("RecordMetadataAccess");
    }
  });
});