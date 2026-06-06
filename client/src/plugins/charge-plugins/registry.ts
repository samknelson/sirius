export interface ChargePluginConfigRow<TSettings = Record<string, unknown>> {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  account: string | null;
  name: string | null;
  settings: TSettings;
}
