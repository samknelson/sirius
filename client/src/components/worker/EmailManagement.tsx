import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Contact } from "@shared/schema";
import { Loader2, Save, Mail } from "lucide-react";
import EmailOptinSettings from "@/components/comm/EmailOptinSettings";

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

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle>Email Address</CardTitle>
            <CardDescription>Manage contact email address</CardDescription>
          </div>
          {hasEmail && <EmailOptinSettings email={contact?.email} />}
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
