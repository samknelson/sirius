import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ContactPostal, InsertContactPostal } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, MapPin, Star, Eye, Code, CheckCircle, AlertCircle, Copy, XCircle, Loader2, Mail } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { UnifiedAddressInput } from "@/components/ui/unified-address-input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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

interface AddressManagementProps {
  workerId: string;
  contactId: string;
}

interface AddressFormData extends Omit<InsertContactPostal, 'contactId'> {}

export default function AddressManagement({ workerId, contactId }: AddressManagementProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<ContactPostal | null>(null);
  const [viewingAddress, setViewingAddress] = useState<ContactPostal | null>(null);
  const [jsonViewAddress, setJsonViewAddress] = useState<ContactPostal | null>(null);
  const [postalOptinAddress, setPostalOptinAddress] = useState<ContactPostal | null>(null);
  const [verificationResult, setVerificationResult] = useState<VerifyAddressResult | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch addresses for this contact
  const { data: addresses = [], isLoading, error } = useQuery<ContactPostal[]>({
    queryKey: ["/api/contacts", contactId, "addresses"],
    queryFn: async () => {
      const response = await fetch(`/api/contacts/${contactId}/addresses`);
      if (!response.ok) {
        throw new Error("Failed to fetch addresses");
      }
      return response.json();
    },
  });

  // Add address mutation
  const addAddressMutation = useMutation({
    mutationFn: async (data: AddressFormData) => {
      return apiRequest("POST", `/api/contacts/${contactId}/addresses`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "addresses"] });
      setIsAddDialogOpen(false);
      toast({
        title: "Success",
        description: "Address added successfully",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to add address";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Update address mutation
  const updateAddressMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<AddressFormData> }) => {
      return apiRequest("PUT", `/api/addresses/${data.id}`, data.updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "addresses"] });
      setEditingAddress(null);
      toast({
        title: "Success",
        description: "Address updated successfully",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to update address";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Delete address mutation
  const deleteAddressMutation = useMutation({
    mutationFn: async (addressId: string) => {
      return apiRequest("DELETE", `/api/addresses/${addressId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "addresses"] });
      toast({
        title: "Success",
        description: "Address deleted successfully",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to delete address";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Set primary address mutation
  const setPrimaryMutation = useMutation({
    mutationFn: async (addressId: string) => {
      return apiRequest("PUT", `/api/addresses/${addressId}/set-primary`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "addresses"] });
      toast({
        title: "Success",
        description: "Primary address updated successfully",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to set primary address";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Verify address mutation for postal opt-in
  const verifyAddressMutation = useMutation({
    mutationFn: async (address: ContactPostal) => {
      const response = await apiRequest("POST", "/api/postal/verify-address", {
        addressLine1: address.street,
        city: address.city,
        state: address.state,
        zip: address.postalCode,
        country: address.country || "US",
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

  // Fetch postal opt-in status for verified address
  const { data: postalOptinData, isLoading: isLoadingOptin } = useQuery<PostalOptinResponse>({
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
    enabled: !!postalOptinAddress && !!verificationResult?.valid && !!verificationResult?.canonicalAddress,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  // Update postal opt-in mutation
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

  // Verify and register address mutation
  const verifyAndRegisterMutation = useMutation({
    mutationFn: async (address: ContactPostal) => {
      const response = await apiRequest("POST", "/api/postal/verify-and-register", {
        addressLine1: address.street,
        city: address.city,
        state: address.state,
        zip: address.postalCode,
        country: address.country || "US",
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

  // Handle opening postal opt-in dialog
  const handleOpenPostalOptin = (address: ContactPostal) => {
    setPostalOptinAddress(address);
    setVerificationResult(null);
    verifyAddressMutation.mutate(address);
  };

  // Handle closing postal opt-in dialog
  const handleClosePostalOptin = () => {
    setPostalOptinAddress(null);
    setVerificationResult(null);
  };

  const handleAddSubmit = (data: AddressFormData) => {
    addAddressMutation.mutate(data);
  };

  const handleEditSubmit = (data: AddressFormData) => {
    if (editingAddress) {
      updateAddressMutation.mutate({
        id: editingAddress.id,
        updates: data,
      });
    }
  };

  const handleEdit = (address: ContactPostal) => {
    setEditingAddress(address);
  };

  const handleDelete = (addressId: string) => {
    if (confirm("Are you sure you want to delete this address?")) {
      deleteAddressMutation.mutate(addressId);
    }
  };

  const handleSetPrimary = (addressId: string) => {
    setPrimaryMutation.mutate(addressId);
  };

  const getAccuracyBadge = (accuracy?: string | null) => {
    if (!accuracy) {
      return null;
    }

    const accuracyMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
      ROOFTOP: { label: "Rooftop", variant: "default", icon: CheckCircle },
      RANGE_INTERPOLATED: { label: "Range Interpolated", variant: "secondary", icon: MapPin },
      GEOMETRIC_CENTER: { label: "Geometric Center", variant: "outline", icon: MapPin },
      APPROXIMATE: { label: "Approximate", variant: "destructive", icon: AlertCircle },
    };

    const config = accuracyMap[accuracy] || { label: accuracy, variant: "outline" as const, icon: MapPin };
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon size={12} />
        <span>{config.label}</span>
      </Badge>
    );
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: `${label} copied to clipboard`,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-destructive">Failed to load addresses</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-foreground">Postal Addresses</h3>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-address">
              <Plus size={16} className="mr-2" />
              Add Address
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add New Address</DialogTitle>
            </DialogHeader>
            <UnifiedAddressInput
              defaultValues={{
                street: "",
                city: "",
                state: "",
                postalCode: "",
                country: "United States",
                isPrimary: false,
                isActive: true,
              }}
              onSubmit={handleAddSubmit}
              onCancel={() => setIsAddDialogOpen(false)}
              isSubmitting={addAddressMutation.isPending}
              submitLabel="Add Address"
            />
          </DialogContent>
        </Dialog>
      </div>

      {addresses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MapPin className="text-muted-foreground mb-4" size={48} />
            <h3 className="text-lg font-medium text-foreground mb-2">No addresses yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Add the first postal address for this worker
            </p>
            <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-first-address">
              <Plus size={16} className="mr-2" />
              Add Address
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {addresses.map((address) => (
            <Card key={address.id} className="relative">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2 flex-wrap gap-2">
                      <CardTitle className="text-base">
                        {address.friendlyName || address.street}
                      </CardTitle>
                      {!address.isActive && (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                      {getAccuracyBadge(address.accuracy)}
                    </div>
                    {address.friendlyName && (
                      <p className="text-sm text-muted-foreground">{address.street}</p>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewingAddress(address)}
                      data-testid={`button-view-address-${address.id}`}
                    >
                      <Eye size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenPostalOptin(address)}
                      data-testid={`button-postal-optin-${address.id}`}
                      title="Postal Opt-in Settings"
                    >
                      <Mail size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSetPrimary(address.id)}
                      disabled={setPrimaryMutation.isPending}
                      data-testid={`button-set-primary-${address.id}`}
                      className={address.isPrimary ? "text-yellow-500 hover:text-yellow-600" : ""}
                    >
                      <Star size={16} fill={address.isPrimary ? "currentColor" : "none"} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(address)}
                      data-testid={`button-edit-address-${address.id}`}
                    >
                      <Edit size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(address.id)}
                      disabled={deleteAddressMutation.isPending}
                      data-testid={`button-delete-address-${address.id}`}
                    >
                      <Trash2 size={14} className="text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  {address.city}, {address.state} {address.postalCode}
                </p>
                <p className="text-muted-foreground text-sm">{address.country}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Address Dialog */}
      <Dialog open={editingAddress !== null} onOpenChange={() => setEditingAddress(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Address</DialogTitle>
          </DialogHeader>
          {editingAddress && (
            <UnifiedAddressInput
              defaultValues={{
                friendlyName: editingAddress.friendlyName || undefined,
                street: editingAddress.street,
                city: editingAddress.city,
                state: editingAddress.state,
                postalCode: editingAddress.postalCode,
                country: editingAddress.country,
                isPrimary: editingAddress.isPrimary,
                isActive: editingAddress.isActive,
              }}
              onSubmit={handleEditSubmit}
              onCancel={() => setEditingAddress(null)}
              isSubmitting={updateAddressMutation.isPending}
              submitLabel="Update Address"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* View Address Details Dialog */}
      <Dialog open={viewingAddress !== null} onOpenChange={() => setViewingAddress(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Address Coordinates</DialogTitle>
          </DialogHeader>
          {viewingAddress && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left Column: Address Context */}
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">Address</h4>
                    <p className="font-medium">{viewingAddress.street}</p>
                    <p className="text-muted-foreground">
                      {viewingAddress.city}, {viewingAddress.state} {viewingAddress.postalCode}
                    </p>
                    <p className="text-muted-foreground text-sm">{viewingAddress.country}</p>
                  </div>
                  {viewingAddress.accuracy && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">Accuracy</h4>
                      {getAccuracyBadge(viewingAddress.accuracy)}
                    </div>
                  )}
                </div>

                {/* Right Column: Coordinate Data */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Coordinates</h4>
                  
                  {viewingAddress.latitude != null && viewingAddress.longitude != null ? (
                    <div className="space-y-3 divide-y">
                      <div className="flex justify-between items-center py-2">
                        <span className="text-sm text-muted-foreground font-medium">Latitude</span>
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-base">{viewingAddress.latitude.toFixed(7)}</code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(viewingAddress.latitude!.toString(), "Latitude")}
                            data-testid="button-copy-latitude"
                          >
                            <Copy size={14} />
                          </Button>
                        </div>
                      </div>
                      
                      <div className="flex justify-between items-center py-2">
                        <span className="text-sm text-muted-foreground font-medium">Longitude</span>
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-base">{viewingAddress.longitude!.toFixed(7)}</code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(viewingAddress.longitude!.toString(), "Longitude")}
                            data-testid="button-copy-longitude"
                          >
                            <Copy size={14} />
                          </Button>
                        </div>
                      </div>
                      
                      <div className="flex justify-between items-center py-2">
                        <span className="text-sm text-muted-foreground font-medium">Accuracy Type</span>
                        <code className="font-mono text-sm">{viewingAddress.accuracy}</code>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No coordinate data available</p>
                  )}
                </div>
              </div>

              {/* Footer Actions */}
              <div className="flex justify-between items-center pt-4 border-t">
                {viewingAddress.validationResponse ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setJsonViewAddress(viewingAddress);
                      setViewingAddress(null);
                    }}
                    data-testid="button-view-json"
                  >
                    <Code size={16} className="mr-2" />
                    View Full API Response
                  </Button>
                ) : (
                  <div />
                )}
                <Button onClick={() => setViewingAddress(null)} data-testid="button-close-view">
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* JSON Viewer Dialog */}
      <Dialog open={jsonViewAddress !== null} onOpenChange={() => setJsonViewAddress(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Geocoding API Response</DialogTitle>
          </DialogHeader>
          {jsonViewAddress && (
            <div className="space-y-4">
              {jsonViewAddress.validationResponse ? (
                <>
                  <div className="flex justify-between items-center">
                    <p className="text-sm text-muted-foreground">Full response from Google Geocoding API</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(JSON.stringify(jsonViewAddress.validationResponse, null, 2), "JSON response")}
                      data-testid="button-copy-json"
                    >
                      <Copy size={14} className="mr-2" />
                      Copy All
                    </Button>
                  </div>
                  
                  <ScrollArea className="h-[500px] w-full rounded-md border p-4 bg-muted/50">
                    <pre className="text-xs font-mono">
                      {JSON.stringify(jsonViewAddress.validationResponse, null, 2)}
                    </pre>
                  </ScrollArea>
                </>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">No API response data available</p>
              )}
              
              <div className="flex justify-end pt-4 border-t">
                <Button onClick={() => setJsonViewAddress(null)} data-testid="button-close-json">
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Postal Opt-in Dialog */}
      <Dialog open={postalOptinAddress !== null} onOpenChange={handleClosePostalOptin}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Postal Opt-in Settings
            </DialogTitle>
            <DialogDescription>
              Manage opt-in and allowlist settings for this address.
            </DialogDescription>
          </DialogHeader>
          
          {postalOptinAddress && (
            <div className="space-y-4">
              {/* Address display */}
              <div className="space-y-1">
                <Label className="text-muted-foreground">Address</Label>
                <p className="font-medium">{postalOptinAddress.street}</p>
                <p className="text-sm text-muted-foreground">
                  {postalOptinAddress.city}, {postalOptinAddress.state} {postalOptinAddress.postalCode}
                </p>
              </div>

              <Separator />

              {/* Verification status */}
              {verifyAddressMutation.isPending ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="ml-2 text-muted-foreground">Verifying address...</span>
                </div>
              ) : verificationResult && !verificationResult.valid ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Address Verification Failed</AlertTitle>
                  <AlertDescription>
                    {verificationResult.error || "The address could not be verified. Please check the address details."}
                  </AlertDescription>
                </Alert>
              ) : verificationResult?.valid && verificationResult?.canonicalAddress ? (
                <>
                  {/* Canonical address */}
                  <div className="space-y-1">
                    <Label className="text-muted-foreground">Canonical Address</Label>
                    <p className="font-medium text-sm break-all">{verificationResult.canonicalAddress}</p>
                  </div>

                  <Separator />

                  {/* Opt-in status loading */}
                  {isLoadingOptin ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="ml-2 text-sm text-muted-foreground">Loading opt-in status...</span>
                    </div>
                  ) : !postalOptinData?.exists ? (
                    /* Address not registered */
                    <div className="space-y-4">
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Address Not Registered</AlertTitle>
                        <AlertDescription>
                          This address needs to be registered before it can receive postal mail.
                        </AlertDescription>
                      </Alert>
                      <Button 
                        onClick={() => {
                          if (postalOptinAddress) {
                            verifyAndRegisterMutation.mutate(postalOptinAddress);
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
                            Register Address
                          </>
                        )}
                      </Button>
                    </div>
                  ) : (
                    /* Opt-in controls */
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
                </>
              ) : null}

              <div className="flex justify-end pt-4">
                <Button onClick={handleClosePostalOptin} data-testid="button-close-postal-optin">
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}