import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Contact } from "@shared/schema";
import { Loader2, Save, User } from "lucide-react";

interface NameManagementProps {
  workerId: string;
  contactId: string;
}

export default function NameManagement({ workerId, contactId }: NameManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editedName, setEditedName] = useState<string>("");
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

  // Update name mutation
  const updateNameMutation = useMutation({
    mutationFn: async (name: string) => {
      return apiRequest("PUT", `/api/workers/${workerId}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workers", workerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId] });
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Name updated successfully!",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update name. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleEdit = () => {
    setEditedName(contact?.displayName || "");
    setIsEditing(true);
  };

  const handleSave = () => {
    if (editedName.trim()) {
      updateNameMutation.mutate(editedName.trim());
    }
  };

  const handleCancel = () => {
    setEditedName("");
    setIsEditing(false);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Worker Name</CardTitle>
          <CardDescription>Manage the worker's contact name</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Worker Name</CardTitle>
        <CardDescription>Manage the worker's contact name</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!isEditing ? (
          <div className="space-y-4">
            <div className="flex items-center space-x-4 p-4 bg-muted/30 rounded-lg border border-border">
              <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                <User size={20} />
              </div>
              <div className="flex-1">
                <Label className="text-sm text-muted-foreground">Full Name</Label>
                <p className="text-lg font-semibold text-foreground" data-testid="text-contact-name">
                  {contact?.displayName || "No name set"}
                </p>
              </div>
              <Button
                onClick={handleEdit}
                variant="outline"
                size="sm"
                data-testid="button-edit-name"
              >
                Edit
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                placeholder="Enter worker name"
                autoFocus
                data-testid="input-edit-name"
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={updateNameMutation.isPending}
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!editedName.trim() || updateNameMutation.isPending}
                data-testid="button-save-name"
              >
                {updateNameMutation.isPending ? (
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
  );
}
