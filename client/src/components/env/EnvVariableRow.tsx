import { useState, type ReactNode } from "react";
import {
  Check,
  Copy,
  EyeOff,
  Lock,
  Pencil,
  RefreshCw,
  RotateCw,
  Trash2,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { EnvVarInfo } from "./use-env-variables";

/**
 * What a caller's own value editor is given.
 *
 * A caller supplies the INPUT, not the rules: whether editing is allowed at
 * all, what happens on save, and what a cleared override means are decided by
 * the row and handed over here.
 */
export interface EnvValueEditorProps {
  variable: EnvVarInfo;
  /** The unsaved draft value. */
  value: string;
  onChange: (value: string) => void;
  /** Store the draft. Does nothing while {@link canSave} is false. */
  onSave: () => void;
  /** Abandon the draft and close the editor. */
  onCancel: () => void;
  /** Remove the stored override. Only meaningful while {@link canClear}. */
  onClear: () => void;
  /** Whether there is a stored override to remove. */
  canClear: boolean;
  /** Whether the current draft may be stored. */
  canSave: boolean;
  saving: boolean;
  clearing: boolean;
}

export interface EnvVariableRowProps {
  variable: EnvVarInfo;
  /** Whether this row's editor is open. Owned by the caller so a surface can
      decide how many rows may be open at once. */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  saveOverride: (name: string, value: string) => Promise<boolean>;
  clearOverride: (name: string) => Promise<boolean>;
  saving: boolean;
  clearing: boolean;
  /**
   * Render the value input in place of the default text box. The save,
   * cancel and clear controls stay with the row, so a custom editor cannot
   * acquire different write behaviour than the default one.
   */
  renderValueEditor?: (props: EnvValueEditorProps) => ReactNode;
  /**
   * An additional refusal for a draft value, beyond "not empty" — a caller
   * that knows what shape the value must take says so here, and the row
   * refuses to save what it rejects.
   */
  canSaveValue?: (value: string) => boolean;
}

/**
 * One environment variable, as every surface must present it.
 *
 * This is the ONE place that decides what an admin is told about a variable:
 * which badges apply, whether it can be edited here at all, why not when it
 * cannot, and when a change is picked up. A second surface renders this
 * component rather than its own reading of the same fields, so the two can
 * never end up telling an admin different things about the same variable.
 */
export function EnvVariableRow({
  variable,
  editing,
  onEditingChange,
  saveOverride,
  clearOverride,
  saving,
  clearing,
  renderValueEditor,
  canSaveValue,
}: EnvVariableRowProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  /** Which variable the draft was seeded from, so an editor opened by the
      caller (not only by this row's own button) still starts from the
      current value — seeded during the opening render rather than in an
      effect, which would land after the editor has already drawn empty. */
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const envLocked = variable.source === "environment";
  const editable = variable.overridable && !envLocked;

  if (editing && seededFor !== variable.name) {
    setSeededFor(variable.name);
    setDraft(variable.secret ? "" : (variable.value ?? ""));
  }
  if (!editing && seededFor !== null) {
    setSeededFor(null);
  }

  const canSave = draft !== "" && (canSaveValue?.(draft) ?? true);

  const closeEditor = () => {
    onEditingChange(false);
    setDraft("");
  };

  const save = async () => {
    if (!canSave || saving) return;
    const stored = await saveOverride(variable.name, draft);
    // A refused value keeps the editor open with the draft intact — the
    // admin's next move is to correct it, not to type it again.
    if (stored) closeEditor();
  };

  const clear = async () => {
    if (clearing) return;
    const removed = await clearOverride(variable.name);
    if (removed && editing) closeEditor();
  };

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Copy failed",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const editorProps: EnvValueEditorProps = {
    variable,
    value: draft,
    onChange: setDraft,
    onSave: () => void save(),
    onCancel: closeEditor,
    onClear: () => void clear(),
    canClear: variable.source === "override",
    canSave,
    saving,
    clearing,
  };

  const saveButton = (
    <Button
      size="sm"
      onClick={() => void save()}
      disabled={saving || !canSave}
      data-testid={`env-save-${variable.name}`}
    >
      Save
    </Button>
  );
  const cancelButton = (
    <Button size="sm" variant="ghost" onClick={closeEditor}>
      Cancel
    </Button>
  );

  return (
    <div className="py-3" data-testid={`env-row-${variable.name}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-medium">{variable.name}</span>
            {variable.required && <Badge variant="outline">required</Badge>}
            {variable.secret && <Badge variant="outline">secret</Badge>}
            {envLocked && (
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" /> environment
              </Badge>
            )}
            {variable.source === "override" && <Badge>override</Badge>}
            {variable.released && <Badge variant="outline">released</Badge>}
            {!variable.isSet && <Badge variant="destructive">unset</Badge>}
            {/* Advisory only, and only when the declaration states it — an
                unstated variable shows nothing rather than being presented
                as immediate. */}
            {variable.changeTakesEffect === "restart" && (
              <Badge
                variant="outline"
                className="gap-1"
                data-testid={`env-effect-restart-${variable.name}`}
              >
                <RotateCw className="h-3 w-3" /> restart to apply
              </Badge>
            )}
            {variable.changeTakesEffect === "immediate" && (
              <Badge
                variant="outline"
                className="gap-1"
                data-testid={`env-effect-immediate-${variable.name}`}
              >
                <Zap className="h-3 w-3" /> applies immediately
              </Badge>
            )}
            {variable.changeTakesEffect === "reload" && (
              <Badge
                variant="outline"
                className="gap-1"
                data-testid={`env-effect-reload-${variable.name}`}
              >
                <RefreshCw className="h-3 w-3" /> reload to apply
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{variable.description}</p>
          {!variable.secret && variable.isSet && variable.value !== null && (
            <div className="flex items-start gap-1 mt-1">
              <p className="font-mono text-xs break-all text-muted-foreground">
                {variable.value}
              </p>
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5 shrink-0 text-muted-foreground"
                onClick={() => copyValue(variable.value as string)}
                aria-label={`Copy value of ${variable.name}`}
                data-testid={`env-copy-${variable.name}`}
              >
                {copied ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
          )}
          {variable.secret && variable.isSet && (
            <p
              className="text-xs text-muted-foreground mt-1 flex items-start gap-1"
              data-testid={`env-fingerprint-${variable.name}`}
            >
              <EyeOff className="h-3 w-3 mt-0.5 shrink-0" />
              <span>
                Value concealed
                {variable.valueFingerprint && (
                  <>
                    {" — fingerprint "}
                    <code className="font-mono">{variable.valueFingerprint}</code>
                  </>
                )}
              </span>
            </p>
          )}
          {variable.released && (
            <p className="text-xs text-muted-foreground mt-1">
              Released in deployment settings (empty or __UNSET__) — treated as
              not set.
            </p>
          )}
          {/* About WHEN a change is picked up — separate from the
              deployment-lock notes below, which are about WHICH
              value wins. */}
          {variable.changeTakesEffect === "restart" && (
            <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
              <RotateCw className="h-3 w-3 mt-0.5 shrink-0" />
              Read once while the app starts — saving a new value here does not
              change the running app until it is restarted.
            </p>
          )}
          {variable.changeTakesEffect === "reload" && (
            <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
              <RefreshCw className="h-3 w-3 mt-0.5 shrink-0" />
              Read once while the app starts, but a subsystem can re-read it in
              place — apply a new value from Restart &amp; Reload, no restart
              needed.
            </p>
          )}
          {envLocked && variable.overridable && (
            <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
              <Lock className="h-3 w-3 mt-0.5 shrink-0" />
              Set in the deployment environment — that value wins. To manage it
              here, set it to <code className="font-mono">__UNSET__</code> (or
              empty) in your deployment settings, then restart the app.
            </p>
          )}
          {envLocked && !variable.overridable && (
            <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
              <Lock className="h-3 w-3 mt-0.5 shrink-0" />
              Set in the deployment environment and managed there only — this
              variable cannot be overridden in-app.
            </p>
          )}
          {!variable.overridable && !envLocked && (
            <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
              <Lock className="h-3 w-3 mt-0.5 shrink-0" />
              Managed through the deployment pipeline only — cannot be overridden
              in-app.
            </p>
          )}
          {variable.hasShadowedOverride && (
            <p className="text-xs text-amber-600 mt-1">
              A stored override exists but is shadowed by the environment value.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {editable && !editing && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEditingChange(true)}
              data-testid={`env-edit-${variable.name}`}
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />
              {variable.source === "override" ? "Edit" : "Set"}
            </Button>
          )}
          {variable.source === "override" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void clear()}
              disabled={clearing}
              data-testid={`env-clear-${variable.name}`}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </div>
      {editing &&
        (renderValueEditor ? (
          <div className="mt-2 space-y-2">
            {renderValueEditor(editorProps)}
            <div className="flex items-center gap-2">
              {saveButton}
              {cancelButton}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 mt-2">
            <Input
              type={variable.secret ? "password" : "text"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={variable.secret ? "New secret value" : "Value"}
              className="font-mono text-sm"
              data-testid={`env-input-${variable.name}`}
            />
            {saveButton}
            {cancelButton}
          </div>
        ))}
    </div>
  );
}
