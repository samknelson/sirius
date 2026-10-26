// @vitest-environment jsdom
import { act, createElement, createContext, Children, cloneElement, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListBulkAction } from "../../client/src/components/bulk/list-bulk-action";
import { BulkTemplateSelector } from "../../client/src/components/bulk/bulk-template-selector";
import { ApiError } from "../../client/src/lib/queryClient";

const { apiRequestMock, navigateMock, toastMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  navigateMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: apiRequestMock,
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/", navigateMock] }));

const MenuContext = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children, open = false, onOpenChange }: any) => (
    <MenuContext.Provider value={{ open, setOpen: onOpenChange }}>
      <div data-testid="dropdown-state" data-open={String(open)}>{children}</div>
    </MenuContext.Provider>
  ),
  DropdownMenuTrigger: ({ children }: any) => {
    const menu = useContext(MenuContext)!;
    const child = Children.only(children);
    return cloneElement(child, {
      onClick: (event: React.MouseEvent) => {
        child.props.onClick?.(event);
        menu.setOpen(!menu.open);
      },
    });
  },
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuCheckboxItem: ({ children, checked, onCheckedChange, ...props }: any) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      {children}
    </label>
  ),
  DropdownMenuItem: ({ children, onSelect, ...props }: any) => (
    <button
      type="button"
      {...props}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.({ preventDefault: () => event.preventDefault() });
      }}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => open ? <div data-testid="dialog-open">{children}</div> : null,
  DialogContent: ({ children, ...props }: any) => <section role="dialog" {...props}>{children}</section>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <footer>{children}</footer>,
  DialogHeader: ({ children }: any) => <header>{children}</header>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/select", () => {
  const SelectTrigger = () => null;
  const SelectContent = ({ children }: any) => children;
  const SelectItem = ({ children, value }: any) => createElement("option", { value }, children);
  return {
    Select: ({ children, value, onValueChange, disabled }: any) => {
    const parts = Children.toArray(children) as any[];
    const trigger = parts.find((part) => part.type === SelectTrigger);
    const content = parts.find((part) => part.type === SelectContent);
    return (
      <select
        id={trigger?.props.id}
        data-testid={trigger?.props["data-testid"]}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {content?.props.children}
      </select>
    );
  },
    SelectTrigger,
    SelectValue: () => null,
    SelectContent,
    SelectItem,
  };
});

vi.mock("@/components/bulk/existing-message-chooser-content", () => ({
  ExistingMessageChooserContent: ({
    messages,
    selectedBulkMessageId,
    selectedContactCount,
    isLoading,
    isError,
    isPending,
    testIdPrefix,
    onSelect,
    onSubmit,
    children,
  }: any) => (
    <div>
      {isLoading && <p>Loading messages</p>}
      {isError && <p>Message load failed</p>}
      {messages.map((message: any) => (
        <button
          key={message.id}
          type="button"
          aria-pressed={selectedBulkMessageId === message.id}
          data-testid={`${testIdPrefix}-mock-existing-${message.id}`}
          onClick={() => onSelect(message.id)}
        >
          {message.name}
        </button>
      ))}
      {children}
      <button
        type="button"
        data-testid={`${testIdPrefix}-existing-submit`}
        disabled={!selectedContactCount || !selectedBulkMessageId || isPending || isLoading || isError}
        onClick={onSubmit}
      >
        Add recipients
      </button>
    </div>
  ),
}));

const templates = [
  { id: "email-bulk", name: "Email bulk template", medium: "email", contextIds: ["bulk-message"] },
  { id: "email-other", name: "Email other context", medium: "email", contextIds: ["compose-worker"] },
  { id: "postal-bulk", name: "Postal bulk template", medium: "postal", contextIds: ["bulk-message"] },
];

const existingMessages = [
  { id: "draft-one", name: "First editable draft", status: "draft", medium: ["email"], data: {} },
  { id: "draft-two", name: "Second editable draft", status: "draft", medium: ["email"], data: {} },
];

let host: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

const listProps = {
  selectedContactIds: ["contact-11", "contact-12"],
  totalMatching: 2,
  visibleSelectedCount: 2,
  onSelectAllMatching: vi.fn(),
  sourceLabel: "Benefits follow-up",
  testIdPrefix: "bulk-test",
};

function mount(node: React.ReactNode) {
  act(() => root.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>));
}

async function settle() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  }
}

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = host.querySelector(`[data-testid="${id}"]`);
  if (!found) throw new Error(`Missing test element ${id}`);
  return found as T;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function chooseTemplate(testId: string, templateId: string) {
  const select = byTestId<HTMLSelectElement>(testId);
  await act(async () => {
    select.value = templateId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function renderList() {
  mount(<ListBulkAction {...listProps} />);
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  apiRequestMock.mockReset();
  navigateMock.mockReset();
  toastMock.mockReset();
  apiRequestMock.mockImplementation(async (method: string, url: string, body?: any) => {
    if (url === "/api/components/config") return [{ componentId: "bulk", enabled: true }];
    if (url === "/api/bulk-messages") return existingMessages;
    if (url === "/api/admin/letter-templates?context_id=bulk-message") return templates;
    if (url === "/api/bulk-messages/from-recipients") {
      return {
        bulkMessage: { id: body?.bulkMessageId ?? "created-message" },
        participantsCreated: 2,
        recipientsResolved: 2,
        recipientsMissing: 0,
        participantsSkipped: 0,
      };
    }
    throw new Error(`Unexpected API request: ${method} ${url}`);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: ({ queryKey }) => apiRequestMock("GET", String(queryKey[0])),
      },
    },
  });
});

afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  host.remove();
});

describe("bulk template selector interactions", () => {
  it("limits library options to selected channels and the canonical bulk context", async () => {
    mount(
      <QueryClientProvider client={queryClient}>
        <BulkTemplateSelector
          media={["email", "sms"]}
          value={{}}
          onChange={vi.fn()}
          testIdPrefix="selector-test"
        />
      </QueryClientProvider>,
    );
    await settle();

    const emailOptions = Array.from(byTestId<HTMLSelectElement>("selector-test-template-email").options)
      .map((option) => option.textContent);
    const smsOptions = Array.from(byTestId<HTMLSelectElement>("selector-test-template-sms").options)
      .map((option) => option.textContent);
    expect(emailOptions).toEqual(["No template", "Email bulk template"]);
    expect(smsOptions).toEqual(["No template"]);
    expect(host.textContent).toContain("No bulk-context templates for this channel.");
    expect(apiRequestMock).toHaveBeenCalledWith(
      "GET",
      "/api/admin/letter-templates?context_id=bulk-message",
    );
  });

  it("shows library failures and retries the existing endpoint", async () => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.includes("/api/admin/letter-templates")) throw new Error("library unavailable");
      throw new Error(`Unexpected API request: ${url}`);
    });
    mount(
      <QueryClientProvider client={queryClient}>
        <BulkTemplateSelector media={["email"]} value={{}} onChange={vi.fn()} testIdPrefix="failure-test" />
      </QueryClientProvider>,
    );
    await settle();
    expect(host.textContent).toContain("Letter templates couldn’t be loaded");

    apiRequestMock.mockImplementation(async (_method: string, url: string) =>
      url.includes("/api/admin/letter-templates") ? [templates[0]] : [],
    );
    const retry = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Retry"));
    expect(retry).toBeTruthy();
    await click(retry!);
    await settle();
    expect(host.textContent).toContain("Email bulk template");
    expect(apiRequestMock).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])("hides template controls when the staff-only library returns %i", async (status) => {
    apiRequestMock.mockRejectedValue(new ApiError(status, "Forbidden"));
    mount(
      <QueryClientProvider client={queryClient}>
        <BulkTemplateSelector media={["email"]} value={{}} onChange={vi.fn()} testIdPrefix="forbidden-test" />
      </QueryClientProvider>,
    );
    await settle();
    expect(host.querySelector('[data-testid="forbidden-test-template-selector"]')).toBeNull();
    expect(host.textContent).not.toContain("Retry");
  });
});

describe("ListBulkAction template submissions", () => {
  it("opens the small new-draft modal, accepts an optional template, and submits it", async () => {
    renderList();
    await settle();

    await click(byTestId("bulk-test-trigger"));
    expect(byTestId("dropdown-state").getAttribute("data-open")).toBe("true");
    await click(byTestId("bulk-test-message"));
    await settle();
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Create bulk message draft");
    expect(byTestId("dropdown-state").getAttribute("data-open")).toBe("false");

    await settle();
    await chooseTemplate("bulk-test-template-email", "email-bulk");
    await click(byTestId("bulk-test-create-submit"));
    await settle();

    const submission = apiRequestMock.mock.calls.find(
      ([method, url]) => method === "POST" && url === "/api/bulk-messages/from-recipients",
    );
    expect(submission?.[2]).toMatchObject({
      contactIds: listProps.selectedContactIds,
      sourceLabel: "Benefits follow-up",
      medium: ["email"],
      templateIds: { email: "email-bulk" },
    });
  });

  it("sends templates only for the selected existing draft and clears them when switching targets", async () => {
    renderList();
    await settle();
    await click(byTestId("bulk-test-trigger"));
    await click(byTestId("bulk-test-existing-message"));
    await settle();

    await click(byTestId("bulk-test-mock-existing-draft-one"));
    await settle();
    await chooseTemplate("bulk-test-template-email", "email-bulk");
    await click(byTestId("bulk-test-mock-existing-draft-two"));
    await settle();
    expect(byTestId<HTMLSelectElement>("bulk-test-template-email").value).toBe("none");

    await chooseTemplate("bulk-test-template-email", "email-bulk");
    await click(byTestId("bulk-test-existing-submit"));
    await settle();

    const submission = apiRequestMock.mock.calls.find(
      ([method, url]) => method === "POST" && url === "/api/bulk-messages/from-recipients",
    );
    expect(submission?.[2]).toMatchObject({
      contactIds: listProps.selectedContactIds,
      bulkMessageId: "draft-two",
      templateIds: { email: "email-bulk" },
    });
    expect(submission?.[2]?.medium).toBeUndefined();
  });
});
