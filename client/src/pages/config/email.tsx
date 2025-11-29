import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Mail, CheckCircle, XCircle, RefreshCw, Loader2, Settings, Send } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";

interface EmailProviderInfo {
  id: string;
  displayName: string;
  supportedFeatures: string[];
}

interface EmailConfig {
  defaultProvider: string;
  providers: EmailProviderInfo[];
  currentProvider: {
    id: string;
    displayName: string;
    supportedFeatures: string[];
    supportsEmail: boolean;
    config: Record<string, unknown>;
    connection: {
      success: boolean;
      message?: string;
      error?: string;
      details?: Record<string, unknown>;
    };
  };
}

interface SendGridInfo {
  connected: boolean;
  apiKeyConfigured?: boolean;
  defaultFromEmail?: string;
  defaultFromName?: string;
  error?: string;
  currentProvider?: string;
}

interface TestConnectionResult {
  success: boolean;
  message?: string;
  error?: string;
  details?: Record<string, unknown>;
}

interface DefaultFromAddress {
  defaultFromEmail?: string;
  defaultFromName?: string;
}

export default function EmailConfigPage() {
  const { toast } = useToast();
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");

  const { data: emailConfig, isLoading: isLoadingEmailConfig } = useQuery<EmailConfig>({
    queryKey: ["/api/config/email"],
  });

  const { data: sendgridInfo, isLoading: isLoadingSendGrid } = useQuery<SendGridInfo>({
    queryKey: ["/api/config/sendgrid"],
  });

  const { data: defaultFrom, isLoading: isLoadingDefaultFrom } = useQuery<DefaultFromAddress>({
    queryKey: ["/api/config/email/default-from"],
  });

  const setProviderMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return await apiRequest("PUT", "/api/config/email/provider", { providerId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config/email"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config/sendgrid"] });
      toast({
        title: "Provider Updated",
        description: "The email provider has been changed",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update provider",
        variant: "destructive",
      });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async (): Promise<TestConnectionResult> => {
      const response = await apiRequest("POST", "/api/config/email/test");
      return response as TestConnectionResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/config/email"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config/sendgrid"] });
      if (data.success) {
        toast({
          title: "Connection Successful",
          description: data.message || `Connected to email provider`,
        });
      } else {
        toast({
          title: "Connection Failed",
          description: data.error || "Unable to connect to provider",
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to test connection",
        variant: "destructive",
      });
    },
  });

  const setDefaultFromMutation = useMutation({
    mutationFn: async ({ email, name }: { email: string; name?: string }) => {
      return await apiRequest("PUT", "/api/config/email/default-from", { email, name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config/email/default-from"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config/sendgrid"] });
      toast({
        title: "Default From Address Updated",
        description: "The default sender address has been updated",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update default from address",
        variant: "destructive",
      });
    },
  });

  const handleProviderChange = (providerId: string) => {
    setProviderMutation.mutate(providerId);
  };

  const handleSaveFromAddress = () => {
    if (!fromEmail) {
      toast({
        title: "Error",
        description: "Email address is required",
        variant: "destructive",
      });
      return;
    }
    setDefaultFromMutation.mutate({ email: fromEmail, name: fromName || undefined });
  };

  const currentProviderId = emailConfig?.defaultProvider || emailConfig?.currentProvider?.id;
  const isSendGridActive = currentProviderId === 'sendgrid';

  const displayFromEmail = defaultFrom?.defaultFromEmail || sendgridInfo?.defaultFromEmail || "";
  const displayFromName = defaultFrom?.defaultFromName || sendgridInfo?.defaultFromName || "";

  useEffect(() => {
    if (displayFromEmail && !fromEmail) {
      setFromEmail(displayFromEmail);
    }
    if (displayFromName && !fromName) {
      setFromName(displayFromName);
    }
  }, [displayFromEmail, displayFromName]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold" data-testid="heading-email-config">Email Configuration</h2>
        <p className="text-muted-foreground mt-1">
          Manage your email provider for sending messages
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Email Provider
          </CardTitle>
          <CardDescription>
            Select which service to use for sending emails
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingEmailConfig ? (
            <Skeleton className="h-10 w-64" />
          ) : (
            <div className="flex items-center gap-4 flex-wrap">
              <Select
                value={currentProviderId}
                onValueChange={handleProviderChange}
                disabled={setProviderMutation.isPending}
              >
                <SelectTrigger className="w-64" data-testid="select-email-provider">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {emailConfig?.providers?.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {emailConfig?.currentProvider && (
                <div className="flex items-center gap-2 flex-wrap">
                  {emailConfig.currentProvider.supportedFeatures.map((feature) => (
                    <Badge key={feature} variant="outline" className="text-xs">
                      {feature}
                    </Badge>
                  ))}
                  {!emailConfig.currentProvider.supportsEmail && (
                    <Badge variant="secondary" className="text-xs">
                      No Email Support
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Connection Status
          </CardTitle>
          <CardDescription>
            View and test your email provider connection
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingSendGrid || isLoadingEmailConfig ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                {emailConfig?.currentProvider?.connection?.success ? (
                  <>
                    <Badge variant="default" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                    {emailConfig.currentProvider.connection.message && (
                      <span className="text-sm text-muted-foreground">
                        {emailConfig.currentProvider.connection.message}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <Badge variant="destructive">
                      <XCircle className="h-3 w-3 mr-1" />
                      Not Connected
                    </Badge>
                    {emailConfig?.currentProvider?.connection?.error && (
                      <span className="text-sm text-muted-foreground">
                        {emailConfig.currentProvider.connection.error}
                      </span>
                    )}
                  </>
                )}
              </div>

              {isSendGridActive && sendgridInfo?.apiKeyConfigured && (
                <div className="text-sm">
                  <span className="text-muted-foreground">API Key: </span>
                  <Badge variant="outline" className="text-xs">Configured</Badge>
                </div>
              )}

              <Button
                onClick={() => testConnectionMutation.mutate()}
                disabled={testConnectionMutation.isPending}
                variant="outline"
                data-testid="button-test-connection"
              >
                {testConnectionMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Test Connection
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {isSendGridActive && emailConfig?.currentProvider?.connection?.success && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Default Sender Address
            </CardTitle>
            <CardDescription>
              Set the default email address used when sending emails
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoadingDefaultFrom ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="space-y-4 max-w-md">
                <div className="space-y-2">
                  <Label htmlFor="from-email">From Email</Label>
                  <Input
                    id="from-email"
                    type="email"
                    placeholder="noreply@example.com"
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                    data-testid="input-from-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="from-name">From Name (optional)</Label>
                  <Input
                    id="from-name"
                    type="text"
                    placeholder="Your Company Name"
                    value={fromName}
                    onChange={(e) => setFromName(e.target.value)}
                    data-testid="input-from-name"
                  />
                </div>
                <Button
                  onClick={handleSaveFromAddress}
                  disabled={setDefaultFromMutation.isPending || !fromEmail}
                  data-testid="button-save-from-address"
                >
                  {setDefaultFromMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : null}
                  Save Default From Address
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isSendGridActive && !emailConfig?.currentProvider?.connection?.success && !isLoadingEmailConfig && (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium mb-2">SendGrid Not Configured</p>
              <p className="text-sm mb-4">
                To enable email messaging, configure your SendGrid credentials:
              </p>
              <div className="text-left max-w-md mx-auto bg-muted p-4 rounded-md text-sm font-mono">
                <p>SENDGRID_API_KEY=your_api_key</p>
                <p>SENDGRID_FROM_EMAIL=noreply@example.com</p>
                <p>SENDGRID_FROM_NAME=Your Company (optional)</p>
              </div>
              <p className="text-sm mt-4">
                Add these to your environment secrets, then test the connection.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!isSendGridActive && !isLoadingEmailConfig && (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium mb-2">Local Provider Active</p>
              <p className="text-sm">
                The local provider can validate email addresses but cannot send emails.
                Switch to SendGrid to enable email functionality.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
