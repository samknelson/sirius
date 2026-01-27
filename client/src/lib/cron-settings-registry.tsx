import { ComponentType } from "react";

export interface CronSettingsComponentProps {
  clientState: Record<string, unknown>;
  values: Record<string, unknown>;
  onSave: (data: unknown) => Promise<void>;
  isSaving: boolean;
}

type CronSettingsComponent = ComponentType<CronSettingsComponentProps>;

const registry = new Map<string, CronSettingsComponent>();

export function registerCronSettingsComponent(
  componentId: string,
  component: CronSettingsComponent
): void {
  registry.set(componentId, component);
}

export function getCronSettingsComponent(
  componentId: string
): CronSettingsComponent | undefined {
  return registry.get(componentId);
}

export function hasCronSettingsComponent(componentId: string): boolean {
  return registry.has(componentId);
}
