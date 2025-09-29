import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PostalAddress, InsertPostalAddress } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, MapPin, Star } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { UnifiedAddressInput } from "@/components/ui/unified-address-input";

interface AddressManagementProps {
  workerId: string;
  contactId: string;
}

interface AddressFormData extends Omit<InsertPostalAddress, 'contactId'> {}

export default function AddressManagement({ workerId, contactId }: AddressManagementProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<PostalAddress | null>(null);
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
                  <div className="flex items-center space-x-2">
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
                  </div>
                  <div className="flex items-center space-x-2">
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
    </div>
  );
}