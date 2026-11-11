import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";

interface BenefitColorOption {
  id: string;
  name: string;
  color: string;
}

interface BenefitColorSelectProps {
  id: string;
  value: string | null;
  onChange: (colorOptionId: string | null) => void;
  testId: string;
}

export function BenefitColorSelect({ id, value, onChange, testId }: BenefitColorSelectProps) {
  const { data: colors = [], isLoading, isError } = useQuery<BenefitColorOption[]>({
    queryKey: ["/api/options/color"],
  });

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium text-foreground">
        Color
      </Label>
      <Select
        value={value || "__none__"}
        disabled={isLoading || isError}
        onValueChange={(selected) => onChange(selected === "__none__" ? null : selected)}
      >
        <SelectTrigger id={id} data-testid={testId}>
          <SelectValue placeholder={isLoading ? "Loading colors..." : "Select a color..."} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__" data-testid={`${testId}-none`}>
            No color
          </SelectItem>
          {colors.map((option) => (
            <SelectItem key={option.id} value={option.id} data-testid={`${testId}-${option.id}`}>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-4 w-4 rounded-full border border-border"
                  style={{ backgroundColor: option.color }}
                />
                <span>{option.name}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Tints this benefit&apos;s icon. Manage named colors in the Benefit Colors options list.
      </p>
      {isError && (
        <p className="text-sm text-destructive" role="alert">
          Configured colors could not be loaded. Reload the page before saving a color selection.
        </p>
      )}
    </div>
  );
}
