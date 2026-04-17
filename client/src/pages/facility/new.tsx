import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, ArrowLeft } from "lucide-react";
import type { Facility } from "@shared/schema";

export default function FacilityNewPage() {
  usePageTitle("New Facility");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");

  const createMutation = useMutation({
    mutationFn: async (facilityName: string) =>
      apiRequest("POST", "/api/facilities", { name: facilityName }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["/api/facilities"] });
      const facility = response as Facility;
      toast({ title: "Facility created", description: `"${facility.name}" has been created.` });
      setLocation(`/facility/${facility.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }
    createMutation.mutate(trimmed);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold" data-testid="heading-new-facility">New Facility</h1>
        <Link href="/facilities">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft size={16} className="mr-2" />
            Back to Facilities
          </Button>
        </Link>
      </div>

      <Card data-testid="card-create">
        <CardHeader>
          <CardTitle>Create Facility</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="input-create-name"
              />
            </div>
            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={createMutation.isPending || !name.trim()} data-testid="button-create">
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Facility
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation("/facilities")}
                data-testid="button-cancel-create"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
