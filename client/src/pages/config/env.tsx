import { useEffect, useState } from "react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EnvVariableRow } from "@/components/env/EnvVariableRow";
import { useEnvVariables } from "@/components/env/use-env-variables";
import { Info, Search } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  core: "Core",
  auth: "Authentication",
  integrations: "Integrations",
  platform: "Platform",
  dev: "Development",
};

export default function EnvPage() {
  usePageTitle("Environment Variables");
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const { variables, isLoading, saveOverride, clearOverride, isSaving, isClearing } =
    useEnvVariables();

  useEffect(() => {
    if (editing && !variables?.some((v) => v.name === editing)) setEditing(null);
  }, [variables, editing]);

  const needle = filter.trim().toLowerCase();
  const filtered = (variables ?? []).filter(
    (v) =>
      needle === "" ||
      v.name.toLowerCase().includes(needle) ||
      v.description.toLowerCase().includes(needle),
  );
  const categories = Array.from(new Set(filtered.map((v) => v.category)));

  return (
    <div className="space-y-6" data-testid="page-config-env">
      <div>
        <h1 className="text-2xl font-semibold">Environment Variables</h1>
        <p className="text-muted-foreground mt-1">
          View registered environment variables and set in-app overrides.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Values set in the real environment are locked and always win over
          overrides. To release a stale deployment variable, set it to{" "}
          <code className="font-mono">__UNSET__</code> (or empty) in the
          deployment settings — the app then treats it as not set. When a
          variable says when its changes are picked up, that is shown on the
          variable itself: <em>applies immediately</em> means the next use
          reads the new value, <em>restart to apply</em> means the app reads it
          only while starting. Variables that say neither have not been
          classified. A secret's value is never shown; instead it carries a
          fingerprint of that value, so two installations showing the same
          fingerprint hold the same secret. A fingerprint is not a value and
          cannot be used as one.
        </AlertDescription>
      </Alert>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name…"
          className="pl-8"
          data-testid="env-filter"
        />
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {!isLoading && needle !== "" && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="env-filter-empty">
          No matching variables.
        </p>
      )}

      {categories.map((category) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle>{CATEGORY_LABELS[category] ?? category}</CardTitle>
            <CardDescription>
              {filtered.filter((v) => v.category === category).length} variables
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {filtered
              .filter((v) => v.category === category)
              .map((v) => (
                <EnvVariableRow
                  key={v.name}
                  variable={v}
                  editing={editing === v.name}
                  onEditingChange={(open) => setEditing(open ? v.name : null)}
                  saveOverride={saveOverride}
                  clearOverride={clearOverride}
                  saving={isSaving}
                  clearing={isClearing}
                />
              ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
