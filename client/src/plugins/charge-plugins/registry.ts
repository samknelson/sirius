import { ComponentType } from "react";

export interface ChargePluginConfigProps {
  pluginId: string;
}

export interface ChargePluginUIRegistration {
  pluginId: string;
  configComponent: ComponentType<ChargePluginConfigProps>;
  settingsToPayload?: (settings: any) => any;
  payloadToSettings?: (payload: any) => any;
}

class ChargePluginUIRegistry {
  private plugins: Map<string, ChargePluginUIRegistration> = new Map();

  register(registration: ChargePluginUIRegistration): void {
    const id = registration.pluginId;
    if (this.plugins.has(id)) {
      console.warn(`Charge plugin UI "${id}" is already registered`);
      return;
    }
    this.plugins.set(id, registration);
  }

  get(pluginId: string): ChargePluginUIRegistration | undefined {
    return this.plugins.get(pluginId);
  }

  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  getAll(): ChargePluginUIRegistration[] {
    return Array.from(this.plugins.values());
  }
}

export const chargePluginUIRegistry = new ChargePluginUIRegistry();

export function registerChargePluginUI(registration: ChargePluginUIRegistration): void {
  chargePluginUIRegistry.register(registration);
}
