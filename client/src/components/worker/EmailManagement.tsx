import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Contact } from "@shared/schema";
import { Loader2, Save, Mail, Settings, CheckCircle, XCircle } from "lucide-react";

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

interface EmailManagementProps {
  contactId: string;
  workerId: string;
  canEdit?: boolean;
}

export default function EmailManagement({ contactId, workerId, canEdit = true }: EmailManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editedEmail, setEditedEmail] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);
  const [isOptinDialogOpen, setIsOptinDialogOpen] = useState(false);

  // Fetch contact information
  const { data: contact, isLoading } = useQuery<Contact>({
    queryKey: ["/api/contacts", contactId],
    queryFn: async () => {
      const response = await fetch(`/api/contacts/${contactId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch contact");
      }
      return response.json();
    },
    enabled: !!contactId,
  });

  const hasEmail = !!contact?.email && contact.email.trim().length > 0;

  // Fetch email opt-in status
  const { data: emailOptinData, isLoading: isLoadingOptin } = useQuery<EmailOptinResponse>({
    queryKey: ["/api/email-optin", contact?.email],
    queryFn: async () => {
      if (!contact?.email) return null;
      const response = await fetch(`/api/email-optin/${encodeURIComponent(contact.email)}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch email opt-in status`);
      }
      return response.json();
    },
    enabled: hasEmail,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  // Update email opt-in mutation
  const updateEmailOptinMutation = useMutation({
    mutationFn: async ({ emailAddress, optin, allowlist }: { emailAddress: string; optin?: boolean; allowlist?: boolean }) => {
      return apiRequest("PUT", `/api/email-optin/${encodeURIComponent(emailAddress)}`, { optin, allowlist });
    },
    onSuccess: () => {
      if (contact?.email) {
        queryClient.invalidateQueries({ queryKey: ["/api/email-optin", contact.email] });
      }
      toast({
        title: "Email Opt-in Updated",
        description: "The email opt-in status has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update email opt-in status",
        variant: "destructive",
      });
    },
  });

  // Update email mutation
  const updateEmailMutation = useMutation({
    mutationFn: async (email: string) => {
      return apiRequest("PUT", `/api/workers/${workerId}`, { email });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Email updated successfully!",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to update email. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleEdit = () => {
    setEditedEmail(contact?.email || "");
    setIsEditing(true);
  };

  const handleSave = () => {
    const cleanEmail = editedEmail.trim();
    
    // Allow clearing the email
    if (!cleanEmail) {
      updateEmailMutation.mutate("");
      return;
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }
    
    updateEmailMutation.mutate(cleanEmail);
  };

  const handleCancel = () => {
    setEditedEmail("");
    setIsEditing(false);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Email Address</CardTitle>
          <CardDescription>Manage contact email address</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const optinModal = hasEmail && (
    <Dialog open={isOptinDialogOpen} onOpenChange={setIsOptinDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Opt-in Settings
          </DialogTitle>
          <DialogDescription>
            Manage opt-in and allowlist settings for this email address.
          </DialogDescription>
        </DialogHeader>
        
        {isLoadingOptin ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2 text-muted-foreground">Loading opt-in status...</span>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Email Address</Label>
              <p className="font-medium">{contact?.email}</p>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="email-optin" className="text-base font-medium">Opted In</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow sending emails to this address
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {emailOptinData?.optin ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Switch
                    id="email-optin"
                    checked={emailOptinData?.optin ?? false}
                    onCheckedChange={(checked) => {
                      if (contact?.email) {
                        updateEmailOptinMutation.mutate({ emailAddress: contact.email, optin: checked });
                      }
                    }}
                    disabled={updateEmailOptinMutation.isPending}
                    data-testid="switch-email-optin"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="email-allowlist" className="text-base font-medium">Allowlisted</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow sending in dev/test modes
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {emailOptinData?.allowlist ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Switch
                    id="email-allowlist"
                    checked={emailOptinData?.allowlist ?? false}
                    onCheckedChange={(checked) => {
                      if (contact?.email) {
                        updateEmailOptinMutation.mutate({ emailAddress: contact.email, allowlist: checked });
                      }
                    }}
                    disabled={updateEmailOptinMutation.isPending}
                    data-testid="switch-email-allowlist"
                  />
                </div>
              </div>
            </div>

            {emailOptinData?.record?.optinDate && (
              <>
                <Separator />
                <div className="text-sm text-muted-foreground">
                  <p>Opted in on: {new Date(emailOptinData.record.optinDate).toLocaleString()}</p>
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
            <CardTitle>Email Address</CardTitle>
            <CardDescription>Manage contact email address</CardDescription>
          </div>
          {hasEmail && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsOptinDialogOpen(true)}
              data-testid="button-email-optin-settings"
            >
              <Settings className="h-4 w-4 mr-2" />
              Opt-in Settings
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {!isEditing ? (
            <div className="space-y-4">
              <div className="flex items-center space-x-4 p-4 bg-muted/30 rounded-lg border border-border">
                <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                  <Mail size={20} />
                </div>
                <div className="flex-1">
                  <Label className="text-sm text-muted-foreground">Email Address</Label>
                  <p className="text-lg font-medium text-foreground" data-testid="text-contact-email">
                    {contact?.email || "Not set"}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    onClick={handleEdit}
                    variant="outline"
                    size="sm"
                    data-testid="button-edit-email"
                  >
                    Edit
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={editedEmail}
                  onChange={(e) => setEditedEmail(e.target.value)}
                  placeholder="email@example.com"
                  autoFocus
                  data-testid="input-email"
                />
                <p className="text-xs text-muted-foreground">Enter a valid email address</p>
              </div>
              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={updateEmailMutation.isPending}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={updateEmailMutation.isPending}
                  data-testid="button-save-email"
                >
                  {updateEmailMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
      </CardContent>
    </Card>
    </>
  );
}
