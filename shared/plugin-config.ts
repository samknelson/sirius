export type PluginConfigFieldInputType =
  | "select-options"
  | "text"
  | "number"
  | "checkbox";

export interface PluginConfigFieldOption {
  value: string;
  label: string;
}

export interface PluginConfigField {
  name: string;
  label: string;
  inputType: PluginConfigFieldInputType;
  required: boolean;
  helperText?: string;
  selectOptionsType?: string;
  multiSelect?: boolean;
  options?: PluginConfigFieldOption[];
}
