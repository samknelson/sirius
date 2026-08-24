import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Plus, Trash2 } from "lucide-react";

type ProvisioningMode = "reject" | "create";

interface SamlRoleMapping {
  attribute: string;
  value: string | null;
  roleId: string;
}

interface AuthSettings {
  provisioning: Record<string, ProvisioningMode>;
  samlRoleMappings: SamlRoleMapping[];
}

interface AuthSettingsResponse {
  providers: { type: string; isDefault: boolean }[];
  settings: AuthSettings;
}

interface Role {
  id: string;
  name: string;
  description: string | null;
}

const PROVIDER_LABELS: Record<string, string> = {
  saml: "SAML",
  clerk: "Clerk",
  replit: "Replit",
  okta: "Okta",
  oauth: "OAuth",
  local: "Local",
};

/** Providers that support auto-provisioning (never local). */
const PROVISIONABLE = new Set(["saml", "clerk", "replit", "okta", "oauth"]);

export default function AuthSettingsPage() {
  usePageTitle("Auth Settings");
  const { toast } = useToast();

  const { data, isLoading } = useQuery<AuthSettingsResponse>({
    queryKey: ["/api/admin/auth-settings"],
  });

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
  });

  const [settings, setSettings] = useState<AuthSettings | null>(null);
  useEffect(() => {
    if (data?.settings && settings === null) {
      setSettings(data.settings);
    }
  }, [data, settings]);

  const saveMutation = useMutation({
    mutationFn: async (next: AuthSettings) =>
      apiRequest("PUT", "/api/admin/auth-settings", { settings: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/auth-settings"] });
      toast({ title: "Auth settings saved" });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to save auth settings"),
        variant: "destructive",
      });
    },
  });

  if (isLoading || !settings) {
    return (
      <div className="space-y-4 p-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const providers = data?.providers ?? [];
  const provisionableProviders = providers.filter((p) => PROVISIONABLE.has(p.type));
  const samlConfigured = providers.some((p) => p.type === "saml");

  const setMode = (provider: string, mode: ProvisioningMode) => {
    setSettings({
      ...settings,
      provisioning: { ...settings.provisioning, [provider]: mode },
    });
  };

  const updateMapping = (index: number, patch: Partial<SamlRoleMapping>) => {
    const next = settings.samlRoleMappings.slice();
    next[index] = { ...next[index], ...patch };
    setSettings({ ...settings, samlRoleMappings: next });
  };

  const mappingsValid = settings.samlRoleMappings.every(
    (m) => m.attribute.trim() !== "" && m.roleId !== "",
  );

  return (
    <div className="space-y-6 p-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Configured Authentication Systems
          </CardTitle>
          <CardDescription>
            Providers are configured through environment settings. This shows what is
            currently active.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {providers.length === 0 && (
              <span className="text-sm text-muted-foreground">No providers configured.</span>
            )}
            {providers.map((p) => (
              <Badge
                key={p.type}
                variant={p.isDefault ? "default" : "secondary"}
                data-testid={`badge-provider-${p.type}`}
              >
                {PROVIDER_LABELS[p.type] ?? p.type}
                {p.isDefault ? " (default)" : ""}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {provisionableProviders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Account Provisioning</CardTitle>
            <CardDescription>
              What happens when someone signs in through a provider but has no matching
              account. "Reject" (the default) turns them away; "Create" makes an active
              account from the provider's email and name and signs them in.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {provisionableProviders.map((p) => {
              const mode = settings.provisioning[p.type] ?? "reject";
              return (
                <div key={p.type} className="space-y-2">
                  <Label className="font-medium">{PROVIDER_LABELS[p.type] ?? p.type}</Label>
                  <RadioGroup
                    value={mode}
                    onValueChange={(v) => setMode(p.type, v as ProvisioningMode)}
                    className="space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem
                        value="reject"
                        id={`prov-${p.type}-reject`}
                        data-testid={`radio-provisioning-${p.type}-reject`}
                      />
                      <Label htmlFor={`prov-${p.type}-reject`} className="font-normal">
                        Reject sign-ins without an existing account
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem
                        value="create"
                        id={`prov-${p.type}-create`}
                        data-testid={`radio-provisioning-${p.type}-create`}
                      />
                      <Label htmlFor={`prov-${p.type}-create`} className="font-normal">
                        Create an account on first sign-in
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {samlConfigured && (
        <Card>
          <CardHeader>
            <CardTitle>SAML Role Mapping</CardTitle>
            <CardDescription>
              Grant roles based on SAML assertion attributes, checked on every sign-in.
              Roles granted here are managed by the provider: they are revoked
              automatically when the attribute no longer matches. Roles assigned locally
              are never touched. Leave the value blank to match any non-empty value.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {settings.samlRoleMappings.map((m, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Attribute</Label>
                  <Input
                    value={m.attribute}
                    onChange={(e) => updateMapping(i, { attribute: e.target.value })}
                    placeholder="e.g. groups"
                    className="w-48"
                    data-testid={`input-mapping-attribute-${i}`}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Value (blank = any)</Label>
                  <Input
                    value={m.value ?? ""}
                    onChange={(e) =>
                      updateMapping(i, { value: e.target.value === "" ? null : e.target.value })
                    }
                    placeholder="any"
                    className="w-48"
                    data-testid={`input-mapping-value-${i}`}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Role</Label>
                  <Select
                    value={m.roleId}
                    onValueChange={(v) => updateMapping(i, { roleId: v })}
                  >
                    <SelectTrigger className="w-48" data-testid={`select-mapping-role-${i}`}>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setSettings({
                      ...settings,
                      samlRoleMappings: settings.samlRoleMappings.filter((_, j) => j !== i),
                    })
                  }
                  data-testid={`button-remove-mapping-${i}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setSettings({
                  ...settings,
                  samlRoleMappings: [
                    ...settings.samlRoleMappings,
                    { attribute: "", value: null, roleId: "" },
                  ],
                })
              }
              data-testid="button-add-mapping"
            >
              <Plus className="h-4 w-4 mr-1" /> Add mapping
            </Button>
          </CardContent>
        </Card>
      )}

      <div>
        <Button
          onClick={() => saveMutation.mutate(settings)}
          disabled={saveMutation.isPending || !mappingsValid}
          data-testid="button-save-auth-settings"
        >
          {saveMutation.isPending ? "Saving..." : "Save Settings"}
        </Button>
        {!mappingsValid && (
          <p className="text-sm text-destructive mt-1">
            Every mapping needs an attribute and a role.
          </p>
        )}
      </div>
    </div>
  );
}
