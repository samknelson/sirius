import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Plus, Edit } from "lucide-react";
import type { ChargePluginConfigProps } from "../registry";
import { getCurrentRateValue } from "@/lib/rateHistory";

interface LedgerAccount {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

interface Employer {
  id: string;
  name: string;
  isActive: boolean;
}

interface ChargePluginConfig {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  settings: {
    accountId?: string;
    rateHistory?: Array<{
      effectiveDate: string;
      rate: number;
    }>;
  };
}

export default function HourFixedConfigList({ pluginId }: ChargePluginConfigProps) {
  // Fetch existing configurations for this plugin
  const { data: configs = [], isLoading: isLoadingConfigs } = useQuery<ChargePluginConfig[]>({
    queryKey: ["/api/charge-plugin-configs/by-plugin", pluginId],
    queryFn: async () => {
      const response = await fetch(`/api/charge-plugin-configs/by-plugin/${pluginId}`);
      if (!response.ok) throw new Error("Failed to fetch configurations");
      return response.json();
    },
  });

  // Fetch ledger accounts for displaying account names
  const { data: accounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  // Fetch employers for displaying employer names
  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const globalConfig = configs.find(c => c.scope === "global");
  const employerConfigs = configs.filter(c => c.scope === "employer");

  const getAccountName = (accountId?: string) => {
    if (!accountId) return "Not set";
    const account = accounts.find(a => a.id === accountId);
    return account ? account.name : accountId;
  };


  if (isLoadingConfigs) {
    return (
      <div className="p-8">
        <p>Loading configurations...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Hour - Fixed Rate Configurations</h1>
          <p className="text-muted-foreground mt-2">
            Manage hourly rate configurations for charging based on worker hours
          </p>
        </div>
        <Link href={`/config/ledger/charge-plugins/${pluginId}/new`}>
          <Button data-testid="button-new-config">
            <Plus className="mr-2 h-4 w-4" />
            New Configuration
          </Button>
        </Link>
      </div>

      {/* Global Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Global Configuration</CardTitle>
          <CardDescription>
            Default configuration applied to all employers unless overridden
          </CardDescription>
        </CardHeader>
        <CardContent>
          {globalConfig ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-md">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">Status:</span>
                    <span className={`text-sm ${globalConfig.enabled ? "text-green-600" : "text-muted-foreground"}`}>
                      {globalConfig.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium">Account:</span>
                    <span className="text-sm">{getAccountName(globalConfig.settings?.accountId)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium">Rate Entries:</span>
                    <span className="text-sm">{globalConfig.settings?.rateHistory?.length || 0}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium">Current Rate:</span>
                    <span className="text-sm">
                      {(() => {
                        const rate = getCurrentRateValue(globalConfig.settings?.rateHistory || []);
                        return rate !== null ? `$${rate.toFixed(2)}/hour` : "Not set";
                      })()}
                    </span>
                  </div>
                </div>
                <Link href={`/config/ledger/charge-plugins/${pluginId}/edit/${globalConfig.id}`}>
                  <Button variant="outline" size="sm" data-testid="button-edit-global">
                    <Edit className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">No global configuration set</p>
              <Link href={`/config/ledger/charge-plugins/${pluginId}/new`}>
                <Button variant="outline" data-testid="button-create-global">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Global Configuration
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Employer-Specific Configurations */}
      <Card>
        <CardHeader>
          <CardTitle>Employer-Specific Configurations</CardTitle>
          <CardDescription>
            Override the global configuration for specific employers
          </CardDescription>
        </CardHeader>
        <CardContent>
          {employerConfigs.length > 0 ? (
            <div className="space-y-3">
              {employerConfigs.map((config) => {
                const employer = employers.find(e => e.id === config.employerId);
                return (
                  <div key={config.id} className="flex items-center justify-between p-4 border rounded-md">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="font-medium">{employer?.name || config.employerId}</span>
                        <span className={`text-sm ${config.enabled ? "text-green-600" : "text-muted-foreground"}`}>
                          {config.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span>Account: {getAccountName(config.settings?.accountId)}</span>
                        <span>•</span>
                        <span>{config.settings?.rateHistory?.length || 0} rate(s)</span>
                        <span>•</span>
                        <span>
                          {(() => {
                            const rate = getCurrentRateValue(config.settings?.rateHistory || []);
                            return rate !== null ? `Current: $${rate.toFixed(2)}/hour` : "No current rate";
                          })()}
                        </span>
                      </div>
                    </div>
                    <Link href={`/config/ledger/charge-plugins/${pluginId}/edit/${config.id}`}>
                      <Button variant="outline" size="sm" data-testid={`button-edit-${config.id}`}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit
                      </Button>
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No employer-specific configurations</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
