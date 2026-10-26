import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "../../client/src/components/ui/dialog";
import {
  ExistingMessageChooserContent,
  getEditableNotStartedBulkMessages,
  type ExistingMessageChooserContentProps,
} from "../../client/src/components/bulk/existing-message-chooser-content";

const sampleMessage = {
  id: "message-17",
  name: "Winter schedule update",
  status: "draft",
  medium: ["email", "sms"],
  data: { offline: true },
};

function renderContent(overrides: Partial<ExistingMessageChooserContentProps> = {}) {
  const props: ExistingMessageChooserContentProps = {
    messages: [],
    isLoading: false,
    isError: false,
    isFetching: false,
    selectedContactCount: 2,
    selectedBulkMessageId: null,
    isPending: false,
    testIdPrefix: "chooser-test",
    onSelect: vi.fn(),
    onRetry: vi.fn(),
    onCancel: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  return renderToStaticMarkup(
    <Dialog open>
      <ExistingMessageChooserContent {...props} />
    </Dialog>,
  );
}

function buttonAttributes(markup: string, label: string) {
  const labelIndex = markup.lastIndexOf(label);
  const buttonStart = markup.lastIndexOf("<button", labelIndex);
  const buttonEnd = markup.indexOf(">", buttonStart);
  return markup.slice(buttonStart, buttonEnd);
}

describe("ExistingMessageChooserContent", () => {
  it("filters employer targets to drafts that have not started delivery", () => {
    const eligible = getEditableNotStartedBulkMessages([
      sampleMessage,
      { ...sampleMessage, id: "queued", status: "queued" },
      { ...sampleMessage, id: "started", deliveryStarted: true },
    ]);
    expect(eligible.map((message) => message.id)).toEqual(["message-17"]);
  });

  it("renders loading placeholders and a disabled submit while loading", () => {
    const markup = renderContent({ isLoading: true });
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Loading bulk messages");
    expect(buttonAttributes(markup, "Add recipients")).toContain('disabled=""');
  });

  it("renders a retry action on errors", () => {
    const markup = renderContent({ isError: true, isFetching: false });
    expect(markup).toContain("Messages couldn’t be loaded");
    expect(markup).toContain(">Retry</button>");
    expect(buttonAttributes(markup, "Retry")).not.toContain('disabled=""');
  });

  it("disables retry while a retry request is already fetching", () => {
    const markup = renderContent({ isError: true, isFetching: true });
    expect(markup).toMatch(/>Retry<\/button>/);
    expect(buttonAttributes(markup, "Retry")).toContain('disabled=""');
  });

  it("renders a composed empty state", () => {
    const markup = renderContent();
    expect(markup).toContain("No existing messages");
    expect(markup).toContain("Create a draft first");
  });

  it("renders message name, status, channels, and offline marker", () => {
    const markup = renderContent({ messages: [sampleMessage] });
    expect(markup).toContain("Winter schedule update");
    expect(markup).toContain("draft");
    expect(markup).toContain("email, sms");
    expect(markup).toContain("Offline");
    expect(markup).toContain('aria-pressed="false"');
  });

  it("enables submit only when both recipients and a target are selected", () => {
    const disabledWithoutRecipients = renderContent({
      messages: [sampleMessage],
      selectedBulkMessageId: sampleMessage.id,
      selectedContactCount: 0,
    });
    const disabledWithoutTarget = renderContent({
      messages: [sampleMessage],
      selectedContactCount: 2,
    });
    const enabled = renderContent({
      messages: [sampleMessage],
      selectedContactCount: 2,
      selectedBulkMessageId: sampleMessage.id,
    });

    expect(buttonAttributes(disabledWithoutRecipients, "Add recipients")).toContain('disabled=""');
    expect(buttonAttributes(disabledWithoutTarget, "Add recipients")).toContain('disabled=""');
    expect(enabled).toMatch(/data-testid="chooser-test-existing-submit"[^>]*>Add recipients<\/button>/);
    expect(buttonAttributes(enabled, "Add recipients")).not.toContain('disabled=""');
  });

  it("disables submit and cancel while a submission is pending", () => {
    const markup = renderContent({
      messages: [sampleMessage],
      selectedBulkMessageId: sampleMessage.id,
      isPending: true,
    });
    expect(buttonAttributes(markup, "Add recipients")).toContain('disabled=""');
    expect(buttonAttributes(markup, "Cancel")).toContain('disabled=""');
    expect(markup.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
