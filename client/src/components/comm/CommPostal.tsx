import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  Mail, 
  Send, 
  Loader2, 
  AlertCircle,
  Settings,
  CheckCircle,
  XCircle,
  MapPin,
  FileText,
  Code,
  FileCode
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ContentMode = "template" | "compose" | "rawHtml";

const DEFAULT_HTML_WRAPPER = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page {
      size: letter;
      margin: 1in;
    }
    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 12pt;
      line-height: 1.5;
      color: #333;
      margin: 0;
      padding: 0;
    }
    p {
      margin: 0 0 1em 0;
    }
    .date {
      margin-bottom: 2em;
    }
    .greeting {
      margin-bottom: 1em;
    }
    .closing {
      margin-top: 2em;
    }
  </style>
</head>
<body>
{{BODY}}
</body>
</html>`;

function wrapBodyWithHtml(body: string): string {
  return DEFAULT_HTML_WRAPPER.replace("{{BODY}}", body);
}

interface Address {
  id: string;
  contactId: string;
  friendlyName: string | null;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isPrimary: boolean;
  isActive: boolean;
}

interface PostalOptinResponse {
  exists: boolean;
  optin: boolean;
  allowlist: boolean;
  record: {
    id: string;
    canonicalAddress: string;
    optin: boolean;
    optinUser: string | null;
    optinDate: string | null;
    optinIp: string | null;
    allowlist: boolean;
  } | null;
}

interface SystemModeResponse {
  mode: "dev" | "test" | "live";
}

interface VerifyAddressResult {
  valid: boolean;
  deliverable: boolean;
  canonicalAddress?: string;
  normalizedAddress?: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  error?: string;
}

interface CommPostalProps {
  contactId: string;
  addresses: Address[];
  contactName?: string;
  onSendSuccess?: () => void;
}

export function CommPostal({ contactId, addresses, contactName, onSendSuccess }: CommPostalProps) {
  const { toast } = useToast();
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [contentMode, setContentMode] = useState<ContentMode>("template");
  const [composeBody, setComposeBody] = useState("");
  const [rawHtml, setRawHtml] = useState("");
  const [mailType, setMailType] = useState<"usps_first_class" | "usps_standard">("usps_first_class");
  const [isOptinDialogOpen, setIsOptinDialogOpen] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VerifyAddressResult | null>(null);
  
  const selectedAddress = addresses.find(a => a.id === selectedAddressId);

  const { data: systemMode } = useQuery<SystemModeResponse>({
    queryKey: ["/api/system-mode"],
  });

  const verifyAddressMutation = useMutation({
    mutationFn: async (address: Address) => {
      const response = await apiRequest("POST", "/api/postal/verify-address", {
        addressLine1: address.street,
        city: address.city,
        state: address.state,
        zip: address.postalCode,
        country: address.country || "US",
        name: contactName,
      });
      return response as VerifyAddressResult;
    },
    onSuccess: (result) => {
      setVerificationResult(result);
      if (result.valid && result.canonicalAddress) {
        queryClient.invalidateQueries({ queryKey: ["/api/postal-optin", result.canonicalAddress] });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Address Verification Failed",
        description: error.message || "Failed to verify address",
        variant: "destructive",
      });
      setVerificationResult(null);
    },
  });

  const { data: postalOptinData, isLoading: isLoadingOptin, refetch: refetchOptin } = useQuery<PostalOptinResponse>({
    queryKey: ["/api/postal-optin", verificationResult?.canonicalAddress],
    queryFn: async () => {
      if (!verificationResult?.canonicalAddress) return null;
      const response = await fetch(`/api/postal-optin/${encodeURIComponent(verificationResult.canonicalAddress)}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch postal opt-in status");
      }
      return response.json();
    },
    enabled: !!verificationResult?.valid && !!verificationResult?.canonicalAddress,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const updatePostalOptinMutation = useMutation({
    mutationFn: async ({ canonicalAddress, optin, allowlist }: { canonicalAddress: string; optin?: boolean; allowlist?: boolean }) => {
      return await apiRequest("PUT", `/api/postal-optin/${encodeURIComponent(canonicalAddress)}`, { optin, allowlist });
    },
    onSuccess: () => {
      if (verificationResult?.canonicalAddress) {
        queryClient.invalidateQueries({ queryKey: ["/api/postal-optin", verificationResult.canonicalAddress] });
      }
      toast({
        title: "Postal Opt-in Updated",
        description: "The postal opt-in status has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update postal opt-in status",
        variant: "destructive",
      });
    },
  });

  const verifyAndRegisterMutation = useMutation({
    mutationFn: async (address: Address) => {
      const response = await apiRequest("POST", "/api/postal/verify-and-register", {
        addressLine1: address.street,
        city: address.city,
        state: address.state,
        zip: address.postalCode,
        country: address.country || "US",
        name: contactName,
      });
      return response as { verified: boolean; canonicalAddress: string; optin: any };
    },
    onSuccess: (result) => {
      if (result.canonicalAddress) {
        setVerificationResult({ 
          valid: result.verified, 
          deliverable: true, 
          canonicalAddress: result.canonicalAddress 
        });
        queryClient.invalidateQueries({ queryKey: ["/api/postal-optin", result.canonicalAddress] });
      }
      toast({
        title: "Address Verified and Registered",
        description: "The address has been verified and is now ready for opt-in.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Failed",
        description: error.message || "Failed to verify and register address",
        variant: "destructive",
      });
    },
  });

  const sendPostalMutation = useMutation({
    mutationFn: async (data: { 
      toAddress: any; 
      description?: string; 
      templateId?: string;
      file?: string;
      mailType?: string;
    }) => {
      return await apiRequest("POST", `/api/contacts/${contactId}/postal`, data);
    },
    onSuccess: () => {
      toast({
        title: "Postal Mail Sent",
        description: "Your letter has been submitted for mailing.",
      });
      setDescription("");
      setTemplateId("");
      setComposeBody("");
      setRawHtml("");
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "comm"] });
      onSendSuccess?.();
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to send postal mail";
      toast({
        title: "Failed to Send Postal Mail",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleAddressChange = (addressId: string) => {
    setSelectedAddressId(addressId);
    setVerificationResult(null);
    const address = addresses.find(a => a.id === addressId);
    if (address) {
      verifyAddressMutation.mutate(address);
    }
  };

  const handleSend = () => {
    if (!selectedAddress) return;
    
    const toAddress = {
      name: contactName,
      addressLine1: verificationResult?.normalizedAddress?.addressLine1 || selectedAddress.street,
      addressLine2: verificationResult?.normalizedAddress?.addressLine2 || undefined,
      city: verificationResult?.normalizedAddress?.city || selectedAddress.city,
      state: verificationResult?.normalizedAddress?.state || selectedAddress.state,
      zip: verificationResult?.normalizedAddress?.zip || selectedAddress.postalCode,
      country: verificationResult?.normalizedAddress?.country || selectedAddress.country || "US",
    };

    const payload: {
      toAddress: typeof toAddress;
      description?: string;
      templateId?: string;
      file?: string;
      mailType: string;
    } = {
      toAddress,
      description: description.trim() || undefined,
      mailType,
    };

    if (contentMode === "template") {
      if (!templateId.trim()) return;
      payload.templateId = templateId.trim();
    } else if (contentMode === "compose") {
      if (!composeBody.trim()) return;
      payload.file = wrapBodyWithHtml(composeBody.trim());
    } else if (contentMode === "rawHtml") {
      if (!rawHtml.trim()) return;
      payload.file = rawHtml.trim();
    }

    sendPostalMutation.mutate(payload);
  };

  const hasContent = 
    (contentMode === "template" && templateId.trim().length > 0) ||
    (contentMode === "compose" && composeBody.trim().length > 0) ||
    (contentMode === "rawHtml" && rawHtml.trim().length > 0);

  const canSend = 
    selectedAddress && 
    hasContent &&
    verificationResult?.valid &&
    !isLoadingOptin &&
    postalOptinData?.optin === true &&
    (systemMode?.mode === "live" || postalOptinData?.allowlist === true);

  const getValidationMessage = () => {
    if (!selectedAddress) {
      return null;
    }

    if (verifyAddressMutation.isPending) {
      return null;
    }

    if (verificationResult && !verificationResult.valid) {
      return {
        type: "error" as const,
        title: "Invalid Address",
        message: verificationResult.error || "The address could not be verified. Please check the address details.",
      };
    }

    if (isLoadingOptin) {
      return null;
    }

    if (!postalOptinData?.exists) {
      return {
        type: "warning" as const,
        title: "Address Not Registered",
        message: "This address is not registered for postal mail. Click 'Opt-in Settings' to verify and register it.",
      };
    }

    if (!postalOptinData?.optin) {
      return {
        type: "error" as const,
        title: "Not Opted In",
        message: "This address has not opted in to receive postal mail. Click 'Opt-in Settings' to enable.",
      };
    }

    if (systemMode?.mode !== "live" && !postalOptinData?.allowlist) {
      return {
        type: "warning" as const,
        title: "Not Allowlisted",
        message: `System mode is "${systemMode?.mode}". Only allowlisted addresses can receive mail in non-live modes.`,
      };
    }

    return {
      type: "success" as const,
      title: "Ready to Send",
      message: "This address is verified and can receive postal mail.",
    };
  };

  const validationMessage = getValidationMessage();
  const activeAddresses = addresses.filter(a => a.isActive);

  const formatAddress = (addr: Address) => {
    const parts = [addr.street];
    parts.push(`${addr.city}, ${addr.state} ${addr.postalCode}`);
    return parts.join(", ");
  };

  const optinModal = selectedAddress && verificationResult?.canonicalAddress && (
    <Dialog open={isOptinDialogOpen} onOpenChange={setIsOptinDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Postal Opt-in Settings
          </DialogTitle>
          <DialogDescription>
            Manage opt-in and allowlist settings for this address.
          </DialogDescription>
        </DialogHeader>
        
        {isLoadingOptin ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2 text-muted-foreground">Loading opt-in status...</span>
          </div>
        ) : !postalOptinData?.exists ? (
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Address Not Registered</AlertTitle>
              <AlertDescription>
                This address needs to be verified and registered before it can receive postal mail.
              </AlertDescription>
            </Alert>
            <Button 
              onClick={() => {
                if (selectedAddress) {
                  verifyAndRegisterMutation.mutate(selectedAddress);
                }
              }}
              disabled={verifyAndRegisterMutation.isPending}
              className="w-full"
              data-testid="button-register-address"
            >
              {verifyAndRegisterMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Registering...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Verify and Register Address
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Canonical Address</Label>
              <p className="font-medium text-sm">{verificationResult.canonicalAddress}</p>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="postal-optin" className="text-base font-medium">Opted In</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow sending mail to this address
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {postalOptinData?.optin ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Switch
                    id="postal-optin"
                    checked={postalOptinData?.optin ?? false}
                    onCheckedChange={(checked) => {
                      if (verificationResult?.canonicalAddress) {
                        updatePostalOptinMutation.mutate({ 
                          canonicalAddress: verificationResult.canonicalAddress, 
                          optin: checked 
                        });
                      }
                    }}
                    disabled={updatePostalOptinMutation.isPending}
                    data-testid="switch-postal-optin"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="postal-allowlist" className="text-base font-medium">Allowlisted</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow sending in dev/test modes
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {postalOptinData?.allowlist ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Switch
                    id="postal-allowlist"
                    checked={postalOptinData?.allowlist ?? false}
                    onCheckedChange={(checked) => {
                      if (verificationResult?.canonicalAddress) {
                        updatePostalOptinMutation.mutate({ 
                          canonicalAddress: verificationResult.canonicalAddress, 
                          allowlist: checked 
                        });
                      }
                    }}
                    disabled={updatePostalOptinMutation.isPending}
                    data-testid="switch-postal-allowlist"
                  />
                </div>
              </div>
            </div>

            {postalOptinData?.record?.optinDate && (
              <>
                <Separator />
                <div className="text-sm text-muted-foreground">
                  <p>Opted in on: {new Date(postalOptinData.record.optinDate).toLocaleString()}</p>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      {optinModal}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Send Postal Mail
            </CardTitle>
            <CardDescription>
              Send a letter via postal mail to this contact
            </CardDescription>
          </div>
          {selectedAddress && verificationResult?.valid && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsOptinDialogOpen(true)}
              data-testid="button-postal-optin-settings"
            >
              <Settings className="h-4 w-4 mr-2" />
              Opt-in Settings
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {activeAddresses.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>No Addresses</AlertTitle>
              <AlertDescription>
                This contact does not have any active addresses. Add an address first.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="address-select">Mailing Address</Label>
                <Select 
                  value={selectedAddressId} 
                  onValueChange={handleAddressChange}
                >
                  <SelectTrigger id="address-select" data-testid="select-postal-address">
                    <SelectValue placeholder="Select an address" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeAddresses.map(addr => (
                      <SelectItem key={addr.id} value={addr.id}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="truncate max-w-[300px]">{formatAddress(addr)}</span>
                          {addr.friendlyName && (
                            <span className="text-muted-foreground">
                              ({addr.friendlyName})
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedAddress && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Label className="text-sm text-muted-foreground">Status:</Label>
                    {verifyAddressMutation.isPending ? (
                      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Verifying address...
                      </span>
                    ) : verificationResult?.valid ? (
                      <>
                        <span className="inline-flex items-center gap-1 text-sm text-green-600">
                          <CheckCircle className="h-3 w-3" />
                          Address Verified
                        </span>
                        {isLoadingOptin ? (
                          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Checking opt-in...
                          </span>
                        ) : postalOptinData?.optin ? (
                          <span className="inline-flex items-center gap-1 text-sm text-green-600">
                            <CheckCircle className="h-3 w-3" />
                            Opted In
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sm text-destructive">
                            <XCircle className="h-3 w-3" />
                            Not Opted In
                          </span>
                        )}
                        {systemMode?.mode !== "live" && postalOptinData?.exists && (
                          postalOptinData?.allowlist ? (
                            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                              Allowlisted
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-sm text-amber-600">
                              Not Allowlisted
                            </span>
                          )
                        )}
                        {systemMode?.mode !== "live" && (
                          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                            Mode: {systemMode?.mode}
                          </span>
                        )}
                      </>
                    ) : verificationResult ? (
                      <span className="inline-flex items-center gap-1 text-sm text-destructive">
                        <XCircle className="h-3 w-3" />
                        Invalid Address
                      </span>
                    ) : null}
                  </div>
                </div>
              )}

              {validationMessage && (
                <Alert variant={validationMessage.type === "error" ? "destructive" : "default"}>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{validationMessage.title}</AlertTitle>
                  <AlertDescription>{validationMessage.message}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Letter Content</Label>
                  <RadioGroup
                    value={contentMode}
                    onValueChange={(v) => setContentMode(v as ContentMode)}
                    className="flex flex-wrap gap-4"
                    disabled={!selectedAddress}
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="template" id="mode-template" data-testid="radio-mode-template" />
                      <Label htmlFor="mode-template" className="flex items-center gap-1 cursor-pointer font-normal">
                        <FileText className="h-4 w-4" />
                        Template ID
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="compose" id="mode-compose" data-testid="radio-mode-compose" />
                      <Label htmlFor="mode-compose" className="flex items-center gap-1 cursor-pointer font-normal">
                        <FileCode className="h-4 w-4" />
                        Compose
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="rawHtml" id="mode-raw" data-testid="radio-mode-raw" />
                      <Label htmlFor="mode-raw" className="flex items-center gap-1 cursor-pointer font-normal">
                        <Code className="h-4 w-4" />
                        Raw HTML
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                {contentMode === "template" && (
                  <div className="space-y-2">
                    <Label htmlFor="template-id">Template ID</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <FileText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="template-id"
                          type="text"
                          placeholder="tmpl_xxxxx (Lob template ID)"
                          value={templateId}
                          onChange={(e) => setTemplateId(e.target.value)}
                          className="pl-10"
                          disabled={!selectedAddress}
                          data-testid="input-postal-template"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enter a Lob template ID for the letter content
                    </p>
                  </div>
                )}

                {contentMode === "compose" && (
                  <div className="space-y-2">
                    <Label htmlFor="compose-body">Letter Body</Label>
                    <Textarea
                      id="compose-body"
                      placeholder="Enter the body of your letter here. You can use HTML tags like <p>, <strong>, <em>, etc."
                      value={composeBody}
                      onChange={(e) => setComposeBody(e.target.value)}
                      rows={10}
                      disabled={!selectedAddress}
                      className="font-mono text-sm"
                      data-testid="textarea-compose-body"
                    />
                    <p className="text-xs text-muted-foreground">
                      Your content will be wrapped in a default HTML template with 1-inch margins and standard letter formatting.
                    </p>
                  </div>
                )}

                {contentMode === "rawHtml" && (
                  <div className="space-y-2">
                    <Label htmlFor="raw-html">Full HTML</Label>
                    <Textarea
                      id="raw-html"
                      placeholder="<!DOCTYPE html>\n<html>\n<head>\n  <style>\n    @page { margin: 1in; }\n    body { font-family: Arial; }\n  </style>\n</head>\n<body>\n  Your letter content here...\n</body>\n</html>"
                      value={rawHtml}
                      onChange={(e) => setRawHtml(e.target.value)}
                      rows={12}
                      disabled={!selectedAddress}
                      className="font-mono text-sm"
                      data-testid="textarea-raw-html"
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter complete HTML for the letter. Use @page CSS rules to control margins and page layout.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="mail-type">Mail Type</Label>
                <Select 
                  value={mailType} 
                  onValueChange={(v) => setMailType(v as "usps_first_class" | "usps_standard")}
                  disabled={!selectedAddress}
                >
                  <SelectTrigger id="mail-type" data-testid="select-mail-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="usps_first_class">USPS First Class</SelectItem>
                    <SelectItem value="usps_standard">USPS Standard</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (Optional)</Label>
                <Textarea
                  id="description"
                  placeholder="Internal description for this mailing..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  disabled={!selectedAddress}
                  data-testid="input-postal-description"
                />
              </div>
            </>
          )}
        </CardContent>
        {activeAddresses.length > 0 && (
          <CardFooter className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setSelectedAddressId("");
                setDescription("");
                setTemplateId("");
                setComposeBody("");
                setRawHtml("");
                setVerificationResult(null);
              }}
              disabled={sendPostalMutation.isPending}
              data-testid="button-clear-postal"
            >
              Clear
            </Button>
            <Button
              onClick={handleSend}
              disabled={!canSend || sendPostalMutation.isPending}
              data-testid="button-send-postal"
            >
              {sendPostalMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Postal Mail
                </>
              )}
            </Button>
          </CardFooter>
        )}
      </Card>
    </>
  );
}
