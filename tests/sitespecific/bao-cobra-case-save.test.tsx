// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, invalidateQueries, navigate, toast } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: {
    mutationFn: (variables: any) => Promise<any>;
    onSuccess: (data: any) => any;
    onError: (error: unknown) => any;
  }) => ({
    isPending: false,
    mutate: (variables: any) => {
      void options.mutationFn(variables).then(options.onSuccess, options.onError);
    },
  }),
  queryClient: { invalidateQueries },
}));
vi.mock("@/lib/queryClient", () => ({ apiRequest, queryClient: { invalidateQueries } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLocation: () => ["/", navigate],
}));
vi.mock("@/components/layouts/BaoCobraCaseLayout", () => ({
  BaoCobraCaseLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useBaoCobraCaseLayout: () => ({
    cobraCase: {
      id: "case-123",
      source: "manual",
      statusId: "status-open",
      qualifyingEventId: null,
      coveredPersonWorkerId: "worker-covered",
      subscriberWorkerId: "worker-subscriber",
      coveredPersonName: "Covered Person",
      subscriberName: "Subscriber",
      relationship: "child",
      cobraEffectiveYmd: "2026-01-01",
      electionMadeYmd: null,
      paymentStatus: null,
      medicalBenefitLostId: null,
      dentalBenefitLostId: null,
    },
  }),
}));
vi.mock("@/components/sitespecific/bao/CobraCaseForm", () => ({
  CobraCaseForm: ({ onSubmit }: { onSubmit: (values: any) => void }) => (
    <button
      data-testid="submit-case"
      onClick={() =>
        onSubmit({
          source: "manual",
          statusId: "status-open",
          qualifyingEventId: null,
          coveredPersonWorkerId: "worker-covered",
          subscriberWorkerId: "worker-subscriber",
          relationship: "child",
          cobraEffectiveYmd: "2026-01-01",
          electionMadeYmd: null,
          paymentStatus: null,
          medicalBenefitLostId: null,
          dentalBenefitLostId: null,
        })
      }
    >
      Submit
    </button>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: () => null }));

import BaoCobraCaseAdd from "../../client/src/pages/sitespecific/bao/cobra-case-add";
import BaoCobraCaseEdit from "../../client/src/pages/sitespecific/bao/cobra-case-edit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  apiRequest.mockReset();
  invalidateQueries.mockReset().mockResolvedValue(undefined);
  navigate.mockReset();
  toast.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function submit(Component: typeof BaoCobraCaseAdd | typeof BaoCobraCaseEdit) {
  await act(async () => {
    root.render(<Component />);
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-testid="submit-case"]')!.click();
    await Promise.resolve();
  });
}

describe("COBRA case save responses", () => {
  it("completes an edit when apiRequest returns parsed JSON", async () => {
    apiRequest.mockResolvedValue({ id: "case-123", statusId: "status-updated" });

    await submit(BaoCobraCaseEdit);

    expect(apiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/sitespecific/bao/cobra/cases/case-123",
      expect.objectContaining({ statusId: "status-open" }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/sitespecific/bao/cobra/cases"],
    });
    expect(toast).toHaveBeenCalledWith({ title: "COBRA case updated" });
    expect(navigate).toHaveBeenCalledWith("/cobra/cases/case-123");
  });

  it("navigates to the created case using the parsed apiRequest result", async () => {
    apiRequest.mockResolvedValue({ id: "case-created" });

    await submit(BaoCobraCaseAdd);

    expect(apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/sitespecific/bao/cobra/cases",
      expect.objectContaining({ coveredPersonWorkerId: "worker-covered" }),
    );
    expect(toast).toHaveBeenCalledWith({ title: "COBRA case created" });
    expect(navigate).toHaveBeenCalledWith("/cobra/cases/case-created");
  });

  it("shows the existing error toast when the edit request is rejected", async () => {
    apiRequest.mockRejectedValue(new Error("403: Case is not editable"));

    await submit(BaoCobraCaseEdit);

    expect(toast).toHaveBeenCalledWith({
      title: "Failed to update COBRA case",
      description: "403: Case is not editable",
      variant: "destructive",
    });
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
