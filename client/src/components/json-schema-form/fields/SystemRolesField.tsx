import { useQuery } from "@tanstack/react-query";
import type { FieldProps } from "@rjsf/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface SystemRole {
  id: string;
  name: string;
  description: string | null;
}

/**
 * RJSF field for selecting one or more system (access-control) roles.
 * Triggered by the vendor key `x-widget: "system-roles"` on an
 * array-of-string property (see SchemaForm's uiSchema mapping). The field
 * value is the list of selected role ids; the role list is fetched from the
 * admin roles endpoint.
 */
export function SystemRolesField(props: FieldProps) {
  const { formData, onChange, disabled, readonly, fieldPathId } = props;
  const selected: string[] = Array.isArray(formData)
    ? (formData as string[])
    : [];
  const isDisabled = Boolean(disabled || readonly);

  const { data: roles = [], isLoading } = useQuery<SystemRole[]>({
    queryKey: ["/api/admin/roles"],
  });

  const toggle = (roleId: string, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...selected, roleId]))
      : selected.filter((id) => id !== roleId);
    onChange(next, fieldPathId.path);
  };

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="system-roles-loading">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
    );
  }

  if (roles.length === 0) {
    return (
      <div
        className="text-muted-foreground text-sm"
        data-testid="system-roles-empty"
      >
        No system roles found.
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="system-roles">
      {roles.map((role) => {
        const checked = selected.includes(role.id);
        return (
          <div
            key={role.id}
            className="flex items-start gap-3 p-2 rounded-md border bg-background"
            data-testid={`system-role-${role.id}`}
          >
            <Checkbox
              id={`system-role-${role.id}`}
              checked={checked}
              onCheckedChange={(c) => toggle(role.id, !!c)}
              disabled={isDisabled}
              className="mt-0.5"
              data-testid={`checkbox-system-role-${role.id}`}
            />
            <Label
              htmlFor={`system-role-${role.id}`}
              className="flex-1 cursor-pointer"
            >
              <span className="font-medium">{role.name}</span>
              {role.description && (
                <span className="block text-xs text-muted-foreground font-normal">
                  {role.description}
                </span>
              )}
            </Label>
          </div>
        );
      })}
    </div>
  );
}
