import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useLocation } from "wouter";
import { Loader2, ArrowLeft } from "lucide-react";
import { CardcheckDefinition } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function CardcheckDefinitionEditPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formSiriusId, setFormSiriusId] = useState("");
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formCheckboxes, setFormCheckboxes] = useState<string[]>(["", "", ""]);
  const [formRateTitle, setFormRateTitle] = useState("");
  const [formRateDescription, setFormRateDescription] = useState("");

  const { data: definition, isLoading, error } = useQuery<CardcheckDefinition>({
    queryKey: ["/api/cardcheck/definition", id],
    enabled: !!id,
  });

  useEffect(() => {
    if (definition) {
      setFormSiriusId(definition.siriusId);
      setFormName(definition.name);
      setFormDescription(definition.description || "");
      setFormBody(definition.body || "");
      const existingCheckboxes = (definition.data as any)?.checkboxes || [];
      setFormCheckboxes([
        existingCheckboxes[0] || "",
        existingCheckboxes[1] || "",
        existingCheckboxes[2] || "",
      ]);
      const rateField = (definition.data as any)?.rateField;
      setFormRateTitle(rateField?.title || "");
      setFormRateDescription(rateField?.description || "");
    }
  }, [definition]);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<CardcheckDefinition>) => {
      return apiRequest("PATCH", `/api/cardcheck/definition/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cardcheck/definition", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/cardcheck/definitions"] });
      toast({
        title: "Success",
        description: "Cardcheck definition updated successfully.",
      });
      setLocation(`/cardcheck-definitions/${id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update cardcheck definition.",
        variant: "destructive",
      });
    },
  });

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

    const nonEmptyCheckboxes = formCheckboxes.filter(cb => cb.trim() !== "");
    const existingData = (definition?.data as any) || {};
    
    const rateField = formRateTitle.trim() 
      ? { title: formRateTitle.trim(), description: formRateDescription.trim() || undefined }
      : undefined;
    
    updateMutation.mutate({
      siriusId: formSiriusId.trim(),
      name: formName.trim(),
      description: formDescription.trim() || null,
      body: formBody.trim() || null,
      data: {
        ...existingData,
        checkboxes: nonEmptyCheckboxes.length > 0 ? nonEmptyCheckboxes : undefined,
        rateField,
      },
    });
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (error || !definition) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-destructive">Cardcheck definition not found.</p>
            <Link href="/cardcheck-definitions">
              <Button variant="outline" className="mt-4">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Definitions
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href={`/cardcheck-definitions/${id}`}>
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="heading-edit">
              Edit Cardcheck Definition
            </h1>
            <p className="text-muted-foreground font-mono text-sm">
              [{definition.siriusId}]
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Edit Definition</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-sirius-id">Sirius ID *</Label>
                <Input
                  id="edit-sirius-id"
                  value={formSiriusId}
                  onChange={(e) => setFormSiriusId(e.target.value)}
                  data-testid="input-sirius-id"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-name">Name *</Label>
                <Input
                  id="edit-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  data-testid="input-name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Enter description..."
                rows={3}
                data-testid="input-description"
              />
            </div>

            <div className="space-y-2">
              <Label>Body (HTML)</Label>
              <SimpleHtmlEditor
                value={formBody}
                onChange={setFormBody}
                placeholder="Enter body content..."
                data-testid="input-body"
              />
            </div>

            <div className="space-y-4">
              <div>
                <Label>Required Checkboxes (Optional)</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Add up to 3 checkbox statements that must be accepted before signing.
                </p>
              </div>
              {[0, 1, 2].map((index) => (
                <div key={index} className="space-y-2">
                  <Label htmlFor={`checkbox-${index}`} className="text-sm text-muted-foreground">
                    Checkbox {index + 1}
                  </Label>
                  <Input
                    id={`checkbox-${index}`}
                    value={formCheckboxes[index]}
                    onChange={(e) => {
                      const newCheckboxes = [...formCheckboxes];
                      newCheckboxes[index] = e.target.value;
                      setFormCheckboxes(newCheckboxes);
                    }}
                    placeholder={`e.g., I confirm that the information provided is accurate`}
                    data-testid={`input-checkbox-${index + 1}`}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <div>
                <Label>Rate Field (Optional)</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Configure a required rate/amount field that must be filled before signing.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rate-title" className="text-sm text-muted-foreground">
                  Field Title
                </Label>
                <Input
                  id="rate-title"
                  value={formRateTitle}
                  onChange={(e) => setFormRateTitle(e.target.value)}
                  placeholder="e.g., Hourly Rate, Monthly Fee, etc."
                  data-testid="input-rate-title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rate-description" className="text-sm text-muted-foreground">
                  Field Description
                </Label>
                <Input
                  id="rate-description"
                  value={formRateDescription}
                  onChange={(e) => setFormRateDescription(e.target.value)}
                  placeholder="e.g., Enter the agreed hourly rate in dollars"
                  data-testid="input-rate-description"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-border">
              <div className="flex items-center gap-2 flex-wrap">
                <Link href={`/cardcheck-definitions/${id}`}>
                  <Button variant="outline" data-testid="button-cancel">
                    Cancel
                  </Button>
                </Link>
                <Button
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  data-testid="button-save"
                >
                  {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save Changes
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
