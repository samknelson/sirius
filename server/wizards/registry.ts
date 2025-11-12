import { WizardTypeDefinition } from './base.js';
import { FeedWizard } from './feed.js';

export class WizardFieldsUnsupportedError extends Error {
  constructor(wizardTypeName: string) {
    super(`Wizard type "${wizardTypeName}" does not support field definitions. Only feed-enabled wizards provide field metadata.`);
    this.name = 'WizardFieldsUnsupportedError';
  }
}

class WizardTypeRegistry {
  private types: Map<string, WizardTypeDefinition> = new Map();

  register(wizardType: WizardTypeDefinition): void {
    if (this.types.has(wizardType.name)) {
      throw new Error(`Wizard type "${wizardType.name}" is already registered`);
    }
    this.types.set(wizardType.name, wizardType);
  }

  get(name: string): WizardTypeDefinition | undefined {
    return this.types.get(name);
  }

  getAll(): WizardTypeDefinition[] {
    return Array.from(this.types.values());
  }

  getAllNames(): string[] {
    return Array.from(this.types.keys());
  }

  has(name: string): boolean {
    return this.types.has(name);
  }

  getFeedTypes(): WizardTypeDefinition[] {
    return this.getAll().filter(type => type.isFeed);
  }

  getNonFeedTypes(): WizardTypeDefinition[] {
    return this.getAll().filter(type => !type.isFeed);
  }

  isMonthlyWizard(name: string): boolean {
    const wizardType = this.get(name);
    return wizardType?.isMonthly === true;
  }

  async validateType(name: string): Promise<{ valid: boolean; error?: string }> {
    if (!this.has(name)) {
      return {
        valid: false,
        error: `Unknown wizard type: ${name}. Available types: ${this.getAllNames().join(', ')}`
      };
    }
    return { valid: true };
  }

  async getStepsForType(name: string): Promise<any[]> {
    const wizardType = this.get(name);
    if (!wizardType) {
      throw new Error(`Wizard type "${name}" not found`);
    }
    return await wizardType.getSteps();
  }

  async getStatusesForType(name: string): Promise<any[]> {
    const wizardType = this.get(name);
    if (!wizardType) {
      throw new Error(`Wizard type "${name}" not found`);
    }
    return await wizardType.getStatuses();
  }

  async getFieldsForType(name: string): Promise<any[]> {
    const wizardType = this.get(name);
    if (!wizardType) {
      throw new Error(`Wizard type "${name}" not found`);
    }
    
    // Type guard: only feed wizards support field definitions
    if (!(wizardType instanceof FeedWizard)) {
      throw new WizardFieldsUnsupportedError(name);
    }
    
    // Check if the specific feed wizard implements getFields
    if (typeof wizardType.getFields !== 'function') {
      throw new WizardFieldsUnsupportedError(name);
    }
    
    return await wizardType.getFields();
  }

  async getLaunchArgumentsForType(name: string): Promise<any[]> {
    const wizardType = this.get(name);
    if (!wizardType) {
      throw new Error(`Wizard type "${name}" not found`);
    }
    
    if (typeof wizardType.getLaunchArguments === 'function') {
      return await wizardType.getLaunchArguments();
    }
    
    return [];
  }
}

export const wizardRegistry = new WizardTypeRegistry();

export function registerWizardType(wizardType: WizardTypeDefinition): void {
  wizardRegistry.register(wizardType);
}

export function getWizardType(name: string): WizardTypeDefinition | undefined {
  return wizardRegistry.get(name);
}

export function getAllWizardTypes(): WizardTypeDefinition[] {
  return wizardRegistry.getAll();
}
