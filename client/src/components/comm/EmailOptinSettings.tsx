import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle, Loader2, Mail, Settings, XCircle } from "lucide-react";

interface EmailOptinResponse {
  exists: boolean;
  optin: boolean;
  allowlist: boolean;
  record: {
    id: string;
    email: string;
    optin: boolean;
    optinUser: string | null;
    optinDate: string | null;
    optinIp: string | null;
    allowlist: boolean;
  } | null;
}

interface EmailOptinSettingsProps {
  email?: string | null;
  onStatusChange?: (response: EmailOptinResponse | undefined) => void;
}

export default function EmailOptinSettings({ email, onStatusChange }: EmailOptinSettingsProps) {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const inputId = useId().replace(/:/g, "");
  const savedEmail = email?.trim() ?? "";
  const canManage = hasPermission("staff") && savedEmail.length > 0;
  const queryKey = ["/api/email-optin", savedEmail] as const;

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<EmailOptinResponse>({
    queryKey,
    queryFn: async () => {
      const response = await fetch(`/api/email-optin/${encodeURIComponent(savedEmail)}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load email opt-in status.");
      return response.json();
    },
    enabled: canManage,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    onStatusChangeRef.current?.(data);
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: async ({ emailAddress, optin, allowlist }: {
      emailAddress: string;
      optin?: boolean;
      allowlist?: boolean;
    }) => apiRequest("PUT", `/api/email-optin/${encodeURIComponent(emailAddress)}`, { optin, allowlist }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-optin", variables.emailAddress] });
      toast({
        title: "Email Opt-in Updated",
        description: "The email opt-in status has been updated successfully.",
      });
    },
    onError: (mutationError: Error) => {
      toast({
        title: "Error",
        description: mutationError.message || "Failed to update email opt-in status",
        variant: "destructive",
      });
    },
  });

  if (!canManage) return null;

  const statusLoaded = !isLoading && !isError && !!data;
  const disabled = !statusLoaded || updateMutation.isPending;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="button-email-optin-settings"
      >
        <Settings className="mr-2 h-4 w-4" />
        Opt-in Settings
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Email Opt-in Settings
            </DialogTitle>
            <DialogDescription>
              Manage opt-in and allowlist settings for this email address.
            </DialogDescription>
          </DialogHeader>

          {isLoading || (isFetching && !data) ? (
            <div className="flex items-center justify-center gap-2 py-8" role="status" aria-live="polite">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm text-muted-foreground">Loading opt-in status...</span>
            </div>
          ) : isError ? (
            <div className="space-y-4 py-2">
              <div className="space-y-2" role="alert">
                <p className="text-sm text-destructive">
                  {error instanceof Error ? error.message : "Could not load email opt-in settings."}
                </p>
                <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                  {isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Retry
                </Button>
                <p className="text-xs text-muted-foreground">Settings are unavailable until the status loads successfully.</p>
              </div>
              <Separator />
              <p className="text-sm text-muted-foreground">Current settings could not be confirmed.</p>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor={`${inputId}-optin`} className="text-base font-medium">Opted In</Label>
                <Switch id={`${inputId}-optin`} checked={false} disabled aria-label="Opted In status unavailable" />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor={`${inputId}-allowlist`} className="text-base font-medium">Allowlisted</Label>
                <Switch id={`${inputId}-allowlist`} checked={false} disabled aria-label="Allowlisted status unavailable" />
              </div>
            </div>
          ) : data ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <Label className="text-muted-foreground">Email Address</Label>
                <p className="break-all font-medium">{savedEmail}</p>
              </div>
              <Separator />
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 space-y-0.5">
                    <Label htmlFor={`${inputId}-optin`} className="text-base font-medium">Opted In</Label>
                    <p className="text-sm text-muted-foreground">Allow sending emails to this address</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {data.optin ? <CheckCircle aria-hidden="true" className="h-4 w-4 text-green-600" /> : <XCircle aria-hidden="true" className="h-4 w-4 text-muted-foreground" />}
                    <Switch
                      id={`${inputId}-optin`}
                      checked={data.optin}
                      onCheckedChange={(checked) => updateMutation.mutate({ emailAddress: savedEmail, optin: checked })}
                      disabled={disabled}
                      data-testid="switch-email-optin"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 space-y-0.5">
                    <Label htmlFor={`${inputId}-allowlist`} className="text-base font-medium">Allowlisted</Label>
                    <p className="text-sm text-muted-foreground">Allow sending in dev/test modes</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {data.allowlist ? <CheckCircle aria-hidden="true" className="h-4 w-4 text-green-600" /> : <XCircle aria-hidden="true" className="h-4 w-4 text-muted-foreground" />}
                    <Switch
                      id={`${inputId}-allowlist`}
                      checked={data.allowlist}
                      onCheckedChange={(checked) => updateMutation.mutate({ emailAddress: savedEmail, allowlist: checked })}
                      disabled={disabled}
                      data-testid="switch-email-allowlist"
                    />
                  </div>
                </div>
              </div>
              {data.record?.optinDate && (
                <>
                  <Separator />
                  <p className="text-sm text-muted-foreground">
                    Opted in on: {new Date(data.record.optinDate).toLocaleString()}
                  </p>
                </>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
