// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  toast: vi.fn(),
  queryClient: null as QueryClient | null,
  rolePermissions: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: shared.apiRequest,
  queryClient: {
    invalidateQueries: vi.fn((options: { queryKey: unknown[] }) =>
      shared.queryClient?.invalidateQueries(options),
    ),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: shared.toast }),
}));

vi.mock("@/components/ui/select", async () => {
  const ReactModule = await import("react");
  type SelectContextValue = {
    value: string;
    onValueChange: (value: string) => void;
    open: boolean;
    setOpen: (open: boolean) => void;
  };
  const Context = ReactModule.createContext<SelectContextValue | null>(null);
  const useSelect = () => {
    const value = ReactModule.useContext(Context);
    if (!value) throw new Error("Select component used outside its provider");
    return value;
  };
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) => {
      const [open, setOpen] = ReactModule.useState(false);
      return (
        <Context.Provider value={{ value, onValueChange, open, setOpen }}>
          {children}
        </Context.Provider>
      );
    },
    SelectTrigger: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
      const select = useSelect();
      return (
        <button type="button" {...props} role="combobox" onClick={() => select.setOpen(!select.open)}>
          {children}
        </button>
      );
    },
    SelectValue: ({ placeholder }: { placeholder?: string }) => {
      const select = useSelect();
      return <span>{select.value || placeholder}</span>;
    },
    SelectContent: ({ children }: { children: React.ReactNode }) => {
      const select = useSelect();
      return select.open ? <div role="listbox">{children}</div> : null;
    },
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children: React.ReactNode;
    }) => {
      const select = useSelect();
      return (
        <button
          type="button"
          role="option"
          aria-selected={select.value === value}
          data-testid={`role-option-${value}`}
          onClick={() => {
            select.onValueChange(value);
            select.setOpen(false);
          }}
        >
          {children}
        </button>
      );
    },
  };
});

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean | "indeterminate";
    onCheckedChange: (checked: boolean) => void;
  } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "checked" | "onChange">) => (
    <input
      type="checkbox"
      checked={checked === true}
      data-indeterminate={checked === "indeterminate" ? "true" : undefined}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
      {...props}
    />
  ),
}));

import PermissionsManagement from "../client/src/components/admin/PermissionsManagement";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roles = [
  { id: "role-a", name: "Role A", description: null },
  { id: "role-b", name: "Role B", description: null },
];
const permissions = [
  { key: "alpha", description: "Alpha access", module: "core" },
  { key: "beta", description: "Beta access", module: "core" },
  { key: "gamma", description: "Gamma access", module: "core" },
];
const initialAssignments = [
  {
    roleId: "role-a",
    permissionKey: "alpha",
    assignedAt: "2026-09-05T00:00:00.000Z",
    role: roles[0],
  },
  {
    roleId: "role-b",
    permissionKey: "beta",
    assignedAt: "2026-09-05T00:00:00.000Z",
    role: roles[1],
  },
];

let root: Root;
let container: HTMLDivElement;
let testQueryClient: QueryClient;

async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function byTestId<T extends HTMLElement>(testId: string): T {
  const element = container.querySelector<T>(`[data-testid="${testId}"]`);
  if (!element) throw new Error(`Missing element ${testId}: ${container.innerHTML}`);
  return element;
}

async function render(): Promise<void> {
  testQueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          switch (queryKey[0]) {
            case "/api/admin/permissions":
              return permissions;
            case "/api/admin/roles":
              return roles;
            case "/api/admin/role-permissions":
              return shared.rolePermissions;
            default:
              throw new Error(`Unexpected query: ${queryKey[0]}`);
          }
        },
      },
      mutations: { retry: false },
    },
  });
  shared.queryClient = testQueryClient;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={testQueryClient}>
        <PermissionsManagement />
      </QueryClientProvider>,
    );
  });
  await settle();
}

async function chooseRole(roleId: string): Promise<void> {
  await act(async () => {
    byTestId<HTMLButtonElement>("select-permission-role").click();
  });
  await act(async () => {
    byTestId<HTMLButtonElement>(`role-option-${roleId}`).click();
  });
}

async function toggleCheckbox(testId: string): Promise<void> {
  await act(async () => {
    byTestId<HTMLInputElement>(testId).click();
  });
}

beforeEach(() => {
  shared.apiRequest.mockReset();
  shared.toast.mockReset();
  shared.rolePermissions = [...initialAssignments];
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  testQueryClient.clear();
  shared.queryClient = null;
  container.remove();
});

describe("permissions management assignment workflow", () => {
  it("offers only permissions not assigned to the selected role and clears checks after changing roles", async () => {
    await render();

    const assignButton = byTestId<HTMLButtonElement>("button-assign-permission");
    expect(assignButton.disabled).toBe(true);
    await chooseRole("role-a");
    expect(container.querySelector('[data-testid="checkbox-permission-alpha"]')).toBeNull();
    expect(byTestId("checkbox-permission-beta")).toBeTruthy();
    expect(container.querySelector('[data-testid="checkbox-permission-gamma"]')).not.toBeNull();

    await toggleCheckbox("checkbox-permission-beta");
    expect(assignButton.textContent).toContain("Assign 1 Permission");
    await chooseRole("role-b");
    expect(container.querySelector('[data-testid="checkbox-permission-beta"]')).toBeNull();
    expect(byTestId<HTMLInputElement>("checkbox-permission-alpha").checked).toBe(false);
    expect(byTestId<HTMLButtonElement>("button-assign-permission").disabled).toBe(true);
  });

  it("selects and clears all available permissions and submits the checked keys to the bulk route", async () => {
    await render();
    await chooseRole("role-a");

    await toggleCheckbox("checkbox-permission-beta");
    expect(byTestId<HTMLInputElement>("checkbox-select-all-permissions").dataset.indeterminate).toBe("true");
    await toggleCheckbox("checkbox-select-all-permissions");
    expect(byTestId<HTMLInputElement>("checkbox-permission-beta").checked).toBe(true);
    expect(byTestId<HTMLInputElement>("checkbox-permission-gamma").checked).toBe(true);
    expect(byTestId<HTMLButtonElement>("button-assign-permission").textContent).toContain("Assign 2 Permissions");

    await toggleCheckbox("checkbox-select-all-permissions");
    expect(byTestId<HTMLInputElement>("checkbox-permission-beta").checked).toBe(false);
    expect(byTestId<HTMLButtonElement>("button-assign-permission").disabled).toBe(true);
    await toggleCheckbox("checkbox-permission-beta");
    await toggleCheckbox("checkbox-permission-gamma");

    shared.apiRequest.mockImplementation(async (_method, _url, payload) => {
      shared.rolePermissions = [
        ...shared.rolePermissions,
        ...payload.permissionKeys.map((permissionKey: string) => ({
          roleId: "role-a",
          permissionKey,
          assignedAt: "2026-10-15T00:00:00.000Z",
          role: roles[0],
        })),
      ];
      return {
        message: "2 permission(s) assigned successfully",
        assignments: shared.rolePermissions.filter((row) => row.roleId === "role-a" && payload.permissionKeys.includes(row.permissionKey)),
      };
    });

    await act(async () => {
      byTestId<HTMLButtonElement>("button-assign-permission").click();
    });
    await settle();

    expect(shared.apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/admin/roles/role-a/permissions/bulk",
      { permissionKeys: ["beta", "gamma"] },
    );
    expect(byTestId("badge-role-beta-role-a").textContent).toBe("Role A");
    expect(byTestId("badge-role-gamma-role-a").textContent).toBe("Role A");
    expect(container.querySelector('[data-testid="checkbox-permission-beta"]')).toBeNull();
    expect(byTestId<HTMLButtonElement>("button-assign-permission").disabled).toBe(true);
    expect(shared.toast).toHaveBeenLastCalledWith({
      title: "Success",
      description: "2 permission(s) assigned successfully",
    });
  });

  it("shows pending state, prevents duplicate edits, and preserves selection on request failure", async () => {
    await render();
    await chooseRole("role-a");
    await toggleCheckbox("checkbox-permission-gamma");

    let rejectRequest!: (error: Error) => void;
    shared.apiRequest.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );
    await act(async () => {
      byTestId<HTMLButtonElement>("button-assign-permission").click();
    });
    await settle();
    expect(byTestId<HTMLButtonElement>("button-assign-permission").textContent).toContain("Assigning permissions");
    expect(byTestId<HTMLButtonElement>("button-assign-permission").disabled).toBe(true);
    expect(byTestId<HTMLInputElement>("checkbox-permission-gamma").disabled).toBe(true);

    await act(async () => {
      rejectRequest(new Error("403: Assignment denied"));
    });
    await settle();

    expect(byTestId<HTMLInputElement>("checkbox-permission-gamma").checked).toBe(true);
    expect(byTestId<HTMLButtonElement>("button-assign-permission").disabled).toBe(false);
    expect(shared.toast).toHaveBeenLastCalledWith({
      title: "Error",
      description: "Assignment denied",
      variant: "destructive",
    });
  });

  it("shows the all-assigned state and retains the assignment overview", async () => {
    shared.rolePermissions = permissions.map((permission) => ({
      roleId: "role-a",
      permissionKey: permission.key,
      assignedAt: "2026-09-05T00:00:00.000Z",
      role: roles[0],
    }));
    await render();
    await chooseRole("role-a");

    expect(byTestId("text-all-permissions-assigned").textContent).toContain(
      "All permissions are already assigned",
    );
    expect(byTestId("badge-role-alpha-role-a").textContent).toBe("Role A");
    expect(byTestId("button-unassign-alpha-role-a")).toBeTruthy();
  });
});
