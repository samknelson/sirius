import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, Eye, Users, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { BargainingUnit } from "@shared/schema";

export default function BargainingUnitsPage() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  
  const [formSiriusId, setFormSiriusId] = useState("");
  const [formName, setFormName] = useState("");

  const { data: bargainingUnits = [], isLoading } = useQuery<BargainingUnit[]>({
    queryKey: ["/api/bargaining-units"],
  });

  const filteredUnits = useMemo(() => {
    if (!searchTerm.trim()) return bargainingUnits;
    
    const search = searchTerm.toLowerCase();
    return bargainingUnits.filter(unit => 
      unit.name.toLowerCase().includes(search) ||
      unit.siriusId.toLowerCase().includes(search)
    );
  }, [bargainingUnits, searchTerm]);

  const createMutation = useMutation({
    mutationFn: async (data: { siriusId: string; name: string }) => {
      return apiRequest("POST", "/api/bargaining-units", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bargaining-units"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Bargaining unit created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create bargaining unit.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormSiriusId("");
    setFormName("");
  };

  const handleAddClick = () => {
    resetForm();
    setIsAddDialogOpen(true);
  };

  const handleSave = () => {
    if (!formSiriusId.trim()) {
      toast({
        title: "Validation Error",
        description: "Sirius ID is required.",
        variant: "destructive",
      });
      return;
    }

    if (!formName.trim()) {
      toast({
        title: "Validation Error",
        description: "Name is required.",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({
      siriusId: formSiriusId.trim(),
      name: formName.trim(),
    });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Bargaining Units
            </CardTitle>
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
          <div className="flex justify-between items-start gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Bargaining Units
              </CardTitle>
              <CardDescription>
                Manage bargaining units ({bargainingUnits.length} total)
              </CardDescription>
            </div>
            <Button onClick={handleAddClick} data-testid="button-add-bargaining-unit">
              <Plus className="mr-2 h-4 w-4" />
              Add Bargaining Unit
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Input
              placeholder="Search by name or Sirius ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm"
              data-testid="input-search-bargaining-units"
            />
          </div>

          {filteredUnits.length === 0 ? (
            <div className="text-center py-12">
              <Users className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-medium text-foreground">
                {searchTerm ? "No matching bargaining units" : "No bargaining units"}
              </h3>
              <p className="mt-2 text-muted-foreground">
                {searchTerm
                  ? "Try adjusting your search."
                  : "Get started by creating a new bargaining unit."}
              </p>
              {!searchTerm && (
                <Button
                  onClick={handleAddClick}
                  className="mt-4"
                  data-testid="button-create-first-bargaining-unit"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create Bargaining Unit
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sirius ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUnits.map((unit) => (
                  <TableRow key={unit.id} data-testid={`row-bargaining-unit-${unit.id}`}>
                    <TableCell className="font-mono text-sm" data-testid={`text-sirius-id-${unit.id}`}>
                      {unit.siriusId}
                    </TableCell>
                    <TableCell data-testid={`text-name-${unit.id}`}>
                      {unit.name}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/bargaining-units/${unit.id}`}>
                        <Button variant="ghost" size="icon" data-testid={`button-view-${unit.id}`}>
                          <Eye className="h-4 w-4" />
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

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Bargaining Unit</DialogTitle>
            <DialogDescription>
              Create a new bargaining unit with a unique Sirius ID.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sirius-id">Sirius ID *</Label>
              <Input
                id="sirius-id"
                placeholder="e.g., bu-001"
                value={formSiriusId}
                onChange={(e) => setFormSiriusId(e.target.value)}
                data-testid="input-sirius-id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="e.g., Local 123"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                data-testid="input-name"
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
              data-testid="button-cancel-add"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending}
              data-testid="button-confirm-add"
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
