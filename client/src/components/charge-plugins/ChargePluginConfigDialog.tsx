import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { JsonSchema } from "@shared/json-schema-form";
import type { IChangeEvent } from "@rjsf/core";
import {
  SchemaForm,
  sortArrayTableSettings,
} from "@/components/json-schema-form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ChargePluginConfigRow } from "@/plugins/charge-plugins/registry";

interface AccountOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface EmployerOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface ChargePluginManifestEntry {
  id: string;
  name: string;
  description: string;
  defaultScope: "global" | "employer";
  supportedScopes?: ("global" | "employer")[];
  configSchema?: JsonSchema;
}

export interface ChargePluginConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plugin: ChargePluginManifestEntry;
  /** Existing config row when editing; null/undefined when creating. */
  config?: ChargePluginConfigRow | null;
  accounts: AccountOption[];
  employers: EmployerOption[];
}

const NONE_VALUE = "_none_";

/**
 * Generic add/edit dialog for any charge plugin configuration. The fixed
 * "envelope" fields (scope / employer / account / name / enabled) are
 * rendered with plain inputs; the plugin-specific `settings` are rendered
 * by the server-provided JSON Schema via `SchemaForm`. New plugins need
 * zero client changes — they just ship a `configSchema`.
 */
export function ChargePluginConfigDialog({
  open,
  onOpenChange,
  plugin,
  config,
  accounts,
  employers,
}: ChargePluginConfigDialogProps) {
  const { toast } = useToast();
  const isEditMode = !!config;
  const submitBtnRef = useRef<HTMLButtonElement>(null);

  const supportedScopes = plugin.supportedScopes ?? ["global"];
  const canChooseEmployer = supportedScopes.includes("employer");
  // Only offer a scope picker when the plugin genuinely supports more
  // than one scope. Single-scope plugins are pinned to their one value.
  const showScopeSelect = supportedScopes.length > 1;
  const scopeLabel = (s: "global" | "employer") =>
    s === "employer" ? "Employer-Specific" : "Global";

  const settingsSchema = plugin.configSchema ?? { type: "object", properties: {} };

  const [scope, setScope] = useState<"global" | "employer">("global");
  const [employerId, setEmployerId] = useState<string>("");
  const [account, setAccount] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [enabled, setEnabled] = useState<boolean>(false);
  const [settings, setSettings] = useState<Record<string, unknown>>({});

  // Reset envelope + settings whenever the dialog opens or the target
  // config changes. New configs start from schema defaults (settings={},
  // RJSF fills them); edits load the stored values, with array-table
  // arrays sorted once for display.
  useEffect(() => {
    if (!open) return;
    if (config) {
      setScope((config.scope as "global" | "employer") ?? "global");
      setEmployerId(config.employerId ?? "");
      setAccount(config.account ?? "");
      setName(config.name ?? "");
      setEnabled(config.enabled);
      setSettings(
        sortArrayTableSettings(
          settingsSchema,
          (config.settings as Record<string, unknown>) ?? {},
        ),
      );
    } else {
      const initialScope = supportedScopes.includes(plugin.defaultScope)
        ? plugin.defaultScope
        : supportedScopes[0];
      setScope(initialScope);
      setEmployerId("");
      setAccount("");
      setName("");
      setEnabled(false);
      setSettings({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config]);

  const saveMutation = useMutation({
    mutationFn: async (validSettings: Record<string, unknown>) => {
      if (isEditMode && config) {
        return apiRequest("PUT", `/api/plugins/charge/configs/${config.id}`, {
          enabled,
          name: name.trim() || null,
          account,
          settings: validSettings,
        });
      }
      return apiRequest("POST", "/api/plugins/charge/configs", {
        pluginId: plugin.id,
        scope,
        employerId: scope === "employer" ? employerId : undefined,
        enabled,
        name: name.trim() || null,
        account,
        settings: validSettings,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/plugins/charge/configs"],
      });
      toast({
        title: "Success",
        description: `Configuration ${isEditMode ? "updated" : "created"}.`,
      });
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : `Failed to ${isEditMode ? "update" : "create"} configuration.`;
      toast({ title: "Error", description: message, variant: "destructive" });
    },
  });

  // Validate envelope, then trigger RJSF's submit (which validates the
  // settings via AJV) by clicking the hidden submit button.
  const handleSaveClick = () => {
    if (!account) {
      toast({
        title: "Account required",
        description: "Select an account for this configuration.",
        variant: "destructive",
      });
      return;
    }
    if (!isEditMode && !supportedScopes.includes(scope)) {
      toast({
        title: "Unsupported scope",
        description: "This plugin does not support the selected scope.",
        variant: "destructive",
      });
      return;
    }
    if (!isEditMode && scope === "employer" && !employerId) {
      toast({
        title: "Employer required",
        description: "Select an employer for employer-scoped configurations.",
        variant: "destructive",
      });
      return;
    }
    submitBtnRef.current?.click();
  };

  const tid = useMemo(
    () => (suffix: string) => `charge-config-${suffix}`,
    [],
  );

  const activeAccounts = accounts.filter((a) => a.isActive || a.id === account);
  const activeEmployers = employers.filter(
    (e) => e.isActive || e.id === employerId,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col max-h-[85vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle data-testid={tid("title")}>
            {isEditMode ? "Edit Configuration" : "New Configuration"}
          </DialogTitle>
          <DialogDescription>{plugin.name}</DialogDescription>
        </DialogHeader>

        <div className="py-2 flex-1 min-h-0 overflow-y-auto pr-1 space-y-5">
          {/* Envelope fields (rendered outside RJSF). */}
          <div className="space-y-4">
            {!isEditMode && (showScopeSelect || canChooseEmployer) ? (
              <div className="grid grid-cols-2 gap-4">
                {showScopeSelect ? (
                  <div className="space-y-1">
                    <Label>Scope</Label>
                    <Select
                      value={scope}
                      onValueChange={(v) => setScope(v as "global" | "employer")}
                    >
                      <SelectTrigger data-testid="select-scope">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {supportedScopes.map((s) => (
                          <SelectItem key={s} value={s}>
                            {scopeLabel(s)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {canChooseEmployer && scope === "employer" ? (
                  <div className="space-y-1">
                    <Label>Employer</Label>
                    <Select value={employerId} onValueChange={setEmployerId}>
                      <SelectTrigger data-testid="select-employer">
                        <SelectValue placeholder="Select employer..." />
                      </SelectTrigger>
                      <SelectContent>
                        {activeEmployers.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center justify-between p-3 border rounded-md">
              <div>
                <Label>Enabled</Label>
                <p className="text-sm text-muted-foreground">
                  When enabled, charges are created automatically.
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                data-testid="switch-enabled"
              />
            </div>

            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                placeholder="Optional label for this configuration"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="input-name"
              />
            </div>

            <div className="space-y-1">
              <Label>Account</Label>
              <Select
                value={account || NONE_VALUE}
                onValueChange={(v) => setAccount(v === NONE_VALUE ? "" : v)}
              >
                <SelectTrigger data-testid="select-account">
                  <SelectValue placeholder="Select account..." />
                </SelectTrigger>
                <SelectContent>
                  {activeAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Plugin-specific settings (rendered by JSON Schema). */}
          <div className="border-t pt-4">
            <SchemaForm
              schema={settingsSchema}
              formData={settings}
              showErrorList="top"
              onChange={(e: IChangeEvent) =>
                setSettings(e.formData as Record<string, unknown>)
              }
              onSubmit={(e: IChangeEvent) =>
                saveMutation.mutate(e.formData as Record<string, unknown>)
              }
            >
              <button
                ref={submitBtnRef}
                type="submit"
                hidden
                aria-hidden="true"
                tabIndex={-1}
              />
            </SchemaForm>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saveMutation.isPending}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveClick}
            disabled={saveMutation.isPending}
            data-testid="button-save-config"
          >
            {saveMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {isEditMode ? "Update" : "Create"} Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
