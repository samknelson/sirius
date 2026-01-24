import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import type { EligibilityPluginMetadata, EligibilityPluginConfig, PluginConfigField } from "@shared/schema";

interface PluginConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plugin: EligibilityPluginMetadata;
  currentConfig: EligibilityPluginConfig["config"];
  onSave: (config: EligibilityPluginConfig["config"]) => void;
}

interface OptionItem {
  id: string;
  name: string;
}

export function PluginConfigModal({ open, onOpenChange, plugin, currentConfig, onSave }: PluginConfigModalProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  const selectOptionsTypes = (plugin.configFields || [])
    .filter(f => f.inputType === "select-options" && f.selectOptionsType)
    .map(f => f.selectOptionsType as string);

  const { data: optionsData, isLoading: optionsLoading } = useQuery<Record<string, OptionItem[]>>({
    queryKey: ["/api/options/bulk", ...selectOptionsTypes],
    queryFn: async () => {
      if (selectOptionsTypes.length === 0) return {};
      const results: Record<string, OptionItem[]> = {};
      await Promise.all(
        selectOptionsTypes.map(async (type) => {
          const response = await fetch(`/api/options/${type}`);
          if (response.ok) {
            results[type] = await response.json();
          }
        })
      );
      return results;
    },
    enabled: open && selectOptionsTypes.length > 0,
  });

  useEffect(() => {
    if (open) {
      setFormData({ ...currentConfig });
    }
  }, [open, currentConfig]);

  const handleSave = () => {
    onSave(formData);
    onOpenChange(false);
  };

  const renderField = (field: PluginConfigField) => {
    const value = formData[field.name];

    switch (field.inputType) {
      case "select-options": {
        if (!field.selectOptionsType) return null;
        const options = optionsData?.[field.selectOptionsType] || [];
        const selectedValues = Array.isArray(value) ? value : [];

        const toggleOption = (optionId: string, checked: boolean) => {
          const current = Array.isArray(formData[field.name]) ? formData[field.name] as string[] : [];
          const updated = checked
            ? [...current, optionId]
            : current.filter(id => id !== optionId);
          setFormData({ ...formData, [field.name]: updated });
        };

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
                {field.helperText && (
                  <p className="text-sm text-muted-foreground">{field.helperText}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel">
            Cancel
          </Button>
          <Button onClick={handleSave} data-testid="button-save-config">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
