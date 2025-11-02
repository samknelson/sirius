import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

export function AddWorkerForm() {
  const [name, setName] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const addWorkerMutation = useMutation({
    mutationFn: async (workerData: { name: string }) => {
      const response = await apiRequest("POST", "/api/workers", workerData);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      setName("");
      toast({
        title: "Success",
        description: "Worker added successfully!",
      });
      // Redirect to worker detail page after successful add
      setLocation(`/workers/${data.id}`);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add worker. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      addWorkerMutation.mutate({ name: name.trim() });
    }
  };

  return (
    <div className="mb-8">
      <Card className="shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Add New Worker</h2>
            <Plus className="text-muted-foreground" size={20} />
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Input
                type="text"
                placeholder="Enter worker name..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full"
                data-testid="input-worker-name"
              />
            </div>
            <Button
              type="submit"
              disabled={addWorkerMutation.isPending || !name.trim()}
              data-testid="button-add-worker"
            >
              <Plus className="mr-2" size={16} />
              {addWorkerMutation.isPending ? "Adding..." : "Add Worker"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
