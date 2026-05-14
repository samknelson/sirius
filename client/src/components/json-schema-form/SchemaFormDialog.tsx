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
import type { RJSFSchema, RJSFValidationError, UiSchema } from "@rjsf/utils";
import type { JsonSchema } from "@shared/json-schema-form";
import type { IChangeEvent } from "@rjsf/core";
import { SchemaForm, type SchemaFormContext } from "./SchemaForm";
import { useToast } from "@/hooks/use-toast";

/**
 * The dialog's footer Save button is OUTSIDE the rjsf form, so it
 * cannot be `type="submit"`. Instead we render a hidden submit button
 * INSIDE the form (rjsf renders form children below the fields) and
 * `.click()` it from the footer button. This is the standard
 * RJSF-with-external-trigger pattern and avoids any imperative ref
 * dance against the rjsf Form component.
 */

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
  const submitBtnRef = useRef<HTMLButtonElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) setFormData(initialData);
  }, [open, initialData]);

  /**
   * RJSF silently swallows submits when AJV validation fails. Without
   * this hook the user clicks Save and nothing happens. Surface the
   * first few errors as a destructive toast; the inline error list
   * (showErrorList="top") covers the rest visually inside the form.
   */
  /**
   * Turn an rjsf property path like "/foo/bar" into a friendlier
   * "foo → bar" label for the toast. Empty/root paths fall back to
   * "This form" so the message still reads naturally.
   */
  const formatPath = (raw: string | undefined): string => {
    if (!raw) return "This form";
    const trimmed = raw.replace(/^\.?\/?/, "").replace(/^\./, "");
    if (!trimmed) return "This form";
    return trimmed.split(/[./]/).filter(Boolean).join(" → ");
  };

  const handleError = (errors: RJSFValidationError[]) => {
    if (!errors || errors.length === 0) return;
    const summary = errors
      .slice(0, 3)
      .map((e) => `${formatPath(e.property)}: ${e.message ?? "is invalid"}`)
      .join("\n");
    toast({
      title: "Please fix the highlighted fields",
      description: summary,
      variant: "destructive",
    });
  };

  const tid = useMemo(
    () => (suffix: string) => (testId ? `${testId}-${suffix}` : suffix),
    [testId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`flex flex-col max-h-[85vh] ${contentClassName ?? "sm:max-w-2xl"}`}
      >
        <DialogHeader>
          <DialogTitle data-testid={tid("title")}>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {/*
          Scroll lives on the body (flex-1 + min-h-0) so long forms
          scroll inside the dialog while the header/footer stay
          pinned. Short forms don't show a scrollbar.
        */}
        <div className="py-2 flex-1 min-h-0 overflow-y-auto pr-1">
          <SchemaForm
            schema={schema}
            uiSchema={uiSchema}
            formData={formData}
            formContext={formContext}
            showErrorList="top"
            onChange={(e: IChangeEvent) => setFormData(e.formData as T)}
            onSubmit={(e: IChangeEvent) => onSave(e.formData as T)}
            onError={handleError}
          >
            {/*
              Hidden submit-trigger; the visible Save button in the
              dialog footer clicks this via ref to fire rjsf's
              onSubmit (which runs AJV validation first).
            */}
            <button
              ref={submitBtnRef}
              type="submit"
              hidden
              aria-hidden="true"
              tabIndex={-1}
            />
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
            onClick={() => submitBtnRef.current?.click()}
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
