import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, MessageSquare, Bell } from "lucide-react";
import type { StaffAlertConfig, StaffAlertRecipient, AlertMedium } from "@shared/staffAlerts";

interface StaffUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
}

interface StaffAlertConfigProps {
  value: StaffAlertConfig;
  onChange: (config: StaffAlertConfig) => void;
  disabled?: boolean;
}

const MEDIA_OPTIONS: { key: AlertMedium; label: string; icon: typeof Mail }[] = [
  { key: "email", label: "Email", icon: Mail },
  { key: "sms", label: "SMS", icon: MessageSquare },
  { key: "inapp", label: "In-App", icon: Bell },
];

export function StaffAlertConfigEditor({ value, onChange, disabled = false }: StaffAlertConfigProps) {
  const { data: staffUsers = [], isLoading } = useQuery<StaffUser[]>({
    queryKey: ["/api/staff-alerts/users"],
  });

  const getRecipient = (userId: string): StaffAlertRecipient | undefined => {
    return value.recipients.find(r => r.userId === userId);
  };

  const isUserSelected = (userId: string): boolean => {
    const recipient = getRecipient(userId);
    return recipient !== undefined && recipient.media.length > 0;
  };

  const getUserMedia = (userId: string): AlertMedium[] => {
    return getRecipient(userId)?.media || [];
  };

  const handleUserToggle = (userId: string, checked: boolean) => {
    if (checked) {
      const newRecipients = [
        ...value.recipients.filter(r => r.userId !== userId),
        { userId, media: ["inapp" as AlertMedium] },
      ];
      onChange({ recipients: newRecipients });
    } else {
      onChange({
        recipients: value.recipients.filter(r => r.userId !== userId),
      });
    }
  };

  const handleMediaToggle = (userId: string, medium: AlertMedium, checked: boolean) => {
    const currentRecipient = getRecipient(userId);
    const currentMedia = currentRecipient?.media || [];
    
    let newMedia: AlertMedium[];
    if (checked) {
      newMedia = Array.from(new Set([...currentMedia, medium]));
    } else {
      newMedia = currentMedia.filter(m => m !== medium);
    }
    
    if (newMedia.length === 0) {
      onChange({
        recipients: value.recipients.filter(r => r.userId !== userId),
      });
    } else {
      const newRecipients = value.recipients.filter(r => r.userId !== userId);
      newRecipients.push({ userId, media: newMedia });
      onChange({ recipients: newRecipients });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="staff-alert-config-loading">
        {[1, 2, 3].map(i => (
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
      <div className="text-muted-foreground text-sm" data-testid="staff-alert-config-empty">
        No staff or admin users found.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="staff-alert-config">
      {staffUsers.map(user => {
        const selected = isUserSelected(user.id);
        const media = getUserMedia(user.id);
        
        return (
          <div 
            key={user.id} 
            className="flex flex-col gap-2 p-3 rounded-md border bg-background"
            data-testid={`staff-alert-user-${user.id}`}
          >
            <div className="flex items-center gap-3">
              <Checkbox
                id={`user-${user.id}`}
                checked={selected}
                onCheckedChange={(checked) => handleUserToggle(user.id, !!checked)}
                disabled={disabled}
                data-testid={`checkbox-user-${user.id}`}
              />
              <Label 
                htmlFor={`user-${user.id}`} 
                className="flex-1 cursor-pointer font-medium"
              >
                {user.displayName}
              </Label>
              {selected && (
                <div className="flex gap-1">
                  {media.map(m => {
                    const option = MEDIA_OPTIONS.find(o => o.key === m);
                    if (!option) return null;
                    return (
                      <Badge key={m} variant="secondary" className="text-xs">
                        {option.label}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
            
            {selected && (
              <div className="flex items-center gap-4 ml-7">
                {MEDIA_OPTIONS.map(option => {
                  const Icon = option.icon;
                  const isChecked = media.includes(option.key);
                  
                  return (
                    <div key={option.key} className="flex items-center gap-1.5">
                      <Checkbox
                        id={`media-${user.id}-${option.key}`}
                        checked={isChecked}
                        onCheckedChange={(checked) => 
                          handleMediaToggle(user.id, option.key, !!checked)
                        }
                        disabled={disabled}
                        data-testid={`checkbox-media-${user.id}-${option.key}`}
                      />
                      <Label 
                        htmlFor={`media-${user.id}-${option.key}`}
                        className="flex items-center gap-1 text-sm cursor-pointer"
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {option.label}
                      </Label>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
