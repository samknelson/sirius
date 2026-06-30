import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X } from "lucide-react";
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

interface GrievanceUserManagerProps {
  grievanceId: string;
  users: SectionUser[];
}

/**
 * Live "People" manager for a grievance. Staff search for a user by email,
 * pick a role, and assign them. The same user may be assigned several times
 * under different roles (the backend uniqueness is per grievance/user/role).
 * Each existing assignment can have its role changed inline or be removed;
 * every action issues an immediate API call and refreshes the cache.
 */
export function GrievanceUserManager({ grievanceId, users }: GrievanceUserManagerProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserSearchHit | null>(null);
  const [newRoleId, setNewRoleId] = useState<string>("");

  const { data: roles = [] } = useQuery<RoleOption[]>({
    queryKey: ["/api/options/grievance-role"],
  });

  const { data: searchHits = [] } = useQuery<UserSearchHit[]>({
    queryKey: ["/api/admin/users/search", query],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: query.trim().length >= 2 && !selectedUser,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/grievances", grievanceId] });
    await queryClient.invalidateQueries({ queryKey: ["/api/grievances"] });
  };

  const resetAdd = () => {
    setQuery("");
    setSelectedUser(null);
    setNewRoleId("");
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
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={16}
            />
            <Input
              value={selectedUser ? userLabel(selectedUser) : query}
              onChange={(e) => {
                setSelectedUser(null);
                setQuery(e.target.value);
              }}
              placeholder="Search users by email"
              className="pl-9"
              data-testid="input-user-search"
            />
            {!selectedUser && query.trim().length >= 2 && searchHits.length > 0 && (
              <div className="mt-2 border rounded-lg divide-y max-h-60 overflow-y-auto">
                {searchHits.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setSelectedUser(u);
                      setQuery("");
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-muted disabled:opacity-50"
                    data-testid={`button-select-user-${u.id}`}
                  >
                    {userLabel(u)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Select value={newRoleId} onValueChange={setNewRoleId} disabled={busy}>
              <SelectTrigger className="flex-1" data-testid="select-new-user-role">
                <SelectValue placeholder="Select a role" />
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
