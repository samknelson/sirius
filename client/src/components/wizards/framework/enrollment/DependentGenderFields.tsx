import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface GenderOption {
  id: string;
  name: string;
  nota: boolean;
  sequence: number;
}

interface DependentGenderFieldsProps {
  idPrefix: string;
  gender: string;
  genderNota: string;
  currentDesignation?: string | null;
  showUnspecifiedCurrent?: boolean;
  disabled?: boolean;
  onGenderChange: (gender: string) => void;
  onGenderNotaChange: (genderNota: string) => void;
}

const UNSPECIFIED_VALUE = "__leave_unspecified__";

/**
 * Gender is optional. Existing designations are shown for context but are
 * only changed when the operator explicitly chooses an option.
 */
export function DependentGenderFields({
  idPrefix,
  gender,
  genderNota,
  currentDesignation,
  showUnspecifiedCurrent = false,
  disabled = false,
  onGenderChange,
  onGenderNotaChange,
}: DependentGenderFieldsProps) {
  const { data: genderOptions = [] } = useQuery<GenderOption[]>({
    queryKey: ["/api/options/gender"],
  });
  const orderedOptions = [...genderOptions].sort(
    (a, b) => a.sequence - b.sequence,
  );
  const selectedOption = orderedOptions.find((option) => option.id === gender);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-gender`}>Gender</Label>
        <Select
          value={gender}
          disabled={disabled}
          onValueChange={(value) => {
            const nextGender =
              value === UNSPECIFIED_VALUE ? "" : value;
            onGenderChange(nextGender);
            if (
              value === UNSPECIFIED_VALUE ||
              !orderedOptions.find((option) => option.id === value)?.nota
            ) {
              onGenderNotaChange("");
            }
          }}
        >
          <SelectTrigger
            id={`${idPrefix}-gender`}
            data-testid="select-dependent-gender"
          >
            <SelectValue placeholder="Select gender…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSPECIFIED_VALUE}>Leave unspecified</SelectItem>
            {orderedOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(currentDesignation || showUnspecifiedCurrent) && (
          <p className="text-xs text-muted-foreground">
            Current designation: {currentDesignation || "Not specified"}
          </p>
        )}
      </div>
      {selectedOption?.nota && (
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-gender-nota`}>Specify Gender</Label>
          <Input
            id={`${idPrefix}-gender-nota`}
            value={genderNota}
            disabled={disabled}
            onChange={(event) => onGenderNotaChange(event.target.value)}
            placeholder="Enter gender…"
            required
            data-testid="input-dependent-gender-nota"
          />
        </div>
      )}
    </div>
  );
}
