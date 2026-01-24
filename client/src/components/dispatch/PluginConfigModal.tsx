import { useState, useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { EligibilityPluginMetadata, EligibilityPluginConfig, PluginConfigField } from "@shared/schema";

interface PluginConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plugin: EligibilityPluginMetadata;
  currentConfig: EligibilityPluginConfig["config"];
  onSave: (config: EligibilityPluginConfig["config"]) => void;
  isSaving?: boolean;
}

interface OptionItem {
  id: string;
  name: string;
}

export function PluginConfigModal({ open, onOpenChange, plugin, currentConfig, onSave, isSaving = false }: PluginConfigModalProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const selectOptionsTypes = useMemo(() => 
    (plugin.configFields || [])
      .filter(f => f.inputType === "select-options" && f.selectOptionsType)
      .map(f => f.selectOptionsType as string)
      .filter((v, i, arr) => arr.indexOf(v) === i),
    [plugin.configFields]
  );

  const optionsQueries = useQueries({
    queries: selectOptionsTypes.map(type => ({
      queryKey: ["/api/options", type],
      enabled: open,
    })),
  });

  const optionsData = useMemo(() => {
    const data: Record<string, OptionItem[]> = {};
    selectOptionsTypes.forEach((type, index) => {
      if (optionsQueries[index]?.data) {
        data[type] = optionsQueries[index].data as OptionItem[];
      }
    });
    return data;
  }, [selectOptionsTypes, optionsQueries]);

  const optionsLoading = optionsQueries.some(q => q.isLoading);

  useEffect(() => {
    if (open) {
      setFormData({ ...currentConfig });
      setValidationErrors({});
    }
  }, [open, currentConfig]);

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    const configFields = plugin.configFields || [];
    
    for (const field of configFields) {
      if (field.required) {
        const value = formData[field.name];
        if (field.inputType === "select-options" && field.multiSelect) {
          if (!Array.isArray(value) || value.length === 0) {
            errors[field.name] = `${field.label} is required`;
          }
        } else if (value === undefined || value === null || value === "") {
          errors[field.name] = `${field.label} is required`;
        }
      }
    }
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = () => {
    if (!validateForm()) return;
    onSave(formData);
    // Modal will be closed by parent after successful save
  };

  const renderField = (field: PluginConfigField) => {
    const value = formData[field.name];

    switch (field.inputType) {
      case "select-options": {
        if (!field.selectOptionsType) return null;
        const options = optionsData?.[field.selectOptionsType] || [];

        if (optionsLoading) {
          return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading options...
            </div>
          );
        }

        if (options.length === 0) {
          return (
            <p className="text-sm text-muted-foreground">
              No options available for this field.
            </p>
          );
        }

        if (field.multiSelect) {
          const selectedValues = Array.isArray(value) ? value : [];
          const toggleOption = (optionId: string, checked: boolean) => {
            const current = Array.isArray(formData[field.name]) ? formData[field.name] as string[] : [];
            const updated = checked
              ? [...current, optionId]
              : current.filter(id => id !== optionId);
            setFormData({ ...formData, [field.name]: updated });
          };

          return (
            <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-2">
              {options.map((option) => (
                <div key={option.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`${field.name}-${option.id}`}
                    checked={selectedValues.includes(option.id)}
                    onCheckedChange={(checked) => toggleOption(option.id, checked === true)}
                    data-testid={`checkbox-${field.name}-${option.id}`}
                  />
                  <Label 
                    htmlFor={`${field.name}-${option.id}`} 
                    className="text-sm font-normal cursor-pointer"
                  >
                    {option.name}
                  </Label>
                </div>
              ))}
            </div>
          );
        }

        const selectedValue = typeof value === "string" ? value : "";
        return (
          <Select
            value={selectedValue || "_none_"}
            onValueChange={(v) => setFormData({ ...formData, [field.name]: v === "_none_" ? null : v })}
          >
            <SelectTrigger data-testid={`select-${field.name}`}>
              <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {!field.required && <SelectItem value="_none_">None</SelectItem>}
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      case "text":
        return (
          <Input
            value={typeof value === "string" ? value : ""}
            onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
            data-testid={`input-${field.name}`}
          />
        );

      case "number":
        return (
          <Input
            type="number"
            value={typeof value === "number" ? value : ""}
            onChange={(e) => {
              const val = e.target.value.trim();
              setFormData({ ...formData, [field.name]: val === "" ? null : parseInt(val) });
            }}
            data-testid={`input-${field.name}`}
          />
        );

      case "checkbox":
        return (
          <Checkbox
            checked={!!value}
            onCheckedChange={(checked) => setFormData({ ...formData, [field.name]: checked === true })}
            data-testid={`checkbox-${field.name}`}
          />
        );

      default:
        return null;
    }
  };

  const configFields = plugin.configFields || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle data-testid="title-plugin-config">
            Configure {plugin.name}
          </DialogTitle>
          <DialogDescription>
            {plugin.description}
          </DialogDescription>
        </DialogHeader>

        {configFields.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            This plugin has no configurable options.
          </p>
        ) : (
          <div className="space-y-4 py-4">
            {configFields.map((field) => (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={field.name}>
                  {field.label}
                  {field.required && <span className="text-destructive ml-1">*</span>}
                </Label>
                {renderField(field)}
                {validationErrors[field.name] && (
                  <p className="text-sm text-destructive">{validationErrors[field.name]}</p>
                )}
                {field.helperText && !validationErrors[field.name] && (
                  <p className="text-sm text-muted-foreground">{field.helperText}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving} data-testid="button-cancel">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving} data-testid="button-save-config">
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
