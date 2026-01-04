import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Phone, CheckCircle, XCircle, RefreshCw, Loader2, Settings } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SmsProviderInfo {
  id: string;
  displayName: string;
  supportedFeatures: string[];
}

interface SmsConfig {
  defaultProvider: string;
  providers: SmsProviderInfo[];
  currentProvider: {
    id: string;
    displayName: string;
    supportedFeatures: string[];
    supportsSms: boolean;
    config: Record<string, unknown>;
    connection: {
      success: boolean;
      message?: string;
      error?: string;
      details?: Record<string, unknown>;
    };
  };
}

interface TwilioAccountInfo {
  connected: boolean;
  accountSid?: string;
  accountName?: string;
  configuredPhoneNumber?: string;
  defaultPhoneNumber?: string;
  error?: string;
  currentProvider?: string;
}

interface TwilioPhoneNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  capabilities: {
    sms: boolean;
    voice: boolean;
    mms: boolean;
  };
}

interface TestConnectionResult {
  success: boolean;
  message?: string;
  error?: string;
  details?: {
    accountSid?: string;
    accountName?: string;
    status?: string;
  };
}

export default function TwilioConfigPage() {
  usePageTitle("Twilio Settings");
  const { toast } = useToast();

  const { data: smsConfig, isLoading: isLoadingSmsConfig } = useQuery<SmsConfig>({
    queryKey: ["/api/config/sms"],
  });

  const { data: accountInfo, isLoading: isLoadingAccount } = useQuery<TwilioAccountInfo>({
    queryKey: ["/api/config/twilio"],
  });

  const { data: phoneNumbers, isLoading: isLoadingNumbers, refetch: refetchNumbers } = useQuery<TwilioPhoneNumber[]>({
    queryKey: ["/api/config/twilio/phone-numbers"],
    enabled: accountInfo?.connected === true,
  });

  const setProviderMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return await apiRequest("PUT", "/api/config/sms/provider", { providerId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config/sms"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config/twilio"] });
      toast({
        title: "Provider Updated",
        description: "The SMS provider has been changed",
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
      const response = await apiRequest("POST", "/api/config/sms/test");
      return response as TestConnectionResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/config/sms"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config/twilio"] });
      if (data.success) {
        toast({
          title: "Connection Successful",
          description: data.message || `Connected to SMS provider`,
        });
        refetchNumbers();
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

  const setDefaultPhoneMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      return await apiRequest("PUT", "/api/config/sms/default-phone", { phoneNumber });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config/twilio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config/sms"] });
      toast({
        title: "Default Phone Updated",
        description: "The default outbound phone number has been updated",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update default phone number",
        variant: "destructive",
      });
    },
  });

  const handlePhoneSelect = (phoneNumber: string) => {
    setDefaultPhoneMutation.mutate(phoneNumber);
  };

  const handleProviderChange = (providerId: string) => {
    setProviderMutation.mutate(providerId);
  };

  const currentProviderId = smsConfig?.defaultProvider || smsConfig?.currentProvider?.id;
  const isTwilioActive = currentProviderId === 'twilio';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold" data-testid="heading-sms-config">SMS Configuration</h2>
        <p className="text-muted-foreground mt-1">
          Manage your SMS provider for messaging and phone validation
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            SMS Provider
          </CardTitle>
          <CardDescription>
            Select which service to use for SMS messaging and phone validation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingSmsConfig ? (
            <Skeleton className="h-10 w-64" />
          ) : (
            <div className="flex items-center gap-4 flex-wrap">
              <Select
                value={currentProviderId}
                onValueChange={handleProviderChange}
                disabled={setProviderMutation.isPending}
              >
                <SelectTrigger className="w-64" data-testid="select-sms-provider">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {smsConfig?.providers?.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {smsConfig?.currentProvider && (
                <div className="flex items-center gap-2 flex-wrap">
                  {smsConfig.currentProvider.supportedFeatures.map((feature) => (
                    <Badge key={feature} variant="outline" className="text-xs">
                      {feature}
                    </Badge>
                  ))}
                  {!smsConfig.currentProvider.supportsSms && (
                    <Badge variant="secondary" className="text-xs">
                      No SMS Support
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
            <Phone className="h-5 w-5" />
            Connection Status
          </CardTitle>
          <CardDescription>
            View and test your SMS provider connection
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingAccount || isLoadingSmsConfig ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                {smsConfig?.currentProvider?.connection?.success ? (
                  <>
                    <Badge variant="default" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                    {smsConfig.currentProvider.connection.message && (
                      <span className="text-sm text-muted-foreground">
                        {smsConfig.currentProvider.connection.message}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <Badge variant="destructive">
                      <XCircle className="h-3 w-3 mr-1" />
                      Not Connected
                    </Badge>
                    {smsConfig?.currentProvider?.connection?.error && (
                      <span className="text-sm text-muted-foreground">
                        {smsConfig.currentProvider.connection.error}
                      </span>
                    )}
                  </>
                )}
              </div>

              {isTwilioActive && accountInfo?.accountSid && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Account SID: </span>
                  <code className="bg-muted px-1 py-0.5 rounded text-xs">
                    {accountInfo.accountSid}
                  </code>
                </div>
              )}

              {isTwilioActive && accountInfo?.configuredPhoneNumber && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Environment Phone: </span>
                  <code className="bg-muted px-1 py-0.5 rounded text-xs">
                    {accountInfo.configuredPhoneNumber}
                  </code>
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

      {isTwilioActive && accountInfo?.connected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Outbound Phone Numbers
            </CardTitle>
            <CardDescription>
              Select the default phone number for sending SMS messages
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingNumbers ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : phoneNumbers && phoneNumbers.length > 0 ? (
              <RadioGroup
                value={accountInfo?.defaultPhoneNumber || ""}
                onValueChange={handlePhoneSelect}
                className="space-y-3"
                disabled={setDefaultPhoneMutation.isPending}
              >
                {phoneNumbers.map((phone) => (
                  <div
                    key={phone.sid}
                    className={`relative flex items-start gap-4 p-4 rounded-md border transition-colors ${
                      accountInfo?.defaultPhoneNumber === phone.phoneNumber
                        ? "border-primary bg-primary/5"
                        : "border-border"
                    }`}
                  >
                    <RadioGroupItem
                      value={phone.phoneNumber}
                      id={`phone-${phone.sid}`}
                      className="mt-1"
                      data-testid={`radio-phone-${phone.sid}`}
                    />
                    <div className="flex-1">
                      <Label
                        htmlFor={`phone-${phone.sid}`}
                        className="text-base font-medium cursor-pointer flex items-center gap-2 flex-wrap"
                      >
                        {phone.phoneNumber}
                        {accountInfo?.defaultPhoneNumber === phone.phoneNumber && (
                          <Badge variant="secondary" className="text-xs">Default</Badge>
                        )}
                      </Label>
                      {phone.friendlyName && phone.friendlyName !== phone.phoneNumber && (
                        <p className="text-sm text-muted-foreground">
                          {phone.friendlyName}
                        </p>
                      )}
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {phone.capabilities.sms && (
                          <Badge variant="outline" className="text-xs">SMS</Badge>
                        )}
                        {phone.capabilities.voice && (
                          <Badge variant="outline" className="text-xs">Voice</Badge>
                        )}
                        {phone.capabilities.mms && (
                          <Badge variant="outline" className="text-xs">MMS</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </RadioGroup>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Phone className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No phone numbers found in your Twilio account</p>
                <p className="text-sm">Purchase a phone number in your Twilio console to enable SMS</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isTwilioActive && !accountInfo?.connected && !isLoadingAccount && (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              <Phone className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium mb-2">Twilio Not Configured</p>
              <p className="text-sm mb-4">
                To enable SMS messaging, configure your Twilio credentials:
              </p>
              <div className="text-left max-w-md mx-auto bg-muted p-4 rounded-md text-sm font-mono">
                <p>TWILIO_ACCOUNT_SID=your_account_sid</p>
                <p>TWILIO_AUTH_TOKEN=your_auth_token</p>
                <p>TWILIO_PHONE_NUMBER=+1234567890</p>
              </div>
              <p className="text-sm mt-4">
                Add these to your environment secrets, then test the connection.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!isTwilioActive && (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              <Phone className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium mb-2">Local Provider Active</p>
              <p className="text-sm">
                The local provider can validate phone numbers but cannot send SMS messages.
                Switch to Twilio to enable SMS functionality.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
