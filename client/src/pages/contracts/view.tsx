import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Trash2, FileText, Layers, List } from "lucide-react";
import { ContractLayout, useContractLayout } from "@/components/layouts/ContractLayout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function DetailsBody() {
  const { contract } = useContractLayout();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiRequest("DELETE", `/api/contracts/${contract.id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      toast({ title: "Contract deleted", description: `"${contract.name}" was removed.` });
      navigate("/contracts");
    } catch (error) {
      toast({
        title: "Failed to delete contract",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Articles</CardTitle>
            <Layers size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold" data-testid="stat-article-count">
              {contract.articleCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sections</CardTitle>
            <List size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold" data-testid="stat-section-count">
              {contract.sectionCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Stub sections</CardTitle>
            <FileText size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge variant={contract.stubSections ? "default" : "secondary"} data-testid="badge-stub-sections">
              {contract.stubSections ? "Enabled" : "Disabled"}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-muted-foreground">
              Deleting a contract permanently removes it and all of its articles and sections.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" data-testid="button-delete-contract">
                  <Trash2 size={16} className="mr-2" />
                  Delete Contract
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{contract.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes the contract and all {contract.articleCount ?? 0}{" "}
                    article(s) and {contract.sectionCount ?? 0} section(s). This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-delete-contract">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    disabled={deleting}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid="button-confirm-delete-contract"
                  >
                    {deleting && <Loader2 size={16} className="mr-2 animate-spin" />}
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ContractViewPage() {
  return (
    <ContractLayout activeTab="details">
      <DetailsBody />
    </ContractLayout>
  );
}
