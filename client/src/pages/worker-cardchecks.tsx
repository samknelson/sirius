import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Cardcheck, CardcheckDefinition } from "@shared/schema";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Eye, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

interface CardcheckWithDefinition extends Cardcheck {
  definition?: CardcheckDefinition;
}

function WorkerCardchecksContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string>("");

  const { data: cardchecks = [], isLoading } = useQuery<CardcheckWithDefinition[]>({
    queryKey: ["/api/workers", worker.id, "cardchecks"],
  });

  const { data: definitions = [] } = useQuery<CardcheckDefinition[]>({
    queryKey: ["/api/cardcheck/definitions"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { cardcheckDefinitionId: string }) => {
      return apiRequest("POST", `/api/workers/${worker.id}/cardchecks`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "cardchecks"] });
      toast({
        title: "Success",
        description: "Cardcheck created successfully.",
      });
      setIsCreateOpen(false);
      setSelectedDefinitionId("");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create cardcheck.",
        variant: "destructive",
      });
    },
  });

  const handleCreate = () => {
    if (!selectedDefinitionId) {
      toast({
        title: "Validation Error",
        description: "Please select a cardcheck definition.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({ cardcheckDefinitionId: selectedDefinitionId });
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "signed":
        return "default";
      case "revoked":
        return "destructive";
      default:
        return "secondary";
    }
  };

  const getDefinitionName = (cardcheck: CardcheckWithDefinition) => {
    if (cardcheck.definition) {
      return cardcheck.definition.name;
    }
    const def = definitions.find(d => d.id === cardcheck.cardcheckDefinitionId);
    return def?.name || "Unknown";
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Cardchecks</CardTitle>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-create-cardcheck">
              <Plus className="h-4 w-4 mr-2" />
              New Cardcheck
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Cardcheck</DialogTitle>
              <DialogDescription>
                Select a cardcheck definition to create a new cardcheck for this worker.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Cardcheck Definition</Label>
                <Select value={selectedDefinitionId} onValueChange={setSelectedDefinitionId}>
                  <SelectTrigger data-testid="select-definition">
                    <SelectValue placeholder="Select a definition..." />
                  </SelectTrigger>
                  <SelectContent>
                    {definitions.map((def) => (
                      <SelectItem key={def.id} value={def.id}>
                        [{def.siriusId}] {def.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleCreate} 
                disabled={createMutation.isPending}
                data-testid="button-confirm-create"
              >
                {createMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : cardchecks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No cardchecks found for this worker.</p>
            <p className="text-sm mt-1">Create a new cardcheck to get started.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Definition</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Signed Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cardchecks.map((cardcheck) => (
                <TableRow key={cardcheck.id} data-testid={`row-cardcheck-${cardcheck.id}`}>
                  <TableCell className="font-medium">
                    {getDefinitionName(cardcheck)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(cardcheck.status)}>
                      {cardcheck.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {cardcheck.signedDate 
                      ? format(new Date(cardcheck.signedDate), "MMM d, yyyy") 
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/cardchecks/${cardcheck.id}`}>
                      <Button variant="ghost" size="icon" data-testid={`button-view-${cardcheck.id}`}>
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
  );
}

export default function WorkerCardchecks() {
  return (
    <WorkerLayout activeTab="cardchecks">
      <WorkerCardchecksContent />
    </WorkerLayout>
  );
}
