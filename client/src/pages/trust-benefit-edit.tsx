import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Save } from "lucide-react";
import { TrustBenefitLayout, useTrustBenefitLayout } from "@/components/layouts/TrustBenefitLayout";
import { TrustBenefitType } from "@shared/schema";

function TrustBenefitEditContent() {
  const { benefit } = useTrustBenefitLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editName, setEditName] = useState(benefit.name);
  const [editBenefitType, setEditBenefitType] = useState(benefit.benefitType || undefined);
  const [editIsActive, setEditIsActive] = useState(benefit.isActive);
  const [editDescription, setEditDescription] = useState(benefit.description || "");

  const { data: benefitTypes = [] } = useQuery<TrustBenefitType[]>({
    queryKey: ["/api/trust-benefit-types"],
  });

  const updateBenefitMutation = useMutation({
    mutationFn: async (data: { name: string; benefitType?: string; isActive: boolean; description?: string }) => {
      return await apiRequest("PUT", `/api/trust-benefits/${benefit.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust-benefits", benefit.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/trust-benefits"] });
      toast({
        title: "Success",
        description: "Trust benefit updated successfully!",
      });
    },
    onError: (error: any) => {
      const message = error.message || "Failed to update trust benefit. Please try again.";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleSaveEdit = () => {
    if (editName.trim()) {
      updateBenefitMutation.mutate({ 
        name: editName.trim(), 
        benefitType: editBenefitType || undefined,
        isActive: editIsActive,
        description: editDescription.trim() || undefined
      });
    }
  };

  return (
    <Card>
      <CardContent className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Edit Trust Benefit</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-benefit-name" className="text-sm font-medium text-foreground">
                Benefit Name
              </Label>
              <Input
                id="edit-benefit-name"
                type="text"
                placeholder="Enter benefit name..."
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full"
                data-testid="input-edit-benefit-name"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit-benefit-type" className="text-sm font-medium text-foreground">
                Benefit Type
              </Label>
              <Select value={editBenefitType} onValueChange={setEditBenefitType}>
                <SelectTrigger data-testid="select-edit-benefit-type">
                  <SelectValue placeholder="Select a benefit type..." />
                </SelectTrigger>
                <SelectContent>
                  {benefitTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id} data-testid={`option-edit-benefit-type-${type.id}`}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-benefit-description" className="text-sm font-medium text-foreground">
                Description
              </Label>
              <SimpleHtmlEditor
                value={editDescription}
                onChange={setEditDescription}
                placeholder="Enter benefit description..."
                data-testid="editor-edit-benefit-description"
              />
              <p className="text-xs text-muted-foreground">
                Supports basic formatting: bold, italic, lists
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-benefit-active"
                checked={editIsActive}
                onCheckedChange={(checked) => setEditIsActive(checked === true)}
                data-testid="checkbox-edit-benefit-active"
              />
              <Label
                htmlFor="edit-benefit-active"
                className="text-sm font-medium text-foreground cursor-pointer"
              >
                Active
              </Label>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-4 border-t border-border">
          <div className="flex items-center space-x-3">
            <Button
              onClick={handleSaveEdit}
              disabled={updateBenefitMutation.isPending || !editName.trim()}
              data-testid="button-save-benefit"
            >
              <Save className="mr-2" size={16} />
              {updateBenefitMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
            <Link href="/trust-benefits">
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

export default function TrustBenefitEdit() {
  return (
    <TrustBenefitLayout activeTab="edit">
      <TrustBenefitEditContent />
    </TrustBenefitLayout>
  );
}
