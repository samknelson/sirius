import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Save, Trash2 } from "lucide-react";
import { ContractLayout, useContractLayout } from "@/components/layouts/ContractLayout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function EditBody() {
  const { contract } = useContractLayout();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [name, setName] = useState(contract.name);
  const [stubSections, setStubSections] = useState(contract.stubSections);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setName(contract.name);
    setStubSections(contract.stubSections);
  }, [contract.name, contract.stubSections]);

  const dirty = name.trim() !== contract.name || stubSections !== contract.stubSections;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/contracts/${contract.id}`, {
        name: name.trim(),
        stubSections,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/contracts", contract.id] });
      await queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      toast({ title: "Contract saved" });
    } catch (error) {
      toast({
        title: "Failed to save contract",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

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
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contract details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="contract-name">Name</Label>
            <Input
              id="contract-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-edit-contract-name"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="stub-sections">Stub sections</Label>
              <p className="text-sm text-muted-foreground">
                Mark newly imported sections as stubs by default.
              </p>
            </div>
            <Switch
              id="stub-sections"
              checked={stubSections}
              onCheckedChange={setStubSections}
              data-testid="switch-stub-sections"
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={!dirty || !name.trim() || saving}
              data-testid="button-save-contract"
            >
              {saving ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>

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

export default function ContractEditPage() {
  return (
    <ContractLayout activeTab="edit">
      <EditBody />
    </ContractLayout>
  );
}
