import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { TrustBenefitType } from "@shared/schema";

export function AddTrustBenefitForm() {
  const [name, setName] = useState("");
  const [benefitType, setBenefitType] = useState<string | undefined>(undefined);
  const [isActive, setIsActive] = useState(true);
  const [description, setDescription] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: benefitTypes = [] } = useQuery<TrustBenefitType[]>({
    queryKey: ["/api/trust-benefit-types"],
  });

  const addBenefitMutation = useMutation({
    mutationFn: async (benefitData: { name: string; benefitType?: string; isActive: boolean; description?: string }) => {
      const response = await apiRequest("POST", "/api/trust-benefits", benefitData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust-benefits"] });
      setName("");
      setBenefitType(undefined);
      setIsActive(true);
      setDescription("");
      toast({
        title: "Success",
        description: "Trust benefit added successfully!",
      });
      setLocation("/trust-benefits");
    },
    onError: (error: any) => {
      const message = error.message || "Failed to add trust benefit. Please try again.";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      addBenefitMutation.mutate({ 
        name: name.trim(), 
        benefitType: benefitType || undefined,
        isActive,
        description: description.trim() || undefined
      });
    }
  };

  return (
    <div className="mb-8">
      <Card className="shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Add New Trust Benefit</h2>
            <Plus className="text-muted-foreground" size={20} />
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="benefit-name" className="text-sm font-medium text-foreground mb-2 block">
                Benefit Name
              </Label>
              <Input
                id="benefit-name"
                type="text"
                placeholder="Enter benefit name..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full"
                data-testid="input-benefit-name"
              />
            </div>
            
            <div>
              <Label htmlFor="benefit-type" className="text-sm font-medium text-foreground mb-2 block">
                Benefit Type
              </Label>
              <Select value={benefitType} onValueChange={setBenefitType}>
                <SelectTrigger data-testid="select-benefit-type">
                  <SelectValue placeholder="Select a benefit type..." />
                </SelectTrigger>
                <SelectContent>
                  {benefitTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id} data-testid={`option-benefit-type-${type.id}`}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="benefit-description" className="text-sm font-medium text-foreground mb-2 block">
                Description (HTML)
              </Label>
              <Textarea
                id="benefit-description"
                placeholder="Enter benefit description (HTML supported)..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full min-h-[120px]"
                data-testid="textarea-benefit-description"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="benefit-active"
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked === true)}
                data-testid="checkbox-benefit-active"
              />
              <Label
                htmlFor="benefit-active"
                className="text-sm font-medium text-foreground cursor-pointer"
              >
                Active
              </Label>
            </div>
            <Button
              type="submit"
              disabled={addBenefitMutation.isPending || !name.trim()}
              className="w-full sm:w-auto"
              data-testid="button-add-benefit"
            >
              <Plus className="mr-2" size={16} />
              {addBenefitMutation.isPending ? "Adding..." : "Add Trust Benefit"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
