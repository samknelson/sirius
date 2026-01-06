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
  canEdit?: boolean;
}

interface NameComponents {
  title: string;
  given: string;
  middle: string;
  family: string;
  generational: string;
  credentials: string;
}

export default function NameManagement({ workerId, contactId, canEdit = true }: NameManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [nameComponents, setNameComponents] = useState<NameComponents>({
    title: "",
    given: "",
    middle: "",
    family: "",
    generational: "",
    credentials: "",
  });
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
    mutationFn: async (components: NameComponents) => {
      return apiRequest("PUT", `/api/workers/${workerId}`, { nameComponents: components });
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
    setNameComponents({
      title: contact?.title || "",
      given: contact?.given || "",
      middle: contact?.middle || "",
      family: contact?.family || "",
      generational: contact?.generational || "",
      credentials: contact?.credentials || "",
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    // At least given or family name should be provided
    if (nameComponents.given.trim() || nameComponents.family.trim()) {
      updateNameMutation.mutate(nameComponents);
    }
  };

  const handleCancel = () => {
    setNameComponents({
      title: "",
      given: "",
      middle: "",
      family: "",
      generational: "",
      credentials: "",
    });
    setIsEditing(false);
  };

  const updateField = (field: keyof NameComponents, value: string) => {
    setNameComponents(prev => ({ ...prev, [field]: value }));
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
              {canEdit && (
                <Button
                  onClick={handleEdit}
                  variant="outline"
                  size="sm"
                  data-testid="button-edit-name"
                >
                  Edit
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={nameComponents.title}
                  onChange={(e) => updateField("title", e.target.value)}
                  placeholder="Mr., Ms., Dr., etc."
                  data-testid="input-title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="given">First Name</Label>
                <Input
                  id="given"
                  value={nameComponents.given}
                  onChange={(e) => updateField("given", e.target.value)}
                  placeholder="John"
                  autoFocus
                  data-testid="input-given"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="middle">Middle Name</Label>
                <Input
                  id="middle"
                  value={nameComponents.middle}
                  onChange={(e) => updateField("middle", e.target.value)}
                  placeholder="Optional"
                  data-testid="input-middle"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="family">Last Name</Label>
                <Input
                  id="family"
                  value={nameComponents.family}
                  onChange={(e) => updateField("family", e.target.value)}
                  placeholder="Doe"
                  data-testid="input-family"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="generational">Generational Suffix</Label>
                <Input
                  id="generational"
                  value={nameComponents.generational}
                  onChange={(e) => updateField("generational", e.target.value)}
                  placeholder="Jr., Sr., III, etc."
                  data-testid="input-generational"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="credentials">Credentials</Label>
                <Input
                  id="credentials"
                  value={nameComponents.credentials}
                  onChange={(e) => updateField("credentials", e.target.value)}
                  placeholder="MD, PhD, etc."
                  data-testid="input-credentials"
                />
              </div>
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
                disabled={(!nameComponents.given.trim() && !nameComponents.family.trim()) || updateNameMutation.isPending}
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
