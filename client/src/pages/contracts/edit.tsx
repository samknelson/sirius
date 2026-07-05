import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { ContractLayout, useContractLayout } from "@/components/layouts/ContractLayout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function EditBody() {
  const { contract } = useContractLayout();
  const { toast } = useToast();
  const [name, setName] = useState(contract.name);
  const [stubSections, setStubSections] = useState(contract.stubSections);
  const [saving, setSaving] = useState(false);

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

  return (
    <Card className="max-w-2xl">
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
  );
}

export default function ContractEditPage() {
  return (
    <ContractLayout activeTab="edit">
      <EditBody />
    </ContractLayout>
  );
}
