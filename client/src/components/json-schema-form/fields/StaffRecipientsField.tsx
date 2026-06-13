import { useQuery } from "@tanstack/react-query";
import type { FieldProps } from "@rjsf/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface StaffUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
}

/**
 * RJSF field for picking a fixed set of staff/admin users as notification
 * recipients. Triggered by the vendor key `x-widget: "staff-recipients"` on an
 * array-of-string property (see SchemaForm's uiSchema mapping). The field value
 * is the list of selected user ids; the staff/admin user list is fetched from
 * the event-notifier admin metadata endpoint.
 */
export function StaffRecipientsField(props: FieldProps) {
  const { formData, onChange, disabled, readonly, fieldPathId } = props;
  const selected: string[] = Array.isArray(formData)
    ? (formData as string[])
    : [];
  const isDisabled = Boolean(disabled || readonly);

  const { data: staffUsers = [], isLoading } = useQuery<StaffUser[]>({
    queryKey: ["/api/event-notifier/staff-users"],
  });

  const toggle = (userId: string, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...selected, userId]))
      : selected.filter((id) => id !== userId);
    onChange(next, fieldPathId.path);
  };

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="staff-recipients-loading">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
    );
  }

  if (staffUsers.length === 0) {
    return (
      <div
        className="text-muted-foreground text-sm"
        data-testid="staff-recipients-empty"
      >
        No staff or admin users found.
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="staff-recipients">
      {staffUsers.map((user) => {
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
  );
}
