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
  const [formData, setFormData] = useState("");

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
      setFormData(definition.data ? JSON.stringify(definition.data, null, 2) : "");
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
      setLocation(`/cardcheck/definition/${id}`);
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

    let parsedData = null;
    if (formData.trim()) {
      try {
        parsedData = JSON.parse(formData);
      } catch (e) {
        toast({
          title: "Validation Error",
          description: "Data field must be valid JSON.",
          variant: "destructive",
        });
        return;
      }
    }

    updateMutation.mutate({
      siriusId: formSiriusId.trim(),
      name: formName.trim(),
      description: formDescription.trim() || null,
      body: formBody.trim() || null,
      data: parsedData,
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
            <Link href="/cardcheck/definitions">
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
          <Link href={`/cardcheck/definition/${id}`}>
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

            <div className="space-y-2">
              <Label htmlFor="edit-data">Data (JSON)</Label>
              <Textarea
                id="edit-data"
                value={formData}
                onChange={(e) => setFormData(e.target.value)}
                placeholder='{"key": "value"}'
                rows={6}
                className="font-mono text-sm"
                data-testid="input-data"
              />
            </div>

            <div className="pt-4 border-t border-border">
              <div className="flex items-center gap-2 flex-wrap">
                <Link href={`/cardcheck/definition/${id}`}>
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
