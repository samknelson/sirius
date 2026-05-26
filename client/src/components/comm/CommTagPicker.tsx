import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tag, X } from "lucide-react";

export interface CommTagOption {
  id: string;
  name: string;
  description?: string | null;
  data?: { icon?: string; applicableCommTypes?: string[] } | null;
}

interface CommTagPickerProps {
  medium: "sms" | "email" | "postal" | "inapp";
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

export function CommTagPicker({ medium, value, onChange, disabled }: CommTagPickerProps) {
  const { data: allTags = [], isLoading } = useQuery<CommTagOption[]>({
    queryKey: ["/api/options/comm-tag"],
  });

  const applicable = useMemo(() => {
    return allTags.filter((t) => {
      const applies = t.data?.applicableCommTypes;
      if (!applies || applies.length === 0) return true;
      return applies.includes(medium);
    });
  }, [allTags, medium]);

  const selected = useMemo(
    () => applicable.filter((t) => value.includes(t.id)),
    [applicable, value],
  );

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const remove = (id: string) => onChange(value.filter((v) => v !== id));

  return (
    <div className="space-y-2">
      <Label>Tags</Label>
      <div className="flex flex-wrap items-center gap-2">
        {selected.map((t) => (
          <Badge
            key={t.id}
            variant="secondary"
            className="gap-1 pr-1"
            data-testid={`badge-selected-tag-${t.id}`}
          >
            <Tag className="h-3 w-3" />
            {t.name}
            <button
              type="button"
              onClick={() => remove(t.id)}
              className="ml-1 rounded-sm hover-elevate active-elevate-2 p-0.5"
              data-testid={`button-remove-tag-${t.id}`}
              aria-label={`Remove ${t.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || isLoading}
              data-testid="button-open-tag-picker"
            >
              <Tag className="h-3.5 w-3.5 mr-1" />
              {selected.length > 0 ? "Edit tags" : "Add tags"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            {applicable.length === 0 ? (
              <p className="text-sm text-muted-foreground p-2" data-testid="text-no-tags">
                No tags available for {medium}.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1">
                {applicable.map((t) => {
                  const checked = value.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      className="flex items-start gap-2 p-2 rounded-md hover-elevate cursor-pointer"
                      data-testid={`row-tag-option-${t.id}`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(t.id)}
                        data-testid={`checkbox-tag-${t.id}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium leading-tight">{t.name}</div>
                        {t.description && (
                          <div className="text-xs text-muted-foreground line-clamp-2">
                            {t.description}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
