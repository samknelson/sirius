import { useState } from "react";
import { Building, Plus } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/layout/PageHeader";

export default function CompanyAdd() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [siriusId, setSiriusId] = useState("");
  const [description, setDescription] = useState("");

  const tabs = [
    { id: "list", label: "List", href: "/companies" },
    { id: "add", label: "Add", href: "/companies/add" },
  ];

  const createCompanyMutation = useMutation({
    mutationFn: async (data: { name: string; siriusId: string; description: string | null }) => {
      return await apiRequest("POST", "/api/companies", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({
        title: "Success",
        description: "Company created successfully!",
      });
      setLocation("/companies");
    },
    onError: (error: any) => {
      const message = error.message || "Failed to create company. Please try again.";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (name.trim() && siriusId.trim()) {
      createCompanyMutation.mutate({
        name: name.trim(),
        siriusId: siriusId.trim(),
        description: description.trim() || null,
      });
    }
  };

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader
        title="Add Company"
        icon={<Building className="text-primary-foreground" size={16} />}
        backLink={{ href: "/companies", label: "Back to Companies" }}
      />

      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {tabs.map((tab) => (
              <Link key={tab.id} href={tab.href}>
                <Button
                  variant={location === tab.href ? "default" : "outline"}
                  size="sm"
                  data-testid={`button-companies-${tab.id}`}
                >
                  {tab.label}
                </Button>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">New Company</h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="company-name" className="text-sm font-medium text-foreground">
                    Company Name *
                  </Label>
                  <Input
                    id="company-name"
                    type="text"
                    placeholder="Enter company name..."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full"
                    data-testid="input-company-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-sirius-id" className="text-sm font-medium text-foreground">
                    Sirius ID *
                  </Label>
                  <Input
                    id="company-sirius-id"
                    type="text"
                    placeholder="Enter Sirius ID..."
                    value={siriusId}
                    onChange={(e) => setSiriusId(e.target.value)}
                    className="w-full"
                    data-testid="input-company-sirius-id"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-description" className="text-sm font-medium text-foreground">
                    Description
                  </Label>
                  <Textarea
                    id="company-description"
                    placeholder="Enter description (optional)..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full"
                    rows={3}
                    data-testid="input-company-description"
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-border">
              <div className="flex items-center space-x-3">
                <Button
                  onClick={handleSubmit}
                  disabled={createCompanyMutation.isPending || !name.trim() || !siriusId.trim()}
                  data-testid="button-create-company"
                >
                  <Plus className="mr-2" size={16} />
                  {createCompanyMutation.isPending ? "Creating..." : "Create Company"}
                </Button>
                <Link href="/companies">
                  <Button variant="outline" data-testid="button-cancel-add">
                    Cancel
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
