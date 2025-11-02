import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { PhoneNumber, InsertPhoneNumber } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertPhoneNumberSchema } from "@shared/schema";
import { Phone, Plus, Edit, Trash2, Star } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { z } from "zod";
import { formatPhoneNumberForDisplay, validatePhoneNumber } from "@/lib/phone-utils";

// Form schema that omits contactId since it's provided as a prop and adds client-side validation
const phoneNumberFormSchema = insertPhoneNumberSchema.omit({ contactId: true }).extend({
  phoneNumber: z.string().min(1, "Phone number is required").refine(
    (value) => validatePhoneNumber(value).isValid,
    (value) => ({ message: validatePhoneNumber(value).error || "Invalid phone number" })
  )
});
type PhoneNumberFormData = z.infer<typeof phoneNumberFormSchema>;

interface PhoneNumberManagementProps {
  contactId: string;
}

export function PhoneNumberManagement({ contactId }: PhoneNumberManagementProps) {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingPhoneNumber, setEditingPhoneNumber] = useState<PhoneNumber | null>(null);

  // Fetch phone numbers for this contact
  const { data: phoneNumbers = [], isLoading } = useQuery<PhoneNumber[]>({
    queryKey: ["/api/contacts", contactId, "phone-numbers"],
    enabled: !!contactId,
  });

  const form = useForm<PhoneNumberFormData>({
    resolver: zodResolver(phoneNumberFormSchema),
    defaultValues: {
      friendlyName: "",
      phoneNumber: "",
      isPrimary: false,
      isActive: true,
    },
  });

  // Add phone number mutation
  const addPhoneNumberMutation = useMutation({
    mutationFn: async (data: PhoneNumberFormData) => {
      const payload: InsertPhoneNumber = { ...data, contactId };
      const response = await apiRequest("POST", `/api/contacts/${contactId}/phone-numbers`, payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "phone-numbers"] });
      setIsAddDialogOpen(false);
      form.reset();
      toast({
        title: "Phone number added",
        description: "The phone number has been added successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add phone number",
        variant: "destructive",
      });
    },
  });

  // Update phone number mutation
  const updatePhoneNumberMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PhoneNumberFormData> }) => {
      const response = await apiRequest("PUT", `/api/phone-numbers/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "phone-numbers"] });
      setEditingPhoneNumber(null);
      toast({
        title: "Phone number updated",
        description: "The phone number has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update phone number",
        variant: "destructive",
      });
    },
  });

  // Delete phone number mutation
  const deletePhoneNumberMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/phone-numbers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "phone-numbers"] });
      toast({
        title: "Phone number deleted",
        description: "The phone number has been deleted successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete phone number",
        variant: "destructive",
      });
    },
  });

  // Set primary phone number mutation
  const setPrimaryMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("PUT", `/api/phone-numbers/${id}/set-primary`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "phone-numbers"] });
      toast({
        title: "Primary phone number updated",
        description: "The primary phone number has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to set primary phone number",
        variant: "destructive",
      });
    },
  });

  const handleAdd = (data: PhoneNumberFormData) => {
    addPhoneNumberMutation.mutate(data);
  };

  const handleEdit = (phoneNumber: PhoneNumber) => {
    setEditingPhoneNumber(phoneNumber);
    form.reset({
      friendlyName: phoneNumber.friendlyName || "",
      phoneNumber: phoneNumber.phoneNumber,
      isPrimary: phoneNumber.isPrimary,
      isActive: phoneNumber.isActive,
    });
  };

  const handleUpdate = (data: PhoneNumberFormData) => {
    if (editingPhoneNumber) {
      updatePhoneNumberMutation.mutate({ id: editingPhoneNumber.id, data });
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this phone number?")) {
      deletePhoneNumberMutation.mutate(id);
    }
  };

  const handleSetPrimary = (id: string) => {
    setPrimaryMutation.mutate(id);
  };

  if (isLoading) {
    return <div>Loading phone numbers...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Phone size={20} />
          Phone Numbers
        </h3>
        <Button onClick={() => {
          form.reset();
          setIsAddDialogOpen(true);
        }} data-testid="button-add-phone-number">
          <Plus size={16} className="mr-2" />
          Add Phone Number
        </Button>
      </div>

      {/* Add Phone Number Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Phone Number</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleAdd)} className="space-y-4">
              <FormField
                control={form.control}
                name="friendlyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Friendly Name (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Mobile, Work, Home" data-testid="input-phone-friendly-name" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phoneNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="+1 (555) 123-4567" data-testid="input-phone-number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isPrimary"
                render={({ field }) => (
                  <FormItem className="flex items-center space-x-2">
                    <FormControl>
                      <Checkbox 
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-phone-primary"
                      />
                    </FormControl>
                    <FormLabel className="!mt-0">Set as primary phone number</FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center space-x-2">
                    <FormControl>
                      <Checkbox 
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-phone-active"
                      />
                    </FormControl>
                    <FormLabel className="!mt-0">Active</FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)} data-testid="button-cancel-phone">
                  Cancel
                </Button>
                <Button type="submit" disabled={addPhoneNumberMutation.isPending} data-testid="button-save-phone">
                  {addPhoneNumberMutation.isPending ? "Adding..." : "Add Phone Number"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Phone Number Dialog */}
      <Dialog open={editingPhoneNumber !== null} onOpenChange={() => setEditingPhoneNumber(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Phone Number</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleUpdate)} className="space-y-4">
              <FormField
                control={form.control}
                name="friendlyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Friendly Name (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Mobile, Work, Home" data-testid="input-edit-phone-friendly-name" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phoneNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="+1 (555) 123-4567" data-testid="input-edit-phone-number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isPrimary"
                render={({ field }) => (
                  <FormItem className="flex items-center space-x-2">
                    <FormControl>
                      <Checkbox 
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-edit-phone-primary"
                      />
                    </FormControl>
                    <FormLabel className="!mt-0">Set as primary phone number</FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center space-x-2">
                    <FormControl>
                      <Checkbox 
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-edit-phone-active"
                      />
                    </FormControl>
                    <FormLabel className="!mt-0">Active</FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => setEditingPhoneNumber(null)} data-testid="button-cancel-edit-phone">
                  Cancel
                </Button>
                <Button type="submit" disabled={updatePhoneNumberMutation.isPending} data-testid="button-save-edit-phone">
                  {updatePhoneNumberMutation.isPending ? "Updating..." : "Update Phone Number"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {phoneNumbers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Phone className="text-muted-foreground mb-4" size={48} />
            <h3 className="text-lg font-medium text-foreground mb-2">No phone numbers yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Add the first phone number for this worker
            </p>
            <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-first-phone">
              <Plus size={16} className="mr-2" />
              Add Phone Number
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {phoneNumbers.map((phoneNumber) => (
            <Card key={phoneNumber.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2 flex-wrap gap-2">
                      <CardTitle className="text-base">
                        {phoneNumber.friendlyName || formatPhoneNumberForDisplay(phoneNumber.phoneNumber)}
                      </CardTitle>
                      {phoneNumber.isPrimary && (
                        <Badge variant="default" className="flex items-center space-x-1">
                          <Star size={12} />
                          <span>Primary</span>
                        </Badge>
                      )}
                      {!phoneNumber.isActive && (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </div>
                    {phoneNumber.friendlyName && (
                      <p className="text-sm text-muted-foreground">{formatPhoneNumberForDisplay(phoneNumber.phoneNumber)}</p>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    {!phoneNumber.isPrimary && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetPrimary(phoneNumber.id)}
                        disabled={setPrimaryMutation.isPending}
                        data-testid={`button-set-primary-phone-${phoneNumber.id}`}
                      >
                        <Star size={14} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(phoneNumber)}
                      data-testid={`button-edit-phone-${phoneNumber.id}`}
                    >
                      <Edit size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(phoneNumber.id)}
                      disabled={deletePhoneNumberMutation.isPending}
                      data-testid={`button-delete-phone-${phoneNumber.id}`}
                    >
                      <Trash2 size={14} className="text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
