import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Contact } from "@shared/schema";
import { Loader2, Save, Calendar } from "lucide-react";

interface BirthDateManagementProps {
  contactId: string;
  canEdit?: boolean;
}

export default function BirthDateManagement({ contactId, canEdit = true }: BirthDateManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editedBirthDate, setEditedBirthDate] = useState<string>("");
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

  // Get worker ID from URL
  const workerId = window.location.pathname.split("/")[2];

  // Update birth date mutation
  const updateBirthDateMutation = useMutation({
    mutationFn: async (birthDate: string | null) => {
      return apiRequest("PUT", `/api/workers/${workerId}`, { birthDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Birth date updated successfully!",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to update birth date. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleEdit = () => {
    // Use the birth date directly (already in yyyy-mm-dd format)
    setEditedBirthDate(contact?.birthDate || "");
    setIsEditing(true);
  };

  const handleSave = () => {
    const cleanBirthDate = editedBirthDate.trim();
    
    // Allow clearing the birth date
    if (!cleanBirthDate) {
      updateBirthDateMutation.mutate(null);
      return;
    }
    
    updateBirthDateMutation.mutate(cleanBirthDate);
  };

  const handleCancel = () => {
    setEditedBirthDate("");
    setIsEditing(false);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Birth Date</CardTitle>
          <CardDescription>Manage contact birth date</CardDescription>
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
        <CardTitle>Birth Date</CardTitle>
        <CardDescription>Manage contact birth date</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!isEditing ? (
          <div className="space-y-4">
            <div className="flex items-center space-x-4 p-4 bg-muted/30 rounded-lg border border-border">
              <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                <Calendar size={20} />
              </div>
              <div className="flex-1">
                <Label className="text-sm text-muted-foreground">Birth Date</Label>
                <p className="text-lg font-medium text-foreground" data-testid="text-contact-birthdate">
                  {contact?.birthDate ? (() => {
                    const [year, month, day] = contact.birthDate.split('-');
                    const monthNames = ["January", "February", "March", "April", "May", "June",
                      "July", "August", "September", "October", "November", "December"];
                    return `${monthNames[parseInt(month, 10) - 1]} ${parseInt(day, 10)}, ${year}`;
                  })() : "Not set"}
                </p>
              </div>
              {canEdit && (
                <Button
                  onClick={handleEdit}
                  variant="outline"
                  size="sm"
                  data-testid="button-edit-birthdate"
                >
                  Edit
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="birthDate">Birth Date</Label>
              <Input
                id="birthDate"
                type="date"
                value={editedBirthDate}
                onChange={(e) => setEditedBirthDate(e.target.value)}
                autoFocus
                data-testid="input-birthdate"
              />
              <p className="text-xs text-muted-foreground">Select a date from the calendar or leave empty to clear</p>
            </div>
            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={updateBirthDateMutation.isPending}
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={updateBirthDateMutation.isPending}
                data-testid="button-save-birthdate"
              >
                {updateBirthDateMutation.isPending ? (
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
