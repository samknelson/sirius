import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { TrustProvider } from "@shared/schema";

export default function TrustProvidersPage() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  
  // Form state
  const [formName, setFormName] = useState("");

  const { data: providers = [], isLoading } = useQuery<TrustProvider[]>({
    queryKey: ["/api/trust/providers"],
  });

  // Filter providers by search term
  const filteredProviders = useMemo(() => {
    if (!searchTerm.trim()) return providers;
    
    const search = searchTerm.toLowerCase();
    return providers.filter(provider => 
      provider.name.toLowerCase().includes(search)
    );
  }, [providers, searchTerm]);

  const createMutation = useMutation({
    mutationFn: async (data: { name: string }) => {
      return apiRequest("POST", "/api/trust/providers", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust/providers"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Trust provider created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create trust provider.",
        variant: "destructive",
      });
    },
  });


  const resetForm = () => {
    setFormName("");
  };

  const handleAddClick = () => {
    resetForm();
    setIsAddDialogOpen(true);
  };

  const handleSave = () => {
    if (!formName.trim()) {
      toast({
        title: "Validation Error",
        description: "Provider name is required.",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({ name: formName.trim() });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>Trust Providers</CardTitle>
            <CardDescription>Loading...</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle>Trust Providers</CardTitle>
              <CardDescription>Manage trust providers</CardDescription>
            </div>
            <Button onClick={handleAddClick} data-testid="button-add-provider">
              <Plus className="mr-2 h-4 w-4" />
              Add Provider
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Input
              placeholder="Search providers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm"
              data-testid="input-search-providers"
            />
          </div>

          {filteredProviders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchTerm ? "No providers found matching your search." : "No providers yet. Add one to get started."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProviders.map((provider) => (
                  <TableRow key={provider.id} data-testid={`row-provider-${provider.id}`}>
                    <TableCell data-testid={`text-provider-name-${provider.id}`}>
                      {provider.name}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/trust/provider/${provider.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`button-view-${provider.id}`}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsAddDialogOpen(false);
          resetForm();
        }
      }}>
        <DialogContent data-testid="dialog-provider-form">
          <DialogHeader>
            <DialogTitle>Add Provider</DialogTitle>
            <DialogDescription>
              Create a new trust provider.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label htmlFor="name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Enter provider name"
                data-testid="input-provider-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAddDialogOpen(false);
                resetForm();
              }}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending}
              data-testid="button-save"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
