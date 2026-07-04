import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Settings,
  Building,
  Building2,
  Factory,
  Store,
  Warehouse,
  Home,
  Landmark,
  Hospital,
} from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

const iconMap: Record<string, React.ComponentType<any>> = {
  Building,
  Building2,
  Factory,
  Store,
  Warehouse,
  Home,
  Landmark,
  Hospital,
};

/**
 * Employer attributes step: type, industry, benefit funds and ledger
 * accounts. Every change persists through the dispatcher submit route,
 * sending the full attribute set (the server replaces all four keys).
 */
export function AttributesStep({
  wizardId,
  step,
  data,
}: WizardStepComponentProps) {
  const { toast } = useToast();
  const [typeId, setTypeId] = useState<string | null>(data?.typeId || null);
  const [industryId, setIndustryId] = useState<string | null>(
    data?.industryId || null,
  );
  const [selectedBenefitIds, setSelectedBenefitIds] = useState<string[]>(
    data?.benefitIds || [],
  );
  const [selectedLedgerAccountIds, setSelectedLedgerAccountIds] = useState<
    string[]
  >(data?.ledgerAccountIds || []);

  const { data: employerTypes = [] } = useQuery<any[]>({
    queryKey: ["/api/options/employer-type"],
  });
  const { data: industries = [] } = useQuery<any[]>({
    queryKey: ["/api/options/industry"],
  });
  const { data: trustBenefits = [] } = useQuery<any[]>({
    queryKey: ["/api/trust-benefits"],
  });
  const { data: ledgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: {
      typeId: string | null;
      industryId: string | null;
      benefitIds: string[];
      ledgerAccountIds: string[];
    }) =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`, {
        input: updates,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveAttributes = (overrides?: Partial<{
    typeId: string | null;
    industryId: string | null;
    benefitIds: string[];
    ledgerAccountIds: string[];
  }>) => {
    updateMutation.mutate({
      typeId: overrides?.typeId !== undefined ? overrides.typeId : typeId,
      industryId:
        overrides?.industryId !== undefined ? overrides.industryId : industryId,
      benefitIds:
        overrides?.benefitIds !== undefined
          ? overrides.benefitIds
          : selectedBenefitIds,
      ledgerAccountIds:
        overrides?.ledgerAccountIds !== undefined
          ? overrides.ledgerAccountIds
          : selectedLedgerAccountIds,
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Settings className="text-primary" size={20} />
          </div>
          <div>
            <CardTitle>Employer Attributes</CardTitle>
            <CardDescription>
              Configure the employer type, industry, and benefit fund
              participation
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <Label className="text-sm font-medium mb-2 block">Employer Type</Label>
            <Select
              value={typeId || "__none__"}
              onValueChange={(value) => {
                const newValue = value === "__none__" ? null : value;
                setTypeId(newValue);
                saveAttributes({ typeId: newValue });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select type (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">None</span>
                </SelectItem>
                {employerTypes.map((type: any) => {
                  const iconName = type.data?.icon;
                  const IconComponent = iconName ? iconMap[iconName] : Building;
                  return (
                    <SelectItem key={type.id} value={type.id}>
                      <div className="flex items-center gap-2">
                        <IconComponent className="text-muted-foreground" size={16} />
                        <span>{type.name}</span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm font-medium mb-2 block">Industry</Label>
            <Select
              value={industryId || "__none__"}
              onValueChange={(value) => {
                const newValue = value === "__none__" ? null : value;
                setIndustryId(newValue);
                saveAttributes({ industryId: newValue });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select industry (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">None</span>
                </SelectItem>
                {industries.map((ind: any) => (
                  <SelectItem key={ind.id} value={ind.id}>
                    {ind.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {trustBenefits.length > 0 && (
          <div>
            <Label className="text-sm font-medium mb-3 block">
              Trust Benefit Funds
            </Label>
            <p className="text-sm text-muted-foreground mb-3">
              Select which benefit funds this employer participates in
            </p>
            <div className="space-y-3 border rounded-lg p-4">
              {trustBenefits.map((benefit: any) => (
                <div key={benefit.id} className="flex items-center space-x-3">
                  <Checkbox
                    id={`benefit-${benefit.id}`}
                    checked={selectedBenefitIds.includes(benefit.id)}
                    onCheckedChange={(checked) => {
                      const newIds = checked
                        ? [...selectedBenefitIds, benefit.id]
                        : selectedBenefitIds.filter((id: string) => id !== benefit.id);
                      setSelectedBenefitIds(newIds);
                      saveAttributes({ benefitIds: newIds });
                    }}
                  />
                  <Label htmlFor={`benefit-${benefit.id}`} className="cursor-pointer">
                    {benefit.name}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )}

        {ledgerAccounts.length > 0 && (
          <div>
            <Label className="text-sm font-medium mb-3 block">Ledger Accounts</Label>
            <p className="text-sm text-muted-foreground mb-3">
              Select which ledger accounts to link to this employer for billing
            </p>
            <div className="space-y-3 border rounded-lg p-4">
              {ledgerAccounts.map((account: any) => (
                <div key={account.id} className="flex items-center space-x-3">
                  <Checkbox
                    id={`ledger-${account.id}`}
                    checked={selectedLedgerAccountIds.includes(account.id)}
                    onCheckedChange={(checked) => {
                      const newIds = checked
                        ? [...selectedLedgerAccountIds, account.id]
                        : selectedLedgerAccountIds.filter(
                            (id: string) => id !== account.id,
                          );
                      setSelectedLedgerAccountIds(newIds);
                      saveAttributes({ ledgerAccountIds: newIds });
                    }}
                  />
                  <Label htmlFor={`ledger-${account.id}`} className="cursor-pointer">
                    {account.name}
                    {account.description && (
                      <span className="text-muted-foreground ml-2 text-xs">
                        - {account.description}
                      </span>
                    )}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
