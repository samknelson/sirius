import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Mail, CheckCircle, XCircle, RefreshCw, Loader2, Settings, MapPin, Building } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";

interface PostalProviderInfo {
  id: string;
  displayName: string;
  supportedFeatures: string[];
}

interface PostalConfig {
  defaultProvider: string;
  providers: PostalProviderInfo[];
  currentProvider: {
    id: string;
    displayName: string;
    supportedFeatures: string[];
    supportsPostal: boolean;
    config: Record<string, unknown>;
    connection: {
      success: boolean;
      message?: string;
      error?: string;
      details?: Record<string, unknown>;
    };
  };
}

interface LobInfo {
  connected: boolean;
  apiKeyConfigured?: boolean;
  isTestMode?: boolean;
  returnAddress?: PostalAddress;
  error?: string;
  currentProvider?: string;
}

interface PostalAddress {
  name?: string;
  company?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

interface TestConnectionResult {
  success: boolean;
  message?: string;
  error?: string;
  details?: Record<string, unknown>;
}

interface ReturnAddressResult {
  returnAddress?: PostalAddress;
}

interface AddressVerificationResult {
  valid: boolean;
  deliverable: boolean;
  canonicalAddress?: string;
  normalizedAddress?: PostalAddress;
  error?: string;
}

export default function PostalConfigPage() {
  usePageTitle("Postal Settings");
  const { toast } = useToast();
  const [returnAddress, setReturnAddress] = useState<PostalAddress>({
    name: "",
    company: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    zip: "",
    country: "US",
  });
  const [testAddress, setTestAddress] = useState<Omit<PostalAddress, 'name' | 'company'>>({
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    zip: "",
    country: "US",
  });
  const [verificationResult, setVerificationResult] = useState<AddressVerificationResult | null>(null);

  const { data: postalConfig, isLoading: isLoadingPostalConfig } = useQuery<PostalConfig>({
    queryKey: ["/api/config/postal"],
  });

  const { data: lobInfo, isLoading: isLoadingLob } = useQuery<LobInfo>({
    queryKey: ["/api/config/lob"],
  });

  const { data: savedReturnAddress, isLoading: isLoadingReturnAddress } = useQuery<ReturnAddressResult>({
    queryKey: ["/api/config/postal/return-address"],
  });

  const setProviderMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return await apiRequest("PUT", "/api/config/postal/provider", { providerId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config/postal"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config/lob"] });
      toast({
        title: "Provider Updated",
        description: "The postal provider has been changed",
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
      const response = await apiRequest("POST", "/api/config/postal/test");
      return response as TestConnectionResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/config/postal"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config/lob"] });
      if (data.success) {
        toast({
          title: "Connection Successful",
          description: data.message || `Connected to postal provider`,
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

  const setReturnAddressMutation = useMutation({
    mutationFn: async (address: PostalAddress) => {
      return await apiRequest("PUT", "/api/config/postal/return-address", address);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config/postal/return-address"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config/lob"] });
      toast({
        title: "Return Address Updated",
        description: "The default return address has been saved",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update return address",
        variant: "destructive",
      });
    },
  });

  const verifyAddressMutation = useMutation({
    mutationFn: async (address: Omit<PostalAddress, 'name' | 'company'>): Promise<AddressVerificationResult> => {
      const response = await apiRequest("POST", "/api/config/postal/verify-test-address", address);
      return response as AddressVerificationResult;
    },
    onSuccess: (data) => {
      setVerificationResult(data);
      if (data.valid && data.deliverable) {
        toast({
          title: "Address Valid",
          description: "The address is valid and deliverable",
        });
      } else if (data.valid) {
        toast({
          title: "Address Valid",
          description: "The address is valid but may have delivery issues",
          variant: "default",
        });
      } else {
        toast({
          title: "Address Invalid",
          description: data.error || "The address could not be verified",
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to verify address",
        variant: "destructive",
      });
    },
  });

  const handleProviderChange = (providerId: string) => {
    setProviderMutation.mutate(providerId);
  };

  const handleSaveReturnAddress = () => {
    if (!returnAddress.addressLine1 || !returnAddress.city || !returnAddress.state || !returnAddress.zip) {
      toast({
        title: "Error",
        description: "Address line 1, city, state, and zip are required",
        variant: "destructive",
      });
      return;
    }
    setReturnAddressMutation.mutate(returnAddress);
  };

  const handleVerifyAddress = () => {
    if (!testAddress.addressLine1 || !testAddress.city || !testAddress.state || !testAddress.zip) {
      toast({
        title: "Error",
        description: "Address line 1, city, state, and zip are required for verification",
        variant: "destructive",
      });
      return;
    }
    setVerificationResult(null);
    verifyAddressMutation.mutate(testAddress);
  };

  const currentProviderId = postalConfig?.defaultProvider || postalConfig?.currentProvider?.id;
  const isLobActive = currentProviderId === 'lob';

  useEffect(() => {
    if (savedReturnAddress?.returnAddress) {
      setReturnAddress({
        name: savedReturnAddress.returnAddress.name || "",
        company: savedReturnAddress.returnAddress.company || "",
        addressLine1: savedReturnAddress.returnAddress.addressLine1 || "",
        addressLine2: savedReturnAddress.returnAddress.addressLine2 || "",
        city: savedReturnAddress.returnAddress.city || "",
        state: savedReturnAddress.returnAddress.state || "",
        zip: savedReturnAddress.returnAddress.zip || "",
        country: savedReturnAddress.returnAddress.country || "US",
      });
    }
  }, [savedReturnAddress]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold" data-testid="heading-postal-config">Postal Configuration</h2>
        <p className="text-muted-foreground mt-1">
          Manage your postal provider for sending letters and verifying addresses
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Postal Provider
          </CardTitle>
          <CardDescription>
            Select which service to use for sending postal mail
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingPostalConfig ? (
            <Skeleton className="h-10 w-64" />
          ) : (
            <div className="flex items-center gap-4 flex-wrap">
              <Select
                value={currentProviderId}
                onValueChange={handleProviderChange}
                disabled={setProviderMutation.isPending}
              >
                <SelectTrigger className="w-64" data-testid="select-postal-provider">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {postalConfig?.providers?.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {postalConfig?.currentProvider && (
                <div className="flex items-center gap-2 flex-wrap">
                  {postalConfig.currentProvider.supportedFeatures.map((feature) => (
                    <Badge key={feature} variant="outline" className="text-xs">
                      {feature}
                    </Badge>
                  ))}
                  {!postalConfig.currentProvider.supportsPostal && (
                    <Badge variant="secondary" className="text-xs">
                      No Postal Support
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
            View and test your postal provider connection
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingLob || isLoadingPostalConfig ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                {postalConfig?.currentProvider?.connection?.success ? (
                  <>
                    <Badge variant="default" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                    {postalConfig.currentProvider.connection.message && (
                      <span className="text-sm text-muted-foreground">
                        {postalConfig.currentProvider.connection.message}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <Badge variant="destructive">
                      <XCircle className="h-3 w-3 mr-1" />
                      Not Connected
                    </Badge>
                    {postalConfig?.currentProvider?.connection?.error && (
                      <span className="text-sm text-muted-foreground">
                        {postalConfig.currentProvider.connection.error}
                      </span>
                    )}
                  </>
                )}
              </div>

              {isLobActive && lobInfo?.apiKeyConfigured && (
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="text-sm">
                    <span className="text-muted-foreground">API Key: </span>
                    <Badge variant="outline" className="text-xs">Configured</Badge>
                  </div>
                  {lobInfo?.isTestMode && (
                    <Badge variant="secondary" className="text-xs">Test Mode</Badge>
                  )}
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

      {isLobActive && postalConfig?.currentProvider?.connection?.success && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building className="h-5 w-5" />
              Default Return Address
            </CardTitle>
            <CardDescription>
              Set the default return address for outgoing mail
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoadingReturnAddress ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="space-y-4 max-w-md">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="return-name">Name (optional)</Label>
                    <Input
                      id="return-name"
                      type="text"
                      placeholder="John Smith"
                      value={returnAddress.name}
                      onChange={(e) => setReturnAddress({ ...returnAddress, name: e.target.value })}
                      data-testid="input-return-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="return-company">Company (optional)</Label>
                    <Input
                      id="return-company"
                      type="text"
                      placeholder="Company Name"
                      value={returnAddress.company}
                      onChange={(e) => setReturnAddress({ ...returnAddress, company: e.target.value })}
                      data-testid="input-return-company"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="return-address1">Address Line 1</Label>
                  <Input
                    id="return-address1"
                    type="text"
                    placeholder="123 Main St"
                    value={returnAddress.addressLine1}
                    onChange={(e) => setReturnAddress({ ...returnAddress, addressLine1: e.target.value })}
                    data-testid="input-return-address1"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="return-address2">Address Line 2 (optional)</Label>
                  <Input
                    id="return-address2"
                    type="text"
                    placeholder="Suite 100"
                    value={returnAddress.addressLine2}
                    onChange={(e) => setReturnAddress({ ...returnAddress, addressLine2: e.target.value })}
                    data-testid="input-return-address2"
                  />
                </div>
                <div className="grid grid-cols-6 gap-4">
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="return-city">City</Label>
                    <Input
                      id="return-city"
                      type="text"
                      placeholder="San Francisco"
                      value={returnAddress.city}
                      onChange={(e) => setReturnAddress({ ...returnAddress, city: e.target.value })}
                      data-testid="input-return-city"
                    />
                  </div>
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="return-state">State</Label>
                    <Input
                      id="return-state"
                      type="text"
                      placeholder="CA"
                      value={returnAddress.state}
                      onChange={(e) => setReturnAddress({ ...returnAddress, state: e.target.value })}
                      data-testid="input-return-state"
                    />
                  </div>
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="return-zip">ZIP</Label>
                    <Input
                      id="return-zip"
                      type="text"
                      placeholder="94105"
                      value={returnAddress.zip}
                      onChange={(e) => setReturnAddress({ ...returnAddress, zip: e.target.value })}
                      data-testid="input-return-zip"
                    />
                  </div>
                </div>
                <Button
                  onClick={handleSaveReturnAddress}
                  disabled={setReturnAddressMutation.isPending || !returnAddress.addressLine1 || !returnAddress.city || !returnAddress.state || !returnAddress.zip}
                  data-testid="button-save-return-address"
                >
                  {setReturnAddressMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : null}
                  Save Return Address
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isLobActive && postalConfig?.currentProvider?.connection?.success && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Address Verification Test
            </CardTitle>
            <CardDescription>
              Test address verification using the Lob API
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-4 max-w-md">
              <div className="space-y-2">
                <Label htmlFor="test-address1">Address Line 1</Label>
                <Input
                  id="test-address1"
                  type="text"
                  placeholder="185 Berry St"
                  value={testAddress.addressLine1}
                  onChange={(e) => setTestAddress({ ...testAddress, addressLine1: e.target.value })}
                  data-testid="input-test-address1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="test-address2">Address Line 2 (optional)</Label>
                <Input
                  id="test-address2"
                  type="text"
                  placeholder="Suite 500"
                  value={testAddress.addressLine2}
                  onChange={(e) => setTestAddress({ ...testAddress, addressLine2: e.target.value })}
                  data-testid="input-test-address2"
                />
              </div>
              <div className="grid grid-cols-6 gap-4">
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="test-city">City</Label>
                  <Input
                    id="test-city"
                    type="text"
                    placeholder="San Francisco"
                    value={testAddress.city}
                    onChange={(e) => setTestAddress({ ...testAddress, city: e.target.value })}
                    data-testid="input-test-city"
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="test-state">State</Label>
                  <Input
                    id="test-state"
                    type="text"
                    placeholder="CA"
                    value={testAddress.state}
                    onChange={(e) => setTestAddress({ ...testAddress, state: e.target.value })}
                    data-testid="input-test-state"
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="test-zip">ZIP</Label>
                  <Input
                    id="test-zip"
                    type="text"
                    placeholder="94107"
                    value={testAddress.zip}
                    onChange={(e) => setTestAddress({ ...testAddress, zip: e.target.value })}
                    data-testid="input-test-zip"
                  />
                </div>
              </div>
              <Button
                onClick={handleVerifyAddress}
                disabled={verifyAddressMutation.isPending || !testAddress.addressLine1 || !testAddress.city || !testAddress.state || !testAddress.zip}
                variant="outline"
                data-testid="button-verify-address"
              >
                {verifyAddressMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <MapPin className="h-4 w-4 mr-2" />
                )}
                Verify Address
              </Button>

              {verificationResult && (
                <div className="p-4 border rounded-md space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {verificationResult.valid ? (
                      <Badge variant="default" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Valid
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <XCircle className="h-3 w-3 mr-1" />
                        Invalid
                      </Badge>
                    )}
                    {verificationResult.deliverable ? (
                      <Badge variant="default" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                        Deliverable
                      </Badge>
                    ) : verificationResult.valid && (
                      <Badge variant="secondary">
                        May Not Be Deliverable
                      </Badge>
                    )}
                  </div>
                  {verificationResult.canonicalAddress && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Canonical Address: </span>
                      <span className="font-mono text-xs">{verificationResult.canonicalAddress}</span>
                    </div>
                  )}
                  {verificationResult.normalizedAddress && (
                    <div className="text-sm space-y-1">
                      <span className="text-muted-foreground">Normalized Address:</span>
                      <div className="bg-muted p-2 rounded text-xs">
                        <div>{verificationResult.normalizedAddress.addressLine1}</div>
                        {verificationResult.normalizedAddress.addressLine2 && (
                          <div>{verificationResult.normalizedAddress.addressLine2}</div>
                        )}
                        <div>
                          {verificationResult.normalizedAddress.city}, {verificationResult.normalizedAddress.state} {verificationResult.normalizedAddress.zip}
                        </div>
                      </div>
                    </div>
                  )}
                  {verificationResult.error && (
                    <div className="text-sm text-destructive">
                      {verificationResult.error}
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isLobActive && !postalConfig?.currentProvider?.connection?.success && !isLoadingPostalConfig && (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium mb-2">Lob Not Configured</p>
              <p className="text-sm mb-4">
                To enable postal mail, configure your Lob credentials:
              </p>
              <div className="text-left max-w-md mx-auto bg-muted p-4 rounded-md text-sm font-mono">
                <p>LOB_API_KEY=your_api_key</p>
              </div>
              <p className="text-sm mt-4">
                Add this to your environment secrets, then test the connection.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLobActive && !isLoadingPostalConfig && (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium mb-2">Local Provider Active</p>
              <p className="text-sm">
                The local provider can validate addresses but cannot send postal mail.
                Switch to Lob to enable postal functionality.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
