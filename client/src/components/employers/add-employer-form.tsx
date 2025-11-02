import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

export function AddEmployerForm() {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const addEmployerMutation = useMutation({
    mutationFn: async (employerData: { id: string; name: string }) => {
      const response = await apiRequest("POST", "/api/employers", employerData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employers"] });
      setId("");
      setName("");
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
    if (id.trim() && name.trim()) {
      addEmployerMutation.mutate({ id: id.trim(), name: name.trim() });
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="employer-id" className="text-sm font-medium text-foreground mb-2 block">
                  Employer ID
                </Label>
                <Input
                  id="employer-id"
                  type="text"
                  placeholder="Enter unique employer ID..."
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  className="w-full"
                  data-testid="input-employer-id"
                />
              </div>
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
            </div>
            <Button
              type="submit"
              disabled={addEmployerMutation.isPending || !id.trim() || !name.trim()}
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
