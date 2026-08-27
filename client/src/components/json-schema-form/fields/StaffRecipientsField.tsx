import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FieldProps } from "@rjsf/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";

interface StaffUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
}

interface RoleOption {
  id: string;
  name: string;
}

/**
 * RJSF field for picking a fixed set of staff/admin users as notification
 * recipients. Triggered by the vendor key `x-widget: "staff-recipients"` on an
 * array-of-string property (see SchemaForm's uiSchema mapping).
 *
 * Role-first: no candidate users are fetched or shown until a system role is
 * chosen; the candidate list is then the ACTIVE staff/admin holders of that
 * role. The role is purely a filtering aid — the field value stays a list of
 * explicit user ids, so future role-membership changes never silently change
 * saved recipients. Already-selected recipients are always visible and
 * removable (resolved by id), even when they don't match the current filter.
 */
export function StaffRecipientsField(props: FieldProps) {
  const { formData, onChange, disabled, readonly, fieldPathId } = props;
  const selected: string[] = Array.isArray(formData)
    ? (formData as string[])
    : [];
  const isDisabled = Boolean(disabled || readonly);
  const [roleId, setRoleId] = useState<string>("");

  const { data: roles = [], isLoading: rolesLoading } = useQuery<RoleOption[]>({
    queryKey: ["/api/admin/roles"],
  });

  // Candidates: only fetched once a role is chosen. Query key carries the
  // role, so switching roles never shows the previous role's users while the
  // new request is in flight (no placeholder/kept data — a fresh key starts
  // in its loading state).
  const {
    data: candidates = [],
    isLoading: candidatesLoading,
    isError: candidatesError,
  } = useQuery<StaffUser[]>({
    queryKey: ["/api/event-notifier/staff-users", { roleId }],
    enabled: !!roleId,
  });

  // Saved selections, resolved by id regardless of the role filter so they
  // stay visible and removable.
  const selectedKey = [...selected].sort().join(",");
  const { data: selectedUsers = [] } = useQuery<StaffUser[]>({
    queryKey: ["/api/event-notifier/staff-users", { ids: selectedKey }],
    enabled: selected.length > 0,
  });
  const labelById = new Map(selectedUsers.map((u) => [u.id, u.displayName]));

  const toggle = (userId: string, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...selected, userId]))
      : selected.filter((id) => id !== userId);
    onChange(next, fieldPathId.path);
  };

  return (
    <div className="space-y-3" data-testid="staff-recipients">
      {selected.length > 0 && (
        <div className="space-y-2" data-testid="staff-recipients-selected">
          <div className="text-sm font-medium">Selected recipients</div>
          {selected.map((id) => (
            <div
              key={id}
              className="flex items-center justify-between gap-2 p-2 rounded-md border bg-background"
              data-testid={`staff-recipient-selected-${id}`}
            >
              <span className="truncate text-sm">
                {labelById.get(id) ?? id}
              </span>
              {!isDisabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => toggle(id, false)}
                  data-testid={`button-remove-staff-recipient-${id}`}
                >
                  <X size={14} />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Select
        value={roleId}
        onValueChange={setRoleId}
        disabled={isDisabled || rolesLoading}
      >
        <SelectTrigger data-testid="select-staff-recipient-role">
          <SelectValue placeholder="Select a role to list users" />
        </SelectTrigger>
        <SelectContent>
          {roles.map((r) => (
            <SelectItem
              key={r.id}
              value={r.id}
              data-testid={`option-staff-recipient-role-${r.id}`}
            >
              {r.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {!roleId ? (
        <div
          className="text-muted-foreground text-sm"
          data-testid="staff-recipients-pick-role"
        >
          Pick a role to see its active staff and admin users. The role only
          filters this list — recipients are saved as specific users.
        </div>
      ) : candidatesLoading ? (
        <div className="space-y-3" data-testid="staff-recipients-loading">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      ) : candidatesError ? (
        <div
          className="text-destructive text-sm"
          data-testid="staff-recipients-error"
        >
          Failed to load users for this role.
        </div>
      ) : candidates.length === 0 ? (
        <div
          className="text-muted-foreground text-sm"
          data-testid="staff-recipients-empty"
        >
          No active staff or admin users hold this role.
        </div>
      ) : (
        <div className="space-y-2" data-testid="staff-recipients-candidates">
          {candidates.map((user) => {
            const checked = selected.includes(user.id);
            return (
              <div
                key={user.id}
                className="flex items-center gap-3 p-2 rounded-md border bg-background"
                data-testid={`staff-recipient-${user.id}`}
              >
                <Checkbox
                  id={`staff-recipient-${user.id}`}
                  checked={checked}
                  onCheckedChange={(c) => toggle(user.id, !!c)}
                  disabled={isDisabled}
                  data-testid={`checkbox-staff-recipient-${user.id}`}
                />
                <Label
                  htmlFor={`staff-recipient-${user.id}`}
                  className="flex-1 cursor-pointer font-medium"
                >
                  {user.displayName}
                </Label>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
