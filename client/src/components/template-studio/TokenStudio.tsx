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
import { useTokenContext } from "./useTokenContext";
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
  segments: TokenSegmentSpec[];
  fields?: TokenFieldCatalog;
  tokens: TokenCatalogEntry[];
  /** What each root may be previewed as — records and personas. */
  studioContext?: StudioContext;
}

export interface TokenStudioProps {
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
   * WHAT THESE TEMPLATES ARE ABOUT: the token context this surface
   * writes in. Its roots — the complete ordered list a token may start
   * from — are read from the shared `token-contexts` catalog, which is
   * the same declaration the server builds this surface's tokens, tree
   * and save-time validation from.
   *
   * A launch site names the context and nothing else. It used to be
   * able to state a root list of its own instead, which meant two
   * answers to "what may an author write here?" and no rule about which
   * one delivery would agree with.
   */
  contextId: string;
  /**
   * A host's OWN endpoint for the token graph and the records this
   * surface can preview against, when it has one.
   *
   * Hosts gated differently from the studio's admin-only default — bulk
   * messaging, the compose screens — serve the same graph behind their
   * own gate, and they are also the only ones that know which real
   * records the author may preview with. Omit for an ad-hoc tokenized
   * field: the studio then asks its own endpoint for the context's
   * roots, and the author previews against sample people.
   */
  hostCatalogUrl?: string;
  /**
   * Browsable-tree endpoints for this host (defaults to the studio's
   * own). Hosts gated differently — bulk messaging — serve the same
   * tree behind their own gate and pass it here.
   */
  treeBaseUrl?: string;
}

/**
 * THE generic token-editing popup: any tokenized string field anywhere
 * can open this, with no registration step beyond naming the context it
 * writes in. It loads that context's roots and the token graph for them
 * and hands both to the shared studio, which previews through the
 * single preview route — the request carries the field shaping and the
 * template text, so nothing has to be declared server-side for a new
 * field to work.
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
  contextId,
  hostCatalogUrl,
  treeBaseUrl,
}: TokenStudioProps) {
  const tokenContext = useTokenContext(contextId);
  const rootNames = tokenContext.context?.rootNames;

  // No host-supplied endpoint means the studio's own, built for the
  // context's roots — so it cannot be asked for until they are known.
  const url =
    hostCatalogUrl ??
    (rootNames
      ? `/api/token-studio/catalog?roots=${encodeURIComponent(rootNames.join(","))}`
      : undefined);

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
    queryKey: [url ?? ""],
    enabled: open && url !== undefined,
  });

  // Two requests behind one line: the context that says what may be
  // written, and the graph of what it offers. Either failing leaves the
  // author with no tokens, so whichever failed is the one to report —
  // the context first, because a graph request that never happened
  // because the context is unknown would otherwise report as "still
  // loading" forever.
  const failed = tokenContext.error ?? error;
  const source = tokenContext.error ? tokenContext : { url, retry: refetch };

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
      rootNames={rootNames}
      studioContext={catalog?.studioContext}
      treeBaseUrl={treeBaseUrl}
      catalogState={{
        url: source.url,
        loading: tokenContext.loading || isLoading,
        error: failed,
        retry: () => {
          void source.retry();
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
}: Omit<TokenStudioProps, "open" | "onOpenChange"> & {
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
