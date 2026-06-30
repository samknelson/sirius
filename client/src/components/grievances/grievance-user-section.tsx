import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface SectionUser {
  id: string;
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roleId: string;
  roleName: string | null;
}

interface RoleOption {
  id: string;
  name: string;
  data?: { permittedSystemRoleIds?: string[] } | null;
}

interface UserSearchHit {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

function userLabel(u: {
  email: string;
  firstName: string | null;
  lastName: string | null;
}): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return name.length > 0 ? `${name} (${u.email})` : u.email;
}

// How many eligible users the picker shows before switching from a plain
// dropdown into "type to search" mode. We fetch one extra to detect truncation.
const PREFILL_LIMIT = 20;

interface GrievanceUserManagerProps {
  grievanceId: string;
  users: SectionUser[];
}

/**
 * Live "People" manager for a grievance. Staff pick a grievance role first,
 * then choose a user from a combobox that opens as a dropdown prefilled with
 * eligible users (the common small case) and switches to server-backed
 * search-as-you-type when the eligible pool is large. The same user may be
 * assigned several times under different roles (the backend uniqueness is per
 * grievance/user/role). Each existing assignment can have its role changed
 * inline or be removed; every action issues an immediate API call and
 * refreshes the cache.
 */
export function GrievanceUserManager({ grievanceId, users }: GrievanceUserManagerProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserSearchHit | null>(null);
  const [newRoleId, setNewRoleId] = useState<string>("");

  const { data: roles = [] } = useQuery<RoleOption[]>({
    queryKey: ["/api/options/grievance-role"],
  });

  // The grievance role must be picked first; its permitted system roles
  // then restrict which users are eligible. Empty list = any user.
  const permittedRoleIds =
    roles.find((r) => r.id === newRoleId)?.data?.permittedSystemRoleIds ?? [];
  const roleIdsParam = permittedRoleIds.join(",");

  const { data: searchHits = [], isFetching } = useQuery<UserSearchHit[]>({
    queryKey: ["/api/admin/users/search", newRoleId, roleIdsParam, query],
    queryFn: async () => {
      const params = new URLSearchParams({
        q: query,
        limit: String(PREFILL_LIMIT + 1),
      });
      if (roleIdsParam) params.set("roleIds", roleIdsParam);
      const res = await fetch(`/api/admin/users/search?${params.toString()}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    // Only fetch while the picker is open and a role has been chosen. We do
    // NOT keep previous data: a role change alters eligibility, so showing the
    // prior role's results while the new request is in flight would briefly
    // surface ineligible users.
    enabled: pickerOpen && !!newRoleId,
  });

  const truncated = searchHits.length > PREFILL_LIMIT;
  const visibleHits = searchHits.slice(0, PREFILL_LIMIT);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/grievances", grievanceId] });
    await queryClient.invalidateQueries({ queryKey: ["/api/grievances"] });
  };

  const resetAdd = () => {
    setQuery("");
    setSelectedUser(null);
    setNewRoleId("");
    setPickerOpen(false);
  };

  const onRoleChange = (v: string) => {
    setNewRoleId(v);
    // Eligible users depend on the role, so clear any in-progress selection
    // and search state when the role changes.
    setSelectedUser(null);
    setQuery("");
    setPickerOpen(false);
  };

  const onAdd = async () => {
    if (!selectedUser || !newRoleId) {
      toast({ title: "Pick a user and a role", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await apiRequest("POST", `/api/grievances/${grievanceId}/users`, {
        userId: selectedUser.id,
        roleId: newRoleId,
      });
      await refresh();
      resetAdd();
      toast({ title: "User assigned" });
    } catch (error: any) {
      toast({
        title: "Failed to assign user",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const onChangeRole = async (rowId: string, roleId: string) => {
    setBusy(true);
    try {
      await apiRequest("PATCH", `/api/grievances/${grievanceId}/users/${rowId}`, {
        roleId,
      });
      await refresh();
      toast({ title: "Role updated" });
    } catch (error: any) {
      toast({
        title: "Failed to update role",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (rowId: string) => {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/grievances/${grievanceId}/users/${rowId}`);
      await refresh();
      toast({ title: "User removed" });
    } catch (error: any) {
      toast({
        title: "Failed to remove user",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>People</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border rounded-lg p-3 space-y-3" data-testid="form-add-grievance-user">
          <Select value={newRoleId} onValueChange={onRoleChange} disabled={busy}>
            <SelectTrigger className="w-full" data-testid="select-new-user-role">
              <SelectValue placeholder="Select a role first" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem
                  key={r.id}
                  value={r.id}
                  data-testid={`option-new-user-role-${r.id}`}
                >
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover
            open={pickerOpen}
            onOpenChange={(open) => {
              setPickerOpen(open);
              if (!open) setQuery("");
            }}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={pickerOpen}
                disabled={busy || !newRoleId}
                className="w-full justify-between font-normal"
                data-testid="button-open-user-picker"
              >
                <span className="truncate" data-testid="text-selected-user">
                  {selectedUser
                    ? userLabel(selectedUser)
                    : newRoleId
                      ? "Select a user"
                      : "Select a role first"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[var(--radix-popover-trigger-width)] p-0"
              align="start"
            >
              <Command shouldFilter={false}>
                <CommandInput
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search users by email"
                  data-testid="input-user-search"
                />
                <CommandList>
                  {visibleHits.length === 0 ? (
                    <div
                      className="py-6 text-center text-sm text-muted-foreground"
                      data-testid="text-no-eligible-users"
                    >
                      {isFetching ? "Searching…" : "No eligible users found."}
                    </div>
                  ) : (
                    <CommandGroup>
                      {visibleHits.map((u) => (
                        <CommandItemSelectable
                          key={u.id}
                          user={u}
                          selected={selectedUser?.id === u.id}
                          onSelect={() => {
                            setSelectedUser(u);
                            setPickerOpen(false);
                            setQuery("");
                          }}
                        />
                      ))}
                    </CommandGroup>
                  )}
                  {truncated && (
                    <div
                      className="border-t px-3 py-2 text-xs text-muted-foreground"
                      data-testid="text-user-search-hint"
                    >
                      Showing first {PREFILL_LIMIT} — type to search
                    </div>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={busy || !selectedUser || !newRoleId}
              onClick={onAdd}
              data-testid="button-add-grievance-user"
            >
              Add
            </Button>
          </div>
        </div>

        {users.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="text-no-grievance-users">
            No people assigned.
          </p>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between gap-2 border rounded-lg px-3 py-2"
                data-testid={`row-grievance-user-${u.id}`}
              >
                <div className="min-w-0">
                  <p className="truncate" data-testid={`text-grievance-user-name-${u.id}`}>
                    {userLabel(u)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Select
                    value={u.roleId}
                    onValueChange={(v) => onChangeRole(u.id, v)}
                    disabled={busy}
                  >
                    <SelectTrigger
                      className="w-44"
                      data-testid={`select-grievance-user-role-${u.id}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem
                          key={r.id}
                          value={r.id}
                          data-testid={`option-grievance-user-role-${u.id}-${r.id}`}
                        >
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    onClick={() => onRemove(u.id)}
                    data-testid={`button-remove-grievance-user-${u.id}`}
                  >
                    <X size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CommandItemSelectable({
  user,
  selected,
  onSelect,
}: {
  user: UserSearchHit;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={user.id}
      onSelect={onSelect}
      className="cursor-pointer"
      data-testid={`button-select-user-${user.id}`}
    >
      <Check className={cn("mr-2 h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
      <span className="truncate">{userLabel(user)}</span>
    </CommandItem>
  );
}
