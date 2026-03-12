import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { GenericOptionsPage } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Ban, HelpCircle } from "lucide-react";

interface OptionsDefinition {
  type: string;
  displayName: string;
  description?: string;
  singularName: string;
  pluralName: string;
  requiredComponent?: string;
}

export default function DynamicOptionsPage() {
  const params = useParams<{ type: string }>();
  const optionsType = params.type || "";
  const auth = useAuth();
  
  const { data: definition, isLoading, isError } = useQuery<OptionsDefinition>({
    queryKey: ['/api/options', optionsType, 'definition'],
    enabled: !!optionsType,
  });
  
  if (!auth || isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  
  if (isError || !definition) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-muted-foreground">
              <HelpCircle className="h-5 w-5" />
              Options Type Not Found
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              The options type "{optionsType}" does not exist or is not available.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (definition.requiredComponent && !auth.hasComponent(definition.requiredComponent)) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-muted-foreground">
              <Ban className="h-5 w-5" />
              Feature Not Available
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Access to {definition.displayName} requires the "{definition.requiredComponent}" feature to be enabled.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  return <GenericOptionsPage optionsType={optionsType} />;
}
