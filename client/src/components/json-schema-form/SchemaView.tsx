import { useQuery } from "@tanstack/react-query";
import type { RJSFSchema } from "@rjsf/utils";
import type { JsonSchema } from "@shared/json-schema-form";
import { Loader2 } from "lucide-react";

interface OptionItem {
  id: string;
  name: string;
}

export interface SchemaViewProps {
  schema: JsonSchema | RJSFSchema;
  value: unknown;
  /**
   * Property keys to skip rendering (useful when surrounding UI
   * already shows them, e.g. `appliesTo` mirrored on the rule card).
   */
  omitKeys?: string[];
  /**
   * If true, properties whose value is undefined / null / empty
   * string / empty array are dropped instead of rendering an em-dash.
   */
  hideEmpty?: boolean;
  /** Test id prefix applied to each row's <dd>. */
  testIdPrefix?: string;
}

const EMPTY = "—";

/**
 * Read-only counterpart to `SchemaForm`. Walks the same JSON Schema
 * (including our vendor extensions: `enum/enumNames`,
 * `x-options-resource`) and renders a compact label/value summary
 * suitable for inline display inside cards or list rows.
 *
 * Pure client component. Reuses the `["/api/options", type]` query
 * key so option lookups share cache with `RemoteOptionsWidget`.
 */
export function SchemaView(props: SchemaViewProps) {
  return <SchemaViewInner {...props} depth={0} />;
}

interface SchemaViewInnerProps extends SchemaViewProps {
  depth: number;
}

function SchemaViewInner({
  schema,
  value,
  omitKeys = [],
  hideEmpty = false,
  testIdPrefix,
  depth,
}: SchemaViewInnerProps) {
  const props = (schema as { properties?: Record<string, RJSFSchema> })
    .properties;
  if (!props) return null;
  const obj = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const keys = Object.keys(props).filter((k) => !omitKeys.includes(k));
  const rows = keys.flatMap((key) => {
    const sub = props[key];
    const v = obj[key];
    if (hideEmpty && isEmpty(v)) return [];
    return [{ key, sub, v }];
  });
  if (rows.length === 0) return null;
  return (
    <dl
      className={
        depth === 0
          ? "grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm"
          : "grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm pl-3 border-l border-border"
      }
    >
      {rows.map(({ key, sub, v }) => {
        const title = (sub as { title?: string }).title || key;
        const tid = testIdPrefix
          ? `${testIdPrefix}-${key}`
          : `schema-view-${key}`;
        return (
          <div key={key} className="contents">
            <dt className="font-medium text-foreground" data-testid={`${tid}-label`}>
              {title}
            </dt>
            <dd className="text-muted-foreground" data-testid={tid}>
              <ValueRenderer
                schema={sub}
                value={v}
                hideEmpty={hideEmpty}
                depth={depth}
                testIdPrefix={tid}
              />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * True when at least one property of a nested object would render a
 * row given the current `hideEmpty` setting. Used to suppress empty
 * inner <dl>s that would otherwise leave a blank value cell.
 */
function hasRenderableChildren(
  schema: RJSFSchema,
  value: unknown,
  hideEmpty: boolean,
): boolean {
  if (!hideEmpty) return true;
  const props = (schema as { properties?: Record<string, RJSFSchema> })
    .properties;
  if (!props) return false;
  const obj = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  for (const key of Object.keys(props)) {
    if (!isEmpty(obj[key])) return true;
  }
  return false;
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string" && v === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

interface ValueRendererProps {
  schema: RJSFSchema;
  value: unknown;
  hideEmpty: boolean;
  depth: number;
  testIdPrefix: string;
}

function ValueRenderer({
  schema,
  value,
  hideEmpty,
  depth,
  testIdPrefix,
}: ValueRendererProps) {
  const subAny = schema as Record<string, unknown>;
  const optionsResource = subAny["x-options-resource"];
  const isArray = (schema as { type?: string }).type === "array";

  // Remote options (single or multi).
  if (typeof optionsResource === "string") {
    if (isEmpty(value)) return <span>{EMPTY}</span>;
    return (
      <OptionsResolvedValue
        type={optionsResource}
        value={value}
        isArray={isArray}
      />
    );
  }

  // Nested object: recurse into another <dl>. If hideEmpty drops every
  // child row the inner <dl> renders nothing — fall back to em-dash so
  // the value cell isn't visibly blank.
  if ((schema as { type?: string }).type === "object") {
    if (isEmpty(value) || !hasRenderableChildren(schema, value, hideEmpty))
      return <span>{EMPTY}</span>;
    return (
      <SchemaViewInner
        schema={schema}
        value={value}
        hideEmpty={hideEmpty}
        depth={depth + 1}
        testIdPrefix={testIdPrefix}
      />
    );
  }

  // Plain array (no remote options).
  if (isArray) {
    if (!Array.isArray(value) || value.length === 0)
      return <span>{EMPTY}</span>;
    return <span>{value.map((v) => formatScalar(v)).join(", ")}</span>;
  }

  if (isEmpty(value)) return <span>{EMPTY}</span>;
  return <span>{formatEnumOrScalar(schema, value)}</span>;
}

/**
 * Map an enum value to its `enumNames` label if defined; otherwise
 * fall back to the scalar formatter.
 */
function formatEnumOrScalar(schema: RJSFSchema, value: unknown): string {
  const enumValues = (schema as { enum?: unknown[] }).enum;
  const enumNames = (schema as { enumNames?: string[] }).enumNames;
  if (Array.isArray(enumValues) && Array.isArray(enumNames)) {
    const idx = enumValues.indexOf(value);
    if (idx >= 0 && typeof enumNames[idx] === "string") return enumNames[idx];
  }
  return formatScalar(value);
}

function formatScalar(v: unknown): string {
  if (v === undefined || v === null) return EMPTY;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function OptionsResolvedValue({
  type,
  value,
  isArray,
}: {
  type: string;
  value: unknown;
  isArray: boolean;
}) {
  const { data, isLoading } = useQuery<OptionItem[]>({
    queryKey: ["/api/options", type],
  });
  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading…
      </span>
    );
  }
  const list = data ?? [];
  const lookup = (id: unknown): string => {
    if (typeof id !== "string") return formatScalar(id);
    const opt = list.find((o) => o.id === id);
    return opt ? opt.name : id;
  };
  if (isArray) {
    if (!Array.isArray(value) || value.length === 0) return <span>{EMPTY}</span>;
    return <span>{value.map(lookup).join(", ")}</span>;
  }
  return <span>{lookup(value)}</span>;
}
