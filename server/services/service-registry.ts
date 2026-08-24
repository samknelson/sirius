import { storage } from '../storage';
import type { 
  ServiceCategory, 
  ServiceProvider, 
  CategoryConfig, 
  ProviderConfig,
  ProviderFactory 
} from './comm/providers/base';
import { getConfigKey, categoryConfigSchema } from './comm/providers/base';
import { getEnvironmentVariable, registerEnvironmentVariables } from "../config/env-registry";

// changeTakesEffect: "restart" for all three. This module only reads them to
// pick a default provider, but each value is memoized further down by the
// provider that actually uses it (the Twilio credentials cache in
// server/lib/twilio-client.ts, the SendGrid client initialized once per
// provider instance), so a change does not reach the sending path in this
// process. Registration is last-one-wins across modules, so these must match
// the classifications in twilio-client.ts, the Twilio callback handler, and
// the SendGrid provider.
registerEnvironmentVariables([
  { name: "TWILIO_ACCOUNT_SID", description: "Twilio account SID for the SMS provider.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "TWILIO_AUTH_TOKEN", description: "Twilio auth token for the SMS provider (also validates status callbacks).", secret: true, category: "core", changeTakesEffect: "restart", },
  { name: "SENDGRID_API_KEY", description: "SendGrid API key for the sendgrid email provider.", secret: true, category: "core", changeTakesEffect: "restart", },
]);

type ProviderMap<T extends ServiceProvider> = Map<string, ProviderFactory<T>>;

class ServiceRegistry {
  private providerFactories: Map<ServiceCategory, ProviderMap<ServiceProvider>> = new Map();
  private activeProviders: Map<ServiceCategory, ServiceProvider> = new Map();
  private configCache: Map<ServiceCategory, { config: CategoryConfig; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 60000;

  registerProvider<T extends ServiceProvider>(
    category: ServiceCategory,
    providerId: string,
    factory: ProviderFactory<T>
  ): void {
    if (!this.providerFactories.has(category)) {
      this.providerFactories.set(category, new Map());
    }
    this.providerFactories.get(category)!.set(providerId, factory as ProviderFactory<ServiceProvider>);
  }

  getRegisteredProviders(category: ServiceCategory): string[] {
    const providers = this.providerFactories.get(category);
    return providers ? Array.from(providers.keys()) : [];
  }

  async getProviderInfo(category: ServiceCategory): Promise<Array<{ id: string; displayName: string; supportedFeatures: string[] }>> {
    const factories = this.providerFactories.get(category);
    if (!factories) return [];

    const info: Array<{ id: string; displayName: string; supportedFeatures: string[] }> = [];
    const entries = Array.from(factories.entries());
    for (const [id, factory] of entries) {
      const provider = factory.create();
      info.push({
        id,
        displayName: provider.displayName,
        supportedFeatures: provider.supportedFeatures,
      });
    }
    return info;
  }

  async getCategoryConfig(category: ServiceCategory): Promise<CategoryConfig> {
    const cached = this.configCache.get(category);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.config;
    }

    const configKey = getConfigKey(category);
    const variable = await storage.variables.getByName(configKey);
    
    let config: CategoryConfig;
    if (variable && variable.value) {
      const parsed = categoryConfigSchema.safeParse(variable.value);
      if (parsed.success) {
        config = parsed.data;
      } else {
        config = this.getDefaultConfig(category);
      }
    } else {
      config = this.getDefaultConfig(category);
    }

    this.configCache.set(category, { config, timestamp: Date.now() });
    return config;
  }

  async saveCategoryConfig(category: ServiceCategory, config: CategoryConfig): Promise<void> {
    const configKey = getConfigKey(category);
    const existingVar = await storage.variables.getByName(configKey);
    
    if (existingVar) {
      await storage.variables.update(existingVar.id, { value: config });
    } else {
      await storage.variables.create({ name: configKey, value: config });
    }

    this.configCache.set(category, { config, timestamp: Date.now() });
    this.activeProviders.delete(category);
  }

  async setDefaultProvider(category: ServiceCategory, providerId: string): Promise<void> {
    const factories = this.providerFactories.get(category);
    if (!factories?.has(providerId)) {
      throw new Error(`Provider '${providerId}' not registered for category '${category}'`);
    }

    const config = await this.getCategoryConfig(category);
    config.defaultProvider = providerId;
    await this.saveCategoryConfig(category, config);
  }

  async getProviderSettings(category: ServiceCategory, providerId: string): Promise<Record<string, unknown>> {
    const config = await this.getCategoryConfig(category);
    return config.providers[providerId]?.settings || {};
  }

  async saveProviderSettings(
    category: ServiceCategory, 
    providerId: string, 
    settings: Record<string, unknown>
  ): Promise<void> {
    const config = await this.getCategoryConfig(category);
    
    if (!config.providers[providerId]) {
      config.providers[providerId] = { enabled: true, settings: {} };
    }
    config.providers[providerId].settings = settings;
    
    await this.saveCategoryConfig(category, config);
  }

  async resolve<T extends ServiceProvider>(category: ServiceCategory): Promise<T> {
    const cached = this.activeProviders.get(category);
    if (cached) {
      return cached as T;
    }

    const config = await this.getCategoryConfig(category);
    const factories = this.providerFactories.get(category);
    
    if (!factories) {
      throw new Error(`No providers registered for category '${category}'`);
    }

    const factory = factories.get(config.defaultProvider);
    if (!factory) {
      const firstProvider = factories.keys().next().value;
      if (!firstProvider) {
        throw new Error(`No providers available for category '${category}'`);
      }
      const provider = factories.get(firstProvider)!.create();
      const providerSettings = config.providers[firstProvider]?.settings || {};
      await provider.configure(providerSettings);
      this.activeProviders.set(category, provider);
      return provider as T;
    }

    const provider = factory.create();
    const providerSettings = config.providers[config.defaultProvider]?.settings || {};
    await provider.configure(providerSettings);
    this.activeProviders.set(category, provider);
    return provider as T;
  }

  invalidateCache(category?: ServiceCategory): void {
    if (category) {
      this.configCache.delete(category);
      this.activeProviders.delete(category);
    } else {
      this.configCache.clear();
      this.activeProviders.clear();
    }
  }

  private getDefaultConfig(category: ServiceCategory): CategoryConfig {
    const registeredProviders = this.getRegisteredProviders(category);

    let defaultProvider = registeredProviders[0] || '';

    if (category === 'sms') {
      const hasTwilioCredentials = !!(
        getEnvironmentVariable("TWILIO_ACCOUNT_SID") &&
        getEnvironmentVariable("TWILIO_AUTH_TOKEN")
      );

      if (!hasTwilioCredentials && registeredProviders.includes('local')) {
        defaultProvider = 'local';
      } else if (hasTwilioCredentials && registeredProviders.includes('twilio')) {
        defaultProvider = 'twilio';
      }
    }

    if (category === 'email') {
      const hasSendGridCredentials = !!getEnvironmentVariable("SENDGRID_API_KEY");
      
      if (!hasSendGridCredentials && registeredProviders.includes('local')) {
        defaultProvider = 'local';
      } else if (hasSendGridCredentials && registeredProviders.includes('sendgrid')) {
        defaultProvider = 'sendgrid';
      }
    }
    
    const providers: Record<string, ProviderConfig> = {};
    for (const providerId of registeredProviders) {
      providers[providerId] = { enabled: true, settings: {} };
    }

    return { defaultProvider, providers };
  }
}

export const serviceRegistry = new ServiceRegistry();
