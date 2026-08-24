import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { PluginConfigField } from "@shared/plugin-config";
import { PluginConfigForm, validatePluginConfig } from "./PluginConfigForm";
import { useModalSeed } from "@/hooks/use-modal-seed";

export interface PluginConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: PluginConfigField[];
  currentConfig: Record<string, unknown>;
  onSave: (config: Record<string, unknown>) => void;
  isSaving?: boolean;
}

export function PluginConfigDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  currentConfig,
  onSave,
  isSaving = false,
}: PluginConfigDialogProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Seeded during the render that opens the dialog, so the field inputs are
  // controlled by the current config on their first render rather than
  // mounting empty and being corrected a render later.
  useModalSeed(open, JSON.stringify(currentConfig ?? null), () => {
    setFormData({ ...currentConfig });
    setValidationErrors({});
  });

  const handleSave = () => {
    const errors = validatePluginConfig(fields, formData);
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) return;
    onSave(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle data-testid="title-plugin-config">
            Configure {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="py-4">
          <PluginConfigForm
            fields={fields}
            value={formData}
            onChange={setFormData}
            errors={validationErrors}
            enabled={open}
          />
        </div>

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
