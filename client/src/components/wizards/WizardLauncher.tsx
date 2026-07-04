import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SchemaForm,
  SchemaFormDialog,
  type IChangeEvent,
} from "@/components/json-schema-form";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { JsonSchema } from "@shared/json-schema-form";
import type { Wizard } from "@/lib/wizard-types";

interface LaunchSchemaResponse {
  schema: JsonSchema | null;
  uiSchema?: Record<string, unknown>;
}

interface TriggerRenderProps {
  onClick: () => void;
  disabled: boolean;
  isPending: boolean;
}

export interface WizardLauncherProps {
  /** Wizard plugin id to create. */
  type: string;
  /** Owning entity id for entity-scoped wizards (e.g. employer feeds). */
  entityId?: string | null;
  /** Pre-filled launch-input values (RJSF form data). */
  defaults?: Record<string, unknown>;
  /** Dialog copy shown when the wizard collects launch inputs. */
  dialogTitle?: string;
  dialogDescription?: string;
  /** Success toast copy. */
  successTitle?: string;
  successDescription?: string;
  /**
   * Called with the created wizard instead of the default
   * navigate-to-`/wizards/:id` behavior.
   */
  onCreated?: (wizard: Wizard) => void;
  /** Extra disable condition layered on top of loading/pending. */
  disabled?: boolean;
  /** Default trigger button label (button mode). */
  label?: string;
  /**
   * Render a bespoke trigger button (button mode). Receives the click
   * handler plus the disabled/pending state so each page owns its styling.
   */
  renderTrigger?: (props: TriggerRenderProps) => ReactNode;
  /**
   * Inline mode: render the launch form + confirm button directly,
   * without a trigger button. The parent owns the surrounding container
   * (e.g. its own dialog). Used when the wizard type is chosen elsewhere.
   */
  inline?: boolean;
  /** Confirm button label in inline mode. */
  submitLabel?: string;
  /** Optional cancel action in inline mode. */
  onCancel?: () => void;
}

/**
 * Single, schema-driven launcher for framework wizards. It fetches the
 * plugin's launch schema and either:
 *
 *  - renders a plain trigger button that creates the wizard immediately
 *    (no launch inputs), or
 *  - opens a SchemaForm dialog to collect launch inputs, validates them,
 *    then creates the wizard.
 *
 * On success it invalidates the wizard list and navigates to the new
 * wizard (or calls `onCreated`). This replaces every bespoke create
 * button + launch-argument form across the app.
 */
export function WizardLauncher({
  type,
  entityId,
  defaults,
  dialogTitle,
  dialogDescription,
  successTitle,
  successDescription,
  onCreated,
  disabled,
  label,
  renderTrigger,
  inline,
  submitLabel,
  onCancel,
}: WizardLauncherProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [inlineData, setInlineData] = useState<Record<string, unknown>>(
    defaults ?? {},
  );

  const { data: launch, isLoading: schemaLoading } =
    useQuery<LaunchSchemaResponse>({
      queryKey: ["/api/wizard-types", type, "launch-schema", entityId ?? null],
      queryFn: async () => {
        const qs = entityId ? `?entityId=${encodeURIComponent(entityId)}` : "";
        const res = await fetch(
          `/api/wizard-types/${encodeURIComponent(type)}/launch-schema${qs}`,
          { credentials: "include" },
        );
        if (!res.ok) throw new Error("Failed to load launch inputs");
        return res.json();
      },
      enabled: !!type,
    });

  const schema = launch?.schema ?? null;
  const hasInputs =
    !!schema &&
    !!schema.properties &&
    Object.keys(schema.properties).length > 0;

  // Stable initialData reference so SchemaFormDialog doesn't reset the
  // working copy on every render while it's open.
  const initialData = useMemo(() => defaults ?? {}, [defaults]);

  const createMutation = useMutation<Wizard, Error, Record<string, unknown>>({
    mutationFn: async (values) => {
      const data: Record<string, unknown> = hasInputs
        ? { launchArguments: values }
        : {};
      return (await apiRequest("POST", "/api/wizards", {
        type,
        status: "draft",
        entityId: entityId ?? null,
        data,
      })) as Wizard;
    },
    onSuccess: (wizard) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wizards"] });
      setOpen(false);
      toast({
        title: successTitle ?? "Wizard created",
        description:
          successDescription ?? "The wizard has been created successfully.",
      });
      if (onCreated) onCreated(wizard);
      else setLocation(`/wizards/${wizard.id}`);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create wizard",
        variant: "destructive",
      });
    },
  });

  const busy = schemaLoading || createMutation.isPending || !!disabled;

  // Inline mode: form (if any) + confirm button, no trigger.
  if (inline) {
    if (schemaLoading) {
      return <Skeleton className="h-10 w-full" data-testid="wizard-launcher-loading" />;
    }
    const footer = (
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={createMutation.isPending}
            data-testid="button-cancel-create"
          >
            Cancel
          </Button>
        )}
        <Button
          type={hasInputs ? "submit" : "button"}
          onClick={
            hasInputs ? undefined : () => createMutation.mutate({})
          }
          disabled={createMutation.isPending || !!disabled}
          data-testid="button-confirm-create"
        >
          {createMutation.isPending ? "Creating..." : submitLabel ?? "Create"}
        </Button>
      </div>
    );

    if (!hasInputs || !schema) {
      return footer;
    }
    return (
      <SchemaForm
        schema={schema}
        uiSchema={launch?.uiSchema}
        formData={inlineData}
        showErrorList="top"
        onChange={(e: IChangeEvent) =>
          setInlineData(e.formData as Record<string, unknown>)
        }
        onSubmit={(e: IChangeEvent) =>
          createMutation.mutate(e.formData as Record<string, unknown>)
        }
      >
        <div className="pt-4">{footer}</div>
      </SchemaForm>
    );
  }

  // Button mode.
  const handleTriggerClick = () => {
    if (hasInputs) setOpen(true);
    else createMutation.mutate({});
  };

  return (
    <>
      {renderTrigger ? (
        renderTrigger({
          onClick: handleTriggerClick,
          disabled: busy,
          isPending: createMutation.isPending,
        })
      ) : (
        <Button
          onClick={handleTriggerClick}
          disabled={busy}
          data-testid="button-create-wizard"
        >
          {createMutation.isPending ? "Creating..." : label ?? "Create"}
        </Button>
      )}
      {hasInputs && schema && (
        <SchemaFormDialog
          open={open}
          onOpenChange={setOpen}
          title={dialogTitle ?? "Create Wizard"}
          description={dialogDescription}
          schema={schema}
          uiSchema={launch?.uiSchema}
          initialData={initialData}
          onSave={(values) =>
            createMutation.mutate(values as Record<string, unknown>)
          }
          isSaving={createMutation.isPending}
        />
      )}
    </>
  );
}
