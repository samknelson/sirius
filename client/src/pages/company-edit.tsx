import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Save } from "lucide-react";
import { CompanyLayout, useCompanyLayout } from "@/components/layouts/CompanyLayout";

function CompanyEditContent() {
  const { company } = useCompanyLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editName, setEditName] = useState(company.name);
  const [editSiriusId, setEditSiriusId] = useState(company.siriusId);
  const [editDescription, setEditDescription] = useState(company.description || "");

  const updateCompanyMutation = useMutation({
    mutationFn: async (data: { name: string; siriusId: string; description: string | null }) => {
      return await apiRequest("PUT", `/api/companies/${company.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", company.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({
        title: "Success",
        description: "Company updated successfully!",
      });
    },
    onError: (error: any) => {
      const message = error.message || "Failed to update company. Please try again.";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleSaveEdit = () => {
    if (editName.trim() && editSiriusId.trim()) {
      updateCompanyMutation.mutate({
        name: editName.trim(),
        siriusId: editSiriusId.trim(),
        description: editDescription.trim() || null,
      });
    }
  };

  return (
    <Card>
      <CardContent className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Edit Company</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-company-name" className="text-sm font-medium text-foreground">
                Company Name
              </Label>
              <Input
                id="edit-company-name"
                type="text"
                placeholder="Enter company name..."
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full"
                data-testid="input-edit-company-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-company-sirius-id" className="text-sm font-medium text-foreground">
                Sirius ID
              </Label>
              <Input
                id="edit-company-sirius-id"
                type="text"
                placeholder="Enter Sirius ID..."
                value={editSiriusId}
                onChange={(e) => setEditSiriusId(e.target.value)}
                className="w-full"
                data-testid="input-edit-company-sirius-id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-company-description" className="text-sm font-medium text-foreground">
                Description
              </Label>
              <Textarea
                id="edit-company-description"
                placeholder="Enter description (optional)..."
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full"
                rows={3}
                data-testid="input-edit-company-description"
              />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-border">
          <div className="flex items-center space-x-3">
            <Button
              onClick={handleSaveEdit}
              disabled={updateCompanyMutation.isPending || !editName.trim() || !editSiriusId.trim()}
              data-testid="button-save-company"
            >
              <Save className="mr-2" size={16} />
              {updateCompanyMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
            <Link href="/companies">
              <Button variant="outline" data-testid="button-back-to-list">
                Back to List
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CompanyEdit() {
  return (
    <CompanyLayout activeTab="edit">
      <CompanyEditContent />
    </CompanyLayout>
  );
}
