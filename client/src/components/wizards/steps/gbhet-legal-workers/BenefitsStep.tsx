import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, Gift, CheckCircle2, ArrowRight, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface BenefitsStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface FeedField {
  id: string;
  name: string;
  type: string;
  required: boolean;
  description?: string;
  isBenefitEligibility?: boolean;
}

interface TrustBenefit {
  id: string;
  name: string;
  benefitTypeName?: string;
  benefitTypeIcon?: string;
  isActive: boolean;
}

interface BenefitFieldConfig {
  fieldId: string;
  benefitId: string;
  benefitName?: string;
}

export function BenefitsStep({ wizardId, wizardType, data, onDataChange }: BenefitsStepProps) {
  const { toast } = useToast();
  const [benefitConfig, setBenefitConfig] = useState<BenefitFieldConfig[]>(data?.benefitConfig || []);

  const { data: fields = [], isLoading: fieldsLoading } = useQuery<FeedField[]>({
    queryKey: ["/api/wizard-types", wizardType, "fields"],
  });

  const { data: trustBenefits = [], isLoading: benefitsLoading } = useQuery<TrustBenefit[]>({
    queryKey: ["/api/trust-benefits"],
  });

  const columnMapping = data?.columnMapping || {};

  const mappedBenefitFields = useMemo(() => {
    const mappedValues = Object.values(columnMapping).filter(v => v && v !== '_unmapped');
    return fields.filter(f => 
      f.type === 'benefit' && 
      f.isBenefitEligibility && 
      mappedValues.includes(f.id)
    );
  }, [fields, columnMapping]);

  const launchArguments = data?.launchArguments || {};
  const uploadYear = launchArguments.year;
  const uploadMonth = launchArguments.month;

  const targetMonth = useMemo(() => {
    if (!uploadYear || !uploadMonth) return null;
    let month = uploadMonth + 3;
    let year = uploadYear;
    if (month > 12) {
      month -= 12;
      year += 1;
    }
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'];
    return { month, year, display: `${monthNames[month - 1]} ${year}` };
  }, [uploadYear, uploadMonth]);

  useEffect(() => {
    if (data?.benefitConfig && JSON.stringify(data.benefitConfig) !== JSON.stringify(benefitConfig)) {
      setBenefitConfig(data.benefitConfig);
    }
  }, [data?.benefitConfig]);

  const saveMutation = useMutation({
    mutationFn: async (config: BenefitFieldConfig[]) => {
      return apiRequest("PATCH", `/api/wizards/${wizardId}`, {
        data: {
          ...data,
          benefitConfig: config
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({
        title: "Success",
        description: "Benefit configuration saved",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save benefit configuration",
        variant: "destructive",
      });
    },
  });

  const handleBenefitChange = (fieldId: string, benefitId: string) => {
    const benefit = trustBenefits.find(b => b.id === benefitId);
    const newConfig = benefitConfig.filter(c => c.fieldId !== fieldId);
    
    if (benefitId && benefitId !== '_none') {
      newConfig.push({
        fieldId,
        benefitId,
        benefitName: benefit?.name
      });
    }
    
    setBenefitConfig(newConfig);
  };

  const handleSave = () => {
    saveMutation.mutate(benefitConfig);
  };

  const getBenefitForField = (fieldId: string): string => {
    const config = benefitConfig.find(c => c.fieldId === fieldId);
    return config?.benefitId || '_none';
  };

  const activeBenefits = trustBenefits.filter(b => b.isActive);

  if (fieldsLoading || benefitsLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </CardContent>
      </Card>
    );
  }

  if (mappedBenefitFields.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5" />
            Configure Benefits
          </CardTitle>
          <CardDescription>
            Associate benefit eligibility columns with trust benefits
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>No Benefit Fields Mapped</AlertTitle>
            <AlertDescription>
              No benefit eligibility fields have been mapped in the previous step. 
              You can proceed to the next step, or go back and map benefit eligibility columns 
              if your file contains worker benefit data.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gift className="h-5 w-5" />
          Configure Benefits
        </CardTitle>
        <CardDescription>
          Associate each benefit eligibility column with a trust benefit
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {targetMonth && (
          <Alert className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertTitle className="text-blue-900 dark:text-blue-100">Benefit Effective Date</AlertTitle>
            <AlertDescription className="text-blue-800 dark:text-blue-200">
              Worker Monthly Benefit (WMB) records will be created for <strong>{targetMonth.display}</strong> 
              (3 months after the upload month).
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <h3 className="text-sm font-medium text-foreground">Mapped Benefit Fields</h3>
          
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File Column</TableHead>
                <TableHead>
                  <ArrowRight className="h-4 w-4 inline" />
                </TableHead>
                <TableHead>Trust Benefit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappedBenefitFields.map((field) => (
                <TableRow key={field.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{field.name}</Badge>
                      {field.description && (
                        <span className="text-xs text-muted-foreground">{field.description}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={getBenefitForField(field.id)}
                      onValueChange={(value) => handleBenefitChange(field.id, value)}
                    >
                      <SelectTrigger className="w-[300px]">
                        <SelectValue placeholder="Select a benefit..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">
                          <span className="text-muted-foreground">-- No benefit (skip) --</span>
                        </SelectItem>
                        {activeBenefits.map((benefit) => (
                          <SelectItem key={benefit.id} value={benefit.id}>
                            <div className="flex items-center gap-2">
                              <span>{benefit.name}</span>
                              {benefit.benefitTypeName && (
                                <Badge variant="outline" className="text-xs">
                                  {benefit.benefitTypeName}
                                </Badge>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {benefitConfig.filter(c => c.benefitId).length > 0 && (
          <Alert className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-900 dark:text-green-100">Configuration Summary</AlertTitle>
            <AlertDescription className="text-green-800 dark:text-green-200">
              {benefitConfig.filter(c => c.benefitId).length} benefit field(s) configured. 
              Workers with truthy values (Yes, Y, 1, X, etc.) in these columns will receive the corresponding benefits.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end">
          <Button 
            onClick={handleSave} 
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Configuration'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
