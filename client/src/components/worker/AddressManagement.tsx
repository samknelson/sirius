import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PostalAddress, InsertPostalAddress } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, MapPin, Star, Eye, Code, CheckCircle, AlertCircle, Copy } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { UnifiedAddressInput } from "@/components/ui/unified-address-input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AddressManagementProps {
  workerId: string;
  contactId: string;
}

interface AddressFormData extends Omit<InsertPostalAddress, 'contactId'> {}

export default function AddressManagement({ workerId, contactId }: AddressManagementProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<PostalAddress | null>(null);
  const [viewingAddress, setViewingAddress] = useState<PostalAddress | null>(null);
  const [jsonViewAddress, setJsonViewAddress] = useState<PostalAddress | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch addresses for this contact
  const { data: addresses = [], isLoading, error } = useQuery<PostalAddress[]>({
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

  const handleEdit = (address: PostalAddress) => {
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
                  <div className="flex items-center space-x-2 flex-wrap gap-2">
                    <CardTitle className="text-base">{address.street}</CardTitle>
                    {address.isPrimary && (
                      <Badge variant="default" className="flex items-center space-x-1">
                        <Star size={12} />
                        <span>Primary</span>
                      </Badge>
                    )}
                    {!address.isActive && (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                    {getAccuracyBadge(address.accuracy)}
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
                    {!address.isPrimary && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetPrimary(address.id)}
                        disabled={setPrimaryMutation.isPending}
                        data-testid={`button-set-primary-${address.id}`}
                      >
                        <Star size={14} />
                      </Button>
                    )}
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
    </div>
  );
}