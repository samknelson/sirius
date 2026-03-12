import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Contact } from "@shared/schema";
import { Loader2, Save, User } from "lucide-react";

interface GenderOption {
  id: string;
  name: string;
  code: string;
  nota: boolean;
  sequence: number;
}

interface GenderManagementProps {
  contactId: string;
  canEdit?: boolean;
}

export default function GenderManagement({ contactId, canEdit = true }: GenderManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editedGender, setEditedGender] = useState<string>("");
  const [editedGenderNota, setEditedGenderNota] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);
  const [selectedOptionIsNota, setSelectedOptionIsNota] = useState(false);

  // Fetch contact information
  const { data: contact, isLoading: isLoadingContact } = useQuery<Contact>({
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

  // Fetch gender options
  const { data: genderOptions = [], isLoading: isLoadingOptions } = useQuery<GenderOption[]>({
    queryKey: ["/api/options/gender"],
  });

  // Get worker ID from URL
  const workerId = window.location.pathname.split("/")[2];

  // Update gender mutation
  const updateGenderMutation = useMutation({
    mutationFn: async (data: { gender: string | null; genderNota: string | null }) => {
      return apiRequest("PUT", `/api/workers/${workerId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Gender updated successfully!",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to update gender. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Update selected option's nota status when gender changes
  useEffect(() => {
    if (editedGender) {
      const selectedOption = genderOptions.find(opt => opt.id === editedGender);
      setSelectedOptionIsNota(selectedOption?.nota || false);
    } else {
      setSelectedOptionIsNota(false);
    }
  }, [editedGender, genderOptions]);

  const handleEdit = () => {
    setEditedGender(contact?.gender || "");
    setEditedGenderNota(contact?.genderNota || "");
    const selectedOption = genderOptions.find(opt => opt.id === contact?.gender);
    setSelectedOptionIsNota(selectedOption?.nota || false);
    setIsEditing(true);
  };

  const handleSave = () => {
    // Allow clearing the gender
    if (!editedGender) {
      updateGenderMutation.mutate({ gender: null, genderNota: null });
      return;
    }
    
    updateGenderMutation.mutate({ 
      gender: editedGender,
      genderNota: selectedOptionIsNota ? editedGenderNota.trim() : null
    });
  };

  const handleCancel = () => {
    setEditedGender("");
    setEditedGenderNota("");
    setSelectedOptionIsNota(false);
    setIsEditing(false);
  };

  const isLoading = isLoadingContact || isLoadingOptions;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Gender</CardTitle>
          <CardDescription>Manage contact gender</CardDescription>
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
        <CardTitle>Gender</CardTitle>
        <CardDescription>Manage contact gender</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!isEditing ? (
          <div className="space-y-4">
            <div className="flex items-center space-x-4 p-4 bg-muted/30 rounded-lg border border-border">
              <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                <User size={20} />
              </div>
              <div className="flex-1">
                <Label className="text-sm text-muted-foreground">Gender</Label>
                <p className="text-lg font-medium text-foreground" data-testid="text-contact-gender">
                  {contact?.genderCalc || "Not set"}
                </p>
              </div>
              {canEdit && (
                <Button
                  onClick={handleEdit}
                  variant="outline"
                  size="sm"
                  data-testid="button-edit-gender"
                >
                  Edit
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              <Select
                value={editedGender}
                onValueChange={setEditedGender}
              >
                <SelectTrigger data-testid="select-gender">
                  <SelectValue placeholder="Select gender..." />
                </SelectTrigger>
                <SelectContent>
                  {genderOptions
                    .sort((a, b) => a.sequence - b.sequence)
                    .map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Select a gender option or leave empty to clear</p>
            </div>

            {selectedOptionIsNota && (
              <div className="space-y-2">
                <Label htmlFor="genderNota">Specify Gender</Label>
                <Input
                  id="genderNota"
                  type="text"
                  value={editedGenderNota}
                  onChange={(e) => setEditedGenderNota(e.target.value)}
                  placeholder="Enter gender..."
                  data-testid="input-gender-nota"
                />
                <p className="text-xs text-muted-foreground">Please specify the gender</p>
              </div>
            )}

            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={updateGenderMutation.isPending}
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={updateGenderMutation.isPending}
                data-testid="button-save-gender"
              >
                {updateGenderMutation.isPending ? (
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
