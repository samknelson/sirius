import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Maximize2 } from "lucide-react";
import {
  TemplateStudio,
  type StudioChannel,
  type StudioContext,
  type StudioField,
} from "./TemplateStudio";
import type { DeliveryFieldSpec } from "@shared/delivery-fields";
import type {
  TokenCatalogEntry,
  TokenFieldCatalog,
  TokenSegmentSpec,
} from "@shared/tokens";

// A host declares its fields; it should not have to reach past this
// entry point into the studio's internals to name their type.
export type { StudioChannel, StudioField } from "./TemplateStudio";

interface TokenStudioCatalog {
  rootNames?: string[];
  segments: TokenSegmentSpec[];
  fields?: TokenFieldCatalog;
  tokens: TokenCatalogEntry[];
  /** What each root may be previewed as — records and personas. */
  studioContext?: StudioContext;
}

interface TokenStudioBaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Preview presentation: email, sms, inapp, postal, or generic text. */
  channel: StudioChannel;
  fields: StudioField[];
  values: Record<string, string>;
  onValueChange: (key: string, value: string) => void;
  /**
   * How delivery shapes each field, from the shared delivery
   * declarations. Omit for an ad-hoc tokenized field with no delivery
   * composition of its own: each editor's mode then decides plain text
   * vs HTML, which is exactly what such a field gets.
   */
  fieldSpecs?: DeliveryFieldSpec[];
  /** Finished template strings, when they differ from the editor values. */
  templateValues?: Record<string, string>;
  /**
   * Browsable-tree endpoints for this host (defaults to the studio's
   * own). Hosts gated differently — bulk messaging — serve the same
   * tree behind their own gate and pass it here.
   */
  treeBaseUrl?: string;
}

/**
 * WHERE THE TOKENS COME FROM — and either way, somebody has to have
 * said what these templates are about.
 *
 * A host either names its roots, and the generic catalog is built for
 * exactly those, or it points at a catalog endpoint of its own, which
 * names them server-side. There is no third option where the roots go
 * unstated: the studio would then have to guess, and the only guess
 * available is "every root in the registry" — which is how an editor
 * ends up showing an author records their message has never heard of.
 */
type TokenStudioSourceProps =
  | {
      /**
       * The COMPLETE ordered list of roots these tokens may start from
       * (`contact`, `dispatch`, `event`, …). Roots not named here do
       * not exist for these tokens.
       */
      rootNames: string[];
      catalogUrl?: undefined;
    }
  | {
      rootNames?: string[];
      /** Token catalog endpoint of this host's own, roots and all. */
      catalogUrl: string;
    };

export type TokenStudioProps = TokenStudioBaseProps & TokenStudioSourceProps;

/**
 * THE generic token-editing popup: any tokenized string field anywhere
 * can open this, with no registration step of any kind. It loads a
 * token catalog and hands it to the shared studio, which previews
 * through the single preview route — the request carries the field
 * shaping and the template text, so nothing has to be declared
 * server-side for a new field to work.
 *
 * A caller only needs its own host when it has editor-side logic of its
 * own (the event notifier's default-vs-override text); previewing never
 * requires one.
 */
export function TokenStudio({
  open,
  onOpenChange,
  title,
  description,
  channel,
  fields,
  values,
  onValueChange,
  fieldSpecs,
  templateValues,
  rootNames,
  catalogUrl,
  treeBaseUrl,
}: TokenStudioProps) {
  const named = rootNames?.length ? rootNames : undefined;
  // No host-supplied endpoint means the generic catalog, which is built
  // for the roots named here — the prop types make sure there are some.
  const url =
    catalogUrl ??
    `/api/token-studio/catalog?roots=${encodeURIComponent((named ?? []).join(","))}`;
  // The failure is part of the answer. Dropping it here is how a host
  // whose catalog request 403s ends up looking like a host with no
  // tokens: the studio can only be honest about a request it is told
  // about.
  const {
    data: catalog,
    isLoading,
    error,
    refetch,
  } = useQuery<TokenStudioCatalog>({
    queryKey: [url],
    enabled: open,
  });

  // A host endpoint states its own roots in its response, so a host
  // that has one does not have to repeat the list as a prop — and could
  // not honestly do so where the roots are decided server-side. The
  // prop still wins: a host that named roots meant them.
  const roots = named ?? catalog?.rootNames;

  return (
    <TemplateStudio
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      channel={channel}
      fields={fields}
      values={values}
      onValueChange={onValueChange}
      fieldSpecs={fieldSpecs}
      templateValues={templateValues}
      tokens={catalog?.tokens ?? []}
      segments={catalog?.segments}
      fieldCatalog={catalog?.fields}
      rootNames={roots}
      studioContext={catalog?.studioContext}
      treeBaseUrl={treeBaseUrl}
      catalogState={{
        url,
        loading: isLoading,
        error,
        retry: () => {
          void refetch();
        },
      }}
    />
  );
}

/**
 * Self-contained "open the token editor" affordance: a small button that
 * owns the popup's open state. Drop it next to any tokenized field.
 */
export function TokenStudioButton({
  label = "Open Template Studio",
  testId = "button-open-token-studio",
  ...studioProps
}: Omit<TokenStudioBaseProps, "open" | "onOpenChange"> &
  TokenStudioSourceProps & {
    label?: string;
    testId?: string;
  }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid={testId}>
        <Maximize2 className="h-4 w-4 mr-1.5" />
        {label}
      </Button>
      {open && <TokenStudio {...studioProps} open={open} onOpenChange={setOpen} />}
    </>
  );
}
