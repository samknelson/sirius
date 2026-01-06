import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Loader2, Save, RotateCcw, Type, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useTerminology } from "@/contexts/TerminologyContext";
import { TERM_REGISTRY, type TermDefinition, type TerminologyDictionary } from "@shared/terminology";
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

interface TermEditorProps {
  termKey: string;
  definition: TermDefinition;
  currentSingular: string;
  currentPlural: string;
  onChange: (key: string, singular: string, plural: string) => void;
}

function TermEditor({ termKey, definition, currentSingular, currentPlural, onChange }: TermEditorProps) {
  return (
    <Card data-testid={`card-term-${termKey}`}>
      <CardHeader>
        <CardTitle className="text-lg">{definition.label}</CardTitle>
        <CardDescription>{definition.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${termKey}-singular`}>Singular</Label>
            <Input
              id={`${termKey}-singular`}
              value={currentSingular}
              onChange={(e) => onChange(termKey, e.target.value, currentPlural)}
              placeholder={definition.defaults.singular}
              data-testid={`input-term-${termKey}-singular`}
            />
            <p className="text-xs text-muted-foreground">
              Default: {definition.defaults.singular}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${termKey}-plural`}>Plural</Label>
            <Input
              id={`${termKey}-plural`}
              value={currentPlural}
              onChange={(e) => onChange(termKey, currentSingular, e.target.value)}
              placeholder={definition.defaults.plural}
              data-testid={`input-term-${termKey}-plural`}
            />
            <p className="text-xs text-muted-foreground">
              Default: {definition.defaults.plural}
            </p>
          </div>
        </div>
        <div className="rounded-md bg-muted p-3 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Eye className="h-4 w-4" />
            Preview
          </div>
          <p className="text-sm text-muted-foreground">
            Singular: &ldquo;Assign a <strong>{currentSingular || definition.defaults.singular}</strong> to this worker&rdquo;
          </p>
          <p className="text-sm text-muted-foreground">
            Plural: &ldquo;This worker has no <strong>{currentPlural || definition.defaults.plural}</strong>&rdquo;
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TerminologyConfigPage() {
  usePageTitle("Terminology");
  const { toast } = useToast();
  const { terminology, updateTerminology, resetTerminology, isUpdating } = useTerminology();
  const [localTerms, setLocalTerms] = useState<TerminologyDictionary>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setLocalTerms(terminology);
    setHasChanges(false);
  }, [terminology]);

  const handleTermChange = (key: string, singular: string, plural: string) => {
    setLocalTerms(prev => ({
      ...prev,
      [key]: { singular, plural }
    }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      await updateTerminology(localTerms);
      setHasChanges(false);
      toast({
        title: "Terminology Updated",
        description: "Your custom terminology has been saved and is now active.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save terminology.",
        variant: "destructive",
      });
    }
  };

  const handleReset = async () => {
    try {
      await resetTerminology();
      setHasChanges(false);
      toast({
        title: "Terminology Reset",
        description: "All terms have been restored to their defaults.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to reset terminology.",
        variant: "destructive",
      });
    }
  };

  const termKeys = Object.keys(TERM_REGISTRY);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Type className="h-6 w-6" />
            Terminology
          </h1>
          <p className="text-muted-foreground mt-1">
            Customize the terms used throughout the application to match your organization&apos;s vocabulary.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={isUpdating} data-testid="button-reset-terminology">
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset to Defaults
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset Terminology?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will restore all terms to their default values. Any customizations you have made will be lost.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-reset-cancel">Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleReset} data-testid="button-reset-confirm">
                  Reset All
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button 
            onClick={handleSave} 
            disabled={!hasChanges || isUpdating}
            data-testid="button-save-terminology"
          >
            {isUpdating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {termKeys.map(key => {
          const definition = TERM_REGISTRY[key];
          const current = localTerms[key] || terminology[key] || definition.defaults;
          return (
            <TermEditor
              key={key}
              termKey={key}
              definition={definition}
              currentSingular={current.singular}
              currentPlural={current.plural}
              onChange={handleTermChange}
            />
          );
        })}
      </div>

      {termKeys.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No configurable terms are currently defined.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
