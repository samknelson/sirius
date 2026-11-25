import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import ConfigurationLayout from "@/components/layouts/ConfigurationLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useSetVariable, useVariableValue } from "@/lib/use-variable";
import {
  CONTRACT_CHAT_OPERATIONS,
  CONTRACT_CHAT_SETTINGS_VARIABLE,
  parseContractChatSettings,
} from "../../shared/settings";

interface VendorConfiguration {
  id: string;
  pluginName: string;
  name: string | null;
  operations: { id: string }[];
}

type LoadedSettings =
  | { valid: true; providerConfigId: string | null }
  | { valid: false; error: string };

const NO_PROVIDER = "__no_provider__";

function asLoadedSettings(value: unknown): LoadedSettings {
  const parsed = parseContractChatSettings(value);
  return parsed.valid
    ? { valid: true, providerConfigId: parsed.settings.providerConfigId }
    : { valid: false, error: parsed.error };
}

function configurationLabel(configuration: VendorConfiguration): string {
  return `${configuration.name?.trim() || "Unnamed configuration"} — ${configuration.pluginName} · ${configuration.id}`;
}

export default function ContractChatSettingsPage() {
  usePageTitle("Contract Chat");

  const settingsQuery = useVariableValue(CONTRACT_CHAT_SETTINGS_VARIABLE);
  const vendorQuery = useQuery<VendorConfiguration[]>({
    queryKey: ["/api/wc-vendors"],
  });
  const saveMutation = useSetVariable(CONTRACT_CHAT_SETTINGS_VARIABLE);

  const [loadedSettings, setLoadedSettings] = useState<LoadedSettings | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [choiceTouched, setChoiceTouched] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<
    { kind: "success" | "error"; message: string } | null
  >(null);
  const choiceTouchedRef = useRef(false);

  // A background refetch may refresh a clean form, but must never replace a
  // choice the administrator has already started making.
  useEffect(() => {
    if (!settingsQuery.isSuccess || choiceTouchedRef.current) return;
    const next = asLoadedSettings(settingsQuery.data);
    setLoadedSettings(next);
    setSelectedProviderId(next.valid ? next.providerConfigId : null);
  }, [settingsQuery.data, settingsQuery.isSuccess]);

  const configurations = (vendorQuery.data ?? []).filter((configuration) => {
    const availableOperations = new Set(configuration.operations.map((operation) => operation.id));
    return CONTRACT_CHAT_OPERATIONS.every((operationId) => availableOperations.has(operationId));
  });

  const savedProviderId = loadedSettings?.valid ? loadedSettings.providerConfigId : null;
  const savedConfigurationIsListed =
    savedProviderId !== null && configurations.some((configuration) => configuration.id === savedProviderId);
  const canAssessAvailability = vendorQuery.isSuccess && !vendorQuery.isError;
  const savedProviderUnavailable =
    savedProviderId !== null && canAssessAvailability && !savedConfigurationIsListed;

  const hasChanges = Boolean(
    choiceTouched &&
      (!loadedSettings?.valid ||
        selectedProviderId !== loadedSettings.providerConfigId),
  );
  const settingsReadFailed = settingsQuery.isError;
  const canSave =
    hasChanges &&
    !settingsQuery.isLoading &&
    !settingsReadFailed &&
    !saveMutation.isPending;

  const updateChoice = (providerId: string | null) => {
    const returnsToSavedChoice =
      loadedSettings?.valid && providerId === loadedSettings.providerConfigId;
    choiceTouchedRef.current = !returnsToSavedChoice;
    setChoiceTouched(!returnsToSavedChoice);
    setSelectedProviderId(providerId);
    setSaveFeedback(null);
  };

  const saveChoice = () => {
    if (!canSave) return;
    setSaveFeedback(null);
    saveMutation.mutate(
      { providerConfigId: selectedProviderId },
      {
        onSuccess: () => {
          const saved: LoadedSettings = { valid: true, providerConfigId: selectedProviderId };
          setLoadedSettings(saved);
          setChoiceTouched(false);
          choiceTouchedRef.current = false;
          setSaveFeedback({ kind: "success", message: "Contract Chat configuration saved." });
        },
        onError: (error) => {
          setSaveFeedback({
            kind: "error",
            message: error.message || "The configuration could not be saved. Try again.",
          });
        },
      },
    );
  };

  const selectDisabled =
    settingsQuery.isLoading || loadedSettings === null || saveMutation.isPending;
  const retainedSelectedId = selectedProviderId !== null &&
    !configurations.some((configuration) => configuration.id === selectedProviderId);
  const visibleSelectedId = selectedProviderId ?? NO_PROVIDER;

  return (
    <ConfigurationLayout>
      <main className="space-y-6">
        <header>
          <p className="text-sm font-medium text-muted-foreground">Webclient operations</p>
          <h1 className="mt-1 text-xl font-bold text-foreground md:text-2xl" data-testid="heading-contract-chat-settings">
            Contract Chat
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Choose which enabled webclient configuration Contract Chat records for union operations.
            This setting stores a configuration choice only; it does not contact the provider.
          </p>
        </header>

        {settingsQuery.isLoading && (
          <Card aria-label="Loading Contract Chat settings">
            <CardContent className="space-y-4 p-6">
              <div className="h-4 w-44 animate-pulse rounded bg-muted" />
              <div className="h-10 w-full animate-pulse rounded bg-muted" />
              <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        )}

        {settingsReadFailed && (
          <Alert variant="destructive" role="alert">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Contract Chat settings could not be read. Saving is disabled until the settings can
                be loaded.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void settingsQuery.refetch()}
                disabled={settingsQuery.isFetching}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${settingsQuery.isFetching ? "animate-spin" : ""}`} />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {loadedSettings && !loadedSettings.valid && (
          <Alert variant="destructive" role="alert" data-testid="alert-invalid-contract-chat-settings">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <span className="font-medium">The saved Contract Chat setting is invalid.</span>{" "}
              {loadedSettings.error} Choose a configuration or explicitly clear the setting before
              saving a replacement.
            </AlertDescription>
          </Alert>
        )}

        {loadedSettings && (
          <Card>
            <CardHeader>
              <CardTitle>Webclient configuration</CardTitle>
              <CardDescription>
                Select one configuration that supports every Contract Chat operation, or explicitly
                clear the saved choice.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {savedProviderId && (
                <div
                  className={`rounded-md border p-4 ${
                    savedProviderUnavailable
                      ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
                      : "border-border bg-muted/40"
                  }`}
                  role={savedProviderUnavailable ? "status" : undefined}
                  data-testid="text-saved-provider"
                >
                  <p className="text-sm font-medium">
                    {savedProviderUnavailable ? "Saved configuration is unavailable" : "Currently saved"}
                  </p>
                  <p className="mt-1 break-all text-sm">
                    {savedConfigurationIsListed
                      ? configurationLabel(configurations.find((item) => item.id === savedProviderId)!)
                      : `Configuration ID: ${savedProviderId}`}
                  </p>
                  {vendorQuery.isLoading && (
                    <p className="mt-2 text-sm text-muted-foreground">Checking configuration availability…</p>
                  )}
                  {vendorQuery.isError && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Availability could not be checked. The saved configuration has not been changed.
                    </p>
                  )}
                  {savedProviderUnavailable && (
                    <p className="mt-2 text-sm">
                      It is not in the available configurations. It will remain selected until you
                      explicitly replace or clear it.
                    </p>
                  )}
                </div>
              )}

              {vendorQuery.isError && (
                <Alert variant="destructive" role="alert">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                    <span>Available webclient configurations could not be loaded.</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void vendorQuery.refetch()}
                      disabled={vendorQuery.isFetching}
                    >
                      <RefreshCw className={`mr-2 h-4 w-4 ${vendorQuery.isFetching ? "animate-spin" : ""}`} />
                      Retry
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="contract-chat-provider">Configuration choice</Label>
                <Select
                  value={visibleSelectedId}
                  onValueChange={(value) => updateChoice(value === NO_PROVIDER ? null : value)}
                  disabled={selectDisabled}
                >
                  <SelectTrigger id="contract-chat-provider" aria-label="Contract Chat webclient configuration">
                    <SelectValue placeholder="Choose a configuration" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROVIDER}>No configuration</SelectItem>
                    {retainedSelectedId && selectedProviderId && (
                      <SelectItem value={selectedProviderId} disabled>
                        {canAssessAvailability ? "Unavailable configuration" : "Saved configuration"} · {selectedProviderId}
                      </SelectItem>
                    )}
                    {configurations.map((configuration) => (
                      <SelectItem key={configuration.id} value={configuration.id}>
                        {configurationLabel(configuration)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {vendorQuery.isLoading && (
                  <p className="text-sm text-muted-foreground">Loading available configurations…</p>
                )}
                {vendorQuery.isSuccess && configurations.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No Contract Chat connections are available. First create and enable a Contract Chat
                    connection in the{" "}
                    <a className="underline" href="/admin/plugin-configs/wc-vendors">Webclient Vendors editor</a>.
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Available choices include configuration name, provider, and ID so similarly named
                  entries remain distinguishable.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => updateChoice(null)}
                  disabled={selectDisabled || (selectedProviderId === null && loadedSettings.valid)}
                  data-testid="button-clear-contract-chat-provider"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear choice
                </Button>
                <Button
                  type="button"
                  onClick={saveChoice}
                  disabled={!canSave}
                  data-testid="button-save-contract-chat-settings"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save choice
                </Button>
                {choiceTouched && hasChanges && (
                  <span className="text-sm text-muted-foreground">Unsaved choice</span>
                )}
              </div>

              {saveFeedback && (
                <Alert
                  variant={saveFeedback.kind === "error" ? "destructive" : "default"}
                  role={saveFeedback.kind === "error" ? "alert" : "status"}
                  data-testid={`alert-contract-chat-save-${saveFeedback.kind}`}
                >
                  {saveFeedback.kind === "success" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <AlertDescription>{saveFeedback.message}</AlertDescription>
                </Alert>
              )}

              <div className="border-t border-border pt-4">
                <Button asChild type="button" variant="link" className="h-auto p-0">
                  <a href="/admin/plugin-configs/wc-vendors">
                    Manage webclient configurations
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </ConfigurationLayout>
  );
}
