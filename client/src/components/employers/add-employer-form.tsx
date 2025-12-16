import { useState } from "react";
import { Plus, Building, Building2, Factory, Store, Warehouse, Home, Landmark, Hospital } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { EmployerType } from "@shared/schema";

const iconMap: Record<string, React.ComponentType<{ className?: string; size?: number }>> = {
  Building,
  Building2,
  Factory,
  Store,
  Warehouse,
  Home,
  Landmark,
  Hospital,
};

export function AddEmployerForm() {
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [typeId, setTypeId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: employerTypes = [] } = useQuery<EmployerType[]>({
    queryKey: ["/api/employer-types"],
  });

  const addEmployerMutation = useMutation({
    mutationFn: async (employerData: { name: string; isActive: boolean; typeId: string | null }) => {
      return await apiRequest("POST", "/api/employers", employerData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employers"] });
      setName("");
      setIsActive(true);
      setTypeId(null);
      toast({
        title: "Success",
        description: "Employer added successfully!",
      });
      // Redirect to employer list after successful add
      setLocation("/employers");
    },
    onError: (error: any) => {
      const message = error.message || "Failed to add employer. Please try again.";
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
      addEmployerMutation.mutate({ name: name.trim(), isActive, typeId });
    }
  };

  return (
    <div className="mb-8">
      <Card className="shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Add New Employer</h2>
            <Plus className="text-muted-foreground" size={20} />
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="employer-name" className="text-sm font-medium text-foreground mb-2 block">
                Employer Name
              </Label>
              <Input
                id="employer-name"
                type="text"
                placeholder="Enter employer name..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full"
                data-testid="input-employer-name"
              />
            </div>
            <div>
              <Label htmlFor="employer-type" className="text-sm font-medium text-foreground mb-2 block">
                Employer Type
              </Label>
              <Select
                value={typeId || "__none__"}
                onValueChange={(value) => setTypeId(value === "__none__" ? null : value)}
              >
                <SelectTrigger className="w-full" data-testid="select-employer-type">
                  <SelectValue placeholder="Select type (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" data-testid="select-item-type-none">
                    <span className="text-muted-foreground">None</span>
                  </SelectItem>
                  {employerTypes.map((type) => {
                    const iconName = (type.data as any)?.icon;
                    const IconComponent = iconName ? iconMap[iconName] : Building;
                    return (
                      <SelectItem key={type.id} value={type.id} data-testid={`select-item-type-${type.id}`}>
                        <div className="flex items-center gap-2">
                          <IconComponent className="text-muted-foreground" size={16} />
                          <span>{type.name}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="employer-active"
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked === true)}
                data-testid="checkbox-employer-active"
              />
              <Label
                htmlFor="employer-active"
                className="text-sm font-medium text-foreground cursor-pointer"
              >
                Active
              </Label>
            </div>
            <Button
              type="submit"
              disabled={addEmployerMutation.isPending || !name.trim()}
              className="w-full sm:w-auto"
              data-testid="button-add-employer"
            >
              <Plus className="mr-2" size={16} />
              {addEmployerMutation.isPending ? "Adding..." : "Add Employer"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
