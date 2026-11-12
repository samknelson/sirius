import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useParams } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WsClientLayout, useWsClientLayout } from "@/components/layouts/WsClientLayout";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";

const PLUGIN_ID = "sitespecific-freeman-authorization";
const DATA_KEY = "freemanBearerAuthorizationConfigId";
const NONE = "__none__";

interface WcVendorConfig {
  id: string;
  pluginId: string;
  name: string | null;
  siriusId: string | number | null;
}

function configurationLabel(configuration: WcVendorConfig): string {
  if (configuration.name?.trim()) return configuration.name;
  if (configuration.siriusId !== null && configuration.siriusId !== undefined) {
    return String(configuration.siriusId);
  }
  return "[no name or Sirius ID]";
}

function FreemanBearerAuthorizationContent() {
  const { id } = useParams<{ id: string }>();
  const { client } = useWsClientLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const savedId =
    typeof client.data?.[DATA_KEY] === "string" ? client.data[DATA_KEY] : undefined;
  const [selectedId, setSelectedId] = useState(savedId ?? NONE);
  const [saved, setSaved] = useState(false);

  const {
    data: allConfigurations = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<WcVendorConfig[]>({
    queryKey: ["/api/wc-vendors"],
  });
  const configurations = allConfigurations.filter(
    (configuration) => configuration.pluginId === PLUGIN_ID,
  );
  const savedConfigurationIsUnavailable =
    Boolean(savedId) && !configurations.some((configuration) => configuration.id === savedId);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = { ...(client.data ?? {}) };
      if (selectedId === NONE) {
        delete data[DATA_KEY];
      } else {
        data[DATA_KEY] = selectedId;
      }
      return apiRequest("PATCH", `/api/admin/ws-clients/${id}`, { data });
    },
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ws-clients", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ws-clients"] });
      toast({
        title: "Authorization configuration saved",
        description: "The incoming client has been updated.",
      });
    },
    onError: (error: unknown) => {
      setSaved(false);
      toast({
        title: "Failed to save authorization configuration",
        description: getApiErrorMessage(error, "An error occurred"),
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Freeman Bearer Authorization</CardTitle>
        <CardDescription>
          Choose the outgoing Freeman configuration associated with this incoming client.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTitle>Required request headers</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              When this client uses Freeman Bearer Authorization, every request must include:
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-sm text-foreground">
              <code>{`X-WS-Client-ID: <client id>
Authorization: Bearer <token>`}</code>
            </pre>
            <p>
              X-WS-Client-Secret is not required or checked. HTTP Basic authentication cannot be
              used because Authorization carries the bearer token.
            </p>
          </AlertDescription>
        </Alert>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="loader-freeman-authorization">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading configurations…
          </div>
        ) : isError ? (
          <Alert variant="destructive">
            <AlertTitle>Configurations could not be loaded</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>Try loading the available Freeman configurations again.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Try Again
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {savedConfigurationIsUnavailable && (
              <Alert>
                <AlertTitle>Saved configuration is unavailable</AlertTitle>
                <AlertDescription>
                  The previously selected configuration is disabled or no longer available. Select
                  another configuration or clear the selection.
                </AlertDescription>
              </Alert>
            )}
            {configurations.length === 0 && (
              <Alert>
                <AlertTitle>No Freeman configurations available</AlertTitle>
                <AlertDescription>
                  There are no enabled Freeman Bearer Authorization configurations to select.
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="freeman-authorization-config">Outgoing configuration</Label>
              <Select
                value={selectedId}
                onValueChange={(value) => {
                  setSelectedId(value);
                  setSaved(false);
                }}
              >
                <SelectTrigger id="freeman-authorization-config" data-testid="select-freeman-authorization">
                  <SelectValue placeholder="Select a configuration" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No configuration</SelectItem>
                  {configurations.map((configuration) => (
                    <SelectItem key={configuration.id} value={configuration.id}>
                      {configurationLabel(configuration)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                data-testid="button-save-freeman-authorization"
              >
                {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
              {saved && (
                <p className="text-sm text-muted-foreground" role="status">
                  Saved successfully.
                </p>
              )}
              {saveMutation.isError && (
                <p className="text-sm text-destructive" role="alert">
                  Save failed. Your previous selection was not changed.
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function WsClientFreemanBearerAuthorizationPage() {
  return (
    <WsClientLayout activeTab="freeman-bearer-authorization">
      <FreemanBearerAuthorizationContent />
    </WsClientLayout>
  );
}