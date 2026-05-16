/**
 * RETAINED FOR CHARGE PLUGINS ONLY (out of scope for Task #132).
 *
 * Trust eligibility, dispatch eligibility, and dispatch job-type
 * plugins all migrated to JSON Schema (`shared/json-schema-form.ts` +
 * `client/src/components/json-schema-form/`). Charge plugins still
 * import from this file and `client/src/components/plugin-config/`,
 * so these files remain until the follow-on charge-plugin migration.
 *
 * Do NOT use this descriptor type for any new code — author JSON
 * Schema and use `<SchemaForm>` / `<SchemaFormDialog>` instead.
 */
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
