import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import type { JsonSchema } from "@shared/json-schema-form";
import type { IChangeEvent } from "@rjsf/core";
import { SchemaForm, type SchemaFormContext } from "./SchemaForm";

export interface SchemaFormDialogProps<T extends Record<string, unknown> = Record<string, unknown>> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  schema: JsonSchema | RJSFSchema;
  uiSchema?: UiSchema;
  initialData: T;
  formContext?: SchemaFormContext;
  onSave: (data: T) => void;
  isSaving?: boolean;
  testId?: string;
  contentClassName?: string;
}

/**
 * Modal-per-record editor: a Dialog containing a SchemaForm with
 * standard Save/Cancel buttons. The dialog owns its own working copy of
 * the form data so cancelling discards in-flight edits.
 */
export function SchemaFormDialog<T extends Record<string, unknown> = Record<string, unknown>>({
  open,
  onOpenChange,
  title,
  description,
  schema,
  uiSchema,
  initialData,
  formContext,
  onSave,
  isSaving = false,
  testId,
  contentClassName,
}: SchemaFormDialogProps<T>) {
  const [formData, setFormData] = useState<T>(initialData);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (open) setFormData(initialData);
  }, [open, initialData]);

  const tid = useMemo(
    () => (suffix: string) => (testId ? `${testId}-${suffix}` : suffix),
    [testId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={contentClassName ?? "sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle data-testid={tid("title")}>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="py-2 max-h-[60vh] overflow-y-auto pr-1">
          <SchemaForm
            ref={formRef}
            schema={schema as RJSFSchema}
            uiSchema={uiSchema}
            formData={formData}
            formContext={formContext}
            onChange={(e: IChangeEvent) => setFormData(e.formData as T)}
            onSubmit={(e: IChangeEvent) => onSave(e.formData as T)}
          >
            {/* Hide the default submit button — we drive it from the dialog footer. */}
            <button type="submit" hidden aria-hidden="true" />
          </SchemaForm>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            data-testid={tid("button-cancel")}
          >
            Cancel
          </Button>
          <Button
            onClick={() => formRef.current?.requestSubmit()}
            disabled={isSaving}
            data-testid={tid("button-save")}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
