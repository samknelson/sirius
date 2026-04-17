import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { PhoneNumber, InsertPhoneNumber } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertPhoneNumberSchema } from "@shared/schema";
import { Phone, Plus, Edit, Trash2, Star, Copy, FileJson, Eye, MessageSquare, User, Globe, Calendar, Link, ExternalLink, RefreshCw, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { z } from "zod";
import { formatPhoneNumberForDisplay, validatePhoneNumber } from "@/lib/phone-utils";
import { format } from "date-fns";
import { QRCodeSVG } from "qrcode.react";

interface SmsOptinResponse {
  exists: boolean;
  optin: {
    id: string;
    phoneNumber: string;
    optin: boolean;
    optinUser: string | null;
    optinDate: string | null;
    optinIp: string | null;
    allowlist: boolean;
    smsPossible: boolean | null;
    voicePossible: boolean | null;
    validatedAt: string | null;
    validationResponse: Record<string, unknown> | null;
    optinUserDetails: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
    } | null;
  } | null;
}

interface RevalidateResponse {
  phoneNumber: PhoneNumber;
  validation: {
    smsPossible?: boolean;
    voicePossible?: boolean;
    validatedAt: string;
    type?: string;
    carrier?: string;
  };
  optinRecord: SmsOptinResponse['optin'];
}

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
  canEdit?: boolean;
}

export function PhoneNumberManagement({ contactId, canEdit = true }: PhoneNumberManagementProps) {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingPhoneNumber, setEditingPhoneNumber] = useState<PhoneNumber | null>(null);
  const [viewingPhoneNumber, setViewingPhoneNumber] = useState<PhoneNumber | null>(null);
  const [jsonViewPhoneNumber, setJsonViewPhoneNumber] = useState<PhoneNumber | null>(null);
  const [smsOptinPhoneNumber, setSmsOptinPhoneNumber] = useState<PhoneNumber | null>(null);

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
      return await apiRequest("POST", `/api/contacts/${contactId}/phone-numbers`, payload);
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
      return await apiRequest("PUT", `/api/phone-numbers/${id}`, data);
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
      return await apiRequest("PUT", `/api/phone-numbers/${id}/set-primary`, {});
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

  // Fetch SMS opt-in status for selected phone number (no caching for real-time updates)
  const { data: smsOptinData, isLoading: isLoadingOptin } = useQuery<SmsOptinResponse>({
    queryKey: ["/api/sms-optin", smsOptinPhoneNumber?.phoneNumber],
    queryFn: async () => {
      if (!smsOptinPhoneNumber) return null;
      const response = await fetch(`/api/sms-optin/${encodeURIComponent(smsOptinPhoneNumber.phoneNumber)}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch SMS opt-in status`);
      }
      return response.json();
    },
    enabled: !!smsOptinPhoneNumber,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  // Fetch public token for selected phone number
  const { data: publicTokenData, isLoading: isLoadingToken } = useQuery<{ token: string }>({
    queryKey: ["/api/sms-optin", smsOptinPhoneNumber?.phoneNumber, "public-token"],
    queryFn: async () => {
      if (!smsOptinPhoneNumber) return null;
      const response = await fetch(`/api/sms-optin/${encodeURIComponent(smsOptinPhoneNumber.phoneNumber)}/public-token`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch public token`);
      }
      return response.json();
    },
    enabled: !!smsOptinPhoneNumber,
    staleTime: 0,
  });

  // Construct the public opt-in URL
  const publicOptinUrl = publicTokenData?.token 
    ? `${window.location.origin}/sms/optin/${publicTokenData.token}`
    : null;

  // Update SMS opt-in mutation
  const updateSmsOptinMutation = useMutation({
    mutationFn: async ({ phoneNumber, optin, allowlist }: { phoneNumber: string; optin?: boolean; allowlist?: boolean }) => {
      return await apiRequest("PUT", `/api/sms-optin/${encodeURIComponent(phoneNumber)}`, { optin, allowlist });
    },
    onSuccess: () => {
      if (smsOptinPhoneNumber) {
        queryClient.invalidateQueries({ queryKey: ["/api/sms-optin", smsOptinPhoneNumber.phoneNumber] });
      }
      toast({
        title: "SMS Opt-in Updated",
        description: "The SMS opt-in status has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update SMS opt-in status",
        variant: "destructive",
      });
    },
  });

  // Re-validate phone number mutation
  const revalidateMutation = useMutation<RevalidateResponse, Error, string>({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/phone-numbers/${id}/revalidate`, {});
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "phone-numbers"] });
      if (viewingPhoneNumber) {
        setViewingPhoneNumber(data.phoneNumber);
      }
      toast({
        title: "Phone Number Re-validated",
        description: data.validation.smsPossible !== undefined 
          ? `SMS ${data.validation.smsPossible ? 'is' : 'is not'} possible, Voice ${data.validation.voicePossible ? 'is' : 'is not'} possible`
          : "Phone number validation has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Re-validation Failed",
        description: error.message || "Failed to re-validate phone number",
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
      phoneNumber: formatPhoneNumberForDisplay(phoneNumber.phoneNumber),
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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: `${label} has been copied to clipboard.`,
    });
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
        {canEdit && (
          <Button onClick={() => {
            form.reset();
            setIsAddDialogOpen(true);
          }} data-testid="button-add-phone-number">
            <Plus size={16} className="mr-2" />
            Add Phone Number
          </Button>
        )}
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

      {/* View Phone Details Dialog */}
      <Dialog open={viewingPhoneNumber !== null} onOpenChange={() => setViewingPhoneNumber(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Phone Number Details</DialogTitle>
          </DialogHeader>
          {viewingPhoneNumber && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left Column: Phone Number Context */}
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">Phone Number</h4>
                    <p className="font-medium text-lg">{formatPhoneNumberForDisplay(viewingPhoneNumber.phoneNumber)}</p>
                    {viewingPhoneNumber.friendlyName && (
                      <p className="text-muted-foreground text-sm">{viewingPhoneNumber.friendlyName}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {viewingPhoneNumber.isPrimary && (
                      <Badge variant="default">Primary</Badge>
                    )}
                    <Badge variant={viewingPhoneNumber.isActive ? "default" : "secondary"}>
                      {viewingPhoneNumber.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>

                {/* Right Column: Validation Data */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Validation Info</h4>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => revalidateMutation.mutate(viewingPhoneNumber.id)}
                      disabled={revalidateMutation.isPending}
                      data-testid="button-revalidate-phone"
                    >
                      <RefreshCw size={14} className={revalidateMutation.isPending ? "animate-spin mr-2" : "mr-2"} />
                      {revalidateMutation.isPending ? "Validating..." : "Re-validate"}
                    </Button>
                  </div>
                  
                  {viewingPhoneNumber.validationResponse ? (
                    <div className="space-y-3 divide-y">
                      <div className="flex justify-between items-center py-2">
                        <span className="text-sm text-muted-foreground font-medium">E.164 Format</span>
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-sm">{viewingPhoneNumber.phoneNumber}</code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(viewingPhoneNumber.phoneNumber, "Phone number")}
                            data-testid="button-copy-phone"
                          >
                            <Copy size={14} />
                          </Button>
                        </div>
                      </div>
                      
                      {(viewingPhoneNumber.validationResponse as any)?.country && (
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-muted-foreground font-medium">Country</span>
                          <code className="font-mono text-sm">{(viewingPhoneNumber.validationResponse as any).country}</code>
                        </div>
                      )}
                      
                      {(viewingPhoneNumber.validationResponse as any)?.type && (
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-muted-foreground font-medium">Type</span>
                          <code className="font-mono text-sm">{(viewingPhoneNumber.validationResponse as any).type}</code>
                        </div>
                      )}

                      {/* SMS and Voice Capabilities */}
                      {((viewingPhoneNumber.validationResponse as any)?.smsPossible !== undefined || 
                        (viewingPhoneNumber.validationResponse as any)?.voicePossible !== undefined) && (
                        <div className="py-2 space-y-2">
                          <span className="text-sm text-muted-foreground font-medium">Capabilities</span>
                          <div className="flex gap-3 flex-wrap">
                            {(viewingPhoneNumber.validationResponse as any)?.smsPossible !== undefined && (
                              <div className="flex items-center gap-1.5">
                                {(viewingPhoneNumber.validationResponse as any).smsPossible ? (
                                  <CheckCircle size={14} className="text-green-600" />
                                ) : (
                                  <XCircle size={14} className="text-red-600" />
                                )}
                                <span className="text-sm">SMS</span>
                              </div>
                            )}
                            {(viewingPhoneNumber.validationResponse as any)?.voicePossible !== undefined && (
                              <div className="flex items-center gap-1.5">
                                {(viewingPhoneNumber.validationResponse as any).voicePossible ? (
                                  <CheckCircle size={14} className="text-green-600" />
                                ) : (
                                  <XCircle size={14} className="text-red-600" />
                                )}
                                <span className="text-sm">Voice</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Carrier Info */}
                      {(viewingPhoneNumber.validationResponse as any)?.twilioData?.carrier && (
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-muted-foreground font-medium">Carrier</span>
                          <code className="font-mono text-sm">{(viewingPhoneNumber.validationResponse as any).twilioData.carrier}</code>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No validation data available</p>
                  )}
                </div>
              </div>

              {/* Footer Actions */}
              <div className="flex justify-between items-center gap-2 pt-4 border-t flex-wrap">
                <div className="flex gap-2 flex-wrap">
                  {viewingPhoneNumber.validationResponse && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setJsonViewPhoneNumber(viewingPhoneNumber);
                        setViewingPhoneNumber(null);
                      }}
                      data-testid="button-view-json"
                    >
                      <FileJson size={16} className="mr-2" />
                      View Full API Response
                    </Button>
                  )}
                </div>
                <Button onClick={() => setViewingPhoneNumber(null)} data-testid="button-close-view">
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* View JSON Response Dialog */}
      <Dialog open={jsonViewPhoneNumber !== null} onOpenChange={() => setJsonViewPhoneNumber(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Validation API Response</DialogTitle>
          </DialogHeader>
          {jsonViewPhoneNumber && (
            <div className="space-y-4">
              {jsonViewPhoneNumber.validationResponse ? (
                <>
                  <div className="flex justify-between items-center">
                    <p className="text-sm text-muted-foreground">
                      Full response from {(jsonViewPhoneNumber.validationResponse as any)?.twilioData ? 'Twilio Lookup API' : 'local validation'}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(JSON.stringify(jsonViewPhoneNumber.validationResponse, null, 2), "JSON response")}
                      data-testid="button-copy-json"
                    >
                      <Copy size={14} className="mr-2" />
                      Copy All
                    </Button>
                  </div>
                  <ScrollArea className="h-[500px] w-full rounded-md border p-4 bg-muted/50">
                    <pre className="text-xs font-mono">
                      {JSON.stringify(jsonViewPhoneNumber.validationResponse, null, 2)}
                    </pre>
                  </ScrollArea>
                </>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">No API response data available</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* SMS Opt-in Dialog */}
      <Dialog open={smsOptinPhoneNumber !== null} onOpenChange={() => setSmsOptinPhoneNumber(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              SMS Opt-in Settings
            </DialogTitle>
            <DialogDescription>
              Manage SMS opt-in status for {smsOptinPhoneNumber && formatPhoneNumberForDisplay(smsOptinPhoneNumber.phoneNumber)}
            </DialogDescription>
          </DialogHeader>
          {smsOptinPhoneNumber && (
            <div className="space-y-6">
              {isLoadingOptin ? (
                <div className="flex items-center justify-center py-8">
                  <p className="text-sm text-muted-foreground">Loading opt-in status...</p>
                </div>
              ) : (
                <>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="optin-switch">SMS Opt-in</Label>
                        <p className="text-sm text-muted-foreground">
                          Allow sending SMS messages to this number
                        </p>
                      </div>
                      <Switch
                        id="optin-switch"
                        checked={smsOptinData?.optin?.optin ?? false}
                        onCheckedChange={(checked) => {
                          updateSmsOptinMutation.mutate({
                            phoneNumber: smsOptinPhoneNumber.phoneNumber,
                            optin: checked,
                          });
                        }}
                        disabled={updateSmsOptinMutation.isPending}
                        data-testid="switch-sms-optin"
                      />
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="allowlist-switch">Allowlist</Label>
                        <p className="text-sm text-muted-foreground">
                          Allow sending even when the system is in dev or test mode
                        </p>
                      </div>
                      <Switch
                        id="allowlist-switch"
                        checked={smsOptinData?.optin?.allowlist ?? false}
                        onCheckedChange={(checked) => {
                          updateSmsOptinMutation.mutate({
                            phoneNumber: smsOptinPhoneNumber.phoneNumber,
                            allowlist: checked,
                          });
                        }}
                        disabled={updateSmsOptinMutation.isPending}
                        data-testid="switch-sms-allowlist"
                      />
                    </div>
                  </div>

                  {smsOptinData?.exists && smsOptinData.optin && (
                    <>
                      <Separator />
                      <div className="space-y-3">
                        <h4 className="text-sm font-medium">Opt-in Tracking</h4>
                        <div className="space-y-2 text-sm">
                          {smsOptinData.optin.optinUserDetails && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <User className="h-4 w-4" />
                              <span>
                                Set by: {smsOptinData.optin.optinUserDetails.firstName || ''} {smsOptinData.optin.optinUserDetails.lastName || ''} ({smsOptinData.optin.optinUserDetails.email})
                              </span>
                            </div>
                          )}
                          {smsOptinData.optin.optinDate && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Calendar className="h-4 w-4" />
                              <span>
                                Date: {format(new Date(smsOptinData.optin.optinDate), 'PPpp')}
                              </span>
                            </div>
                          )}
                          {smsOptinData.optin.optinIp && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Globe className="h-4 w-4" />
                              <span>
                                IP Address: {smsOptinData.optin.optinIp}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  <Separator />
                  
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <Link className="h-4 w-4" />
                      Public Opt-in Link
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Share this link to allow the phone number owner to manage their opt-in preference.
                    </p>
                    
                    {isLoadingToken ? (
                      <div className="flex items-center justify-center py-4">
                        <p className="text-sm text-muted-foreground">Generating link...</p>
                      </div>
                    ) : publicOptinUrl ? (
                      <div className="space-y-4">
                        <div className="flex flex-col items-center gap-4 p-4 bg-white dark:bg-gray-900 rounded-md border">
                          <QRCodeSVG 
                            value={publicOptinUrl} 
                            size={150}
                            level="M"
                            includeMargin={true}
                            data-testid="qr-code-sms-optin"
                          />
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Input 
                            value={publicOptinUrl} 
                            readOnly 
                            className="text-xs font-mono"
                            data-testid="input-optin-url"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => copyToClipboard(publicOptinUrl, "Opt-in link")}
                            data-testid="button-copy-optin-url"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => window.open(publicOptinUrl, '_blank')}
                            data-testid="button-open-optin-url"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Failed to generate link</p>
                    )}
                  </div>
                </>
              )}

              <div className="flex justify-end pt-4">
                <Button onClick={() => setSmsOptinPhoneNumber(null)} data-testid="button-close-optin">
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {phoneNumbers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Phone className="text-muted-foreground mb-4" size={48} />
            <h3 className="text-lg font-medium text-foreground mb-2">No phone numbers yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              {canEdit ? "Add the first phone number for this worker" : "No phone numbers have been added yet"}
            </p>
            {canEdit && (
              <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-first-phone">
                <Plus size={16} className="mr-2" />
                Add Phone Number
              </Button>
            )}
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
                      {!phoneNumber.isActive && (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </div>
                    {phoneNumber.friendlyName && (
                      <p className="text-sm text-muted-foreground">{formatPhoneNumberForDisplay(phoneNumber.phoneNumber)}</p>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetPrimary(phoneNumber.id)}
                        disabled={setPrimaryMutation.isPending}
                        data-testid={`button-set-primary-phone-${phoneNumber.id}`}
                        className={phoneNumber.isPrimary ? "text-yellow-500 hover:text-yellow-600" : ""}
                      >
                        <Star size={16} fill={phoneNumber.isPrimary ? "currentColor" : "none"} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewingPhoneNumber(phoneNumber)}
                      data-testid={`button-view-phone-${phoneNumber.id}`}
                    >
                      <Eye size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSmsOptinPhoneNumber(phoneNumber)}
                      data-testid={`button-sms-optin-${phoneNumber.id}`}
                      title="SMS Opt-in Settings"
                    >
                      <MessageSquare size={14} />
                    </Button>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(phoneNumber)}
                        data-testid={`button-edit-phone-${phoneNumber.id}`}
                      >
                        <Edit size={14} />
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(phoneNumber.id)}
                        disabled={deletePhoneNumberMutation.isPending}
                        data-testid={`button-delete-phone-${phoneNumber.id}`}
                      >
                        <Trash2 size={14} className="text-destructive" />
                      </Button>
                    )}
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
