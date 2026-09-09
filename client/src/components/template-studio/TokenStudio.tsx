import type { ReactNode } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Maximize2 } from "lucide-react";
import {
  TemplateStudio,
  type StudioChannel,
  type StudioSeeds,
  type StudioField,
} from "./TemplateStudio";
import { useTokenContext } from "./useTokenContext";
import type { DeliveryFieldSpec } from "@shared/delivery-fields";
import type {
  TokenPickerEntry,
  TokenFieldIndex,
  TokenSegmentSpec,
} from "@shared/tokens";

// A host declares its fields; it should not have to reach past this
// entry point into the studio's internals to name their type.
export type { StudioChannel, StudioField } from "./TemplateStudio";

/**
 * WHAT MAY BE WRITTEN in a context: the same answer for every surface
 * writing in it, from the one route that builds it.
 */
interface TokenGraph {
  segments: TokenSegmentSpec[];
  fieldIndex?: TokenFieldIndex;
  pickerEntries: TokenPickerEntry[];
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
   * A host's OWN endpoint for the records this surface may be previewed
   * against, when it holds any.
   *
   * Only the host knows them: this message's recipients, the contact
   * whose tab this is, the records this notifier's recent events were
   * about. Omit for an ad-hoc tokenized field — there is no record such
   * a field is about, so the studio asks the shared endpoint and the
   * author previews against sample people.
   *
   * It is seeds ONLY. The token graph never comes from a host: it is
   * the same everywhere and is fetched once, below, for the context.
   */
  seedsUrl?: string;
  /**
   * Something the host needs to say about the text on screen — passed
   * straight through (see TemplateStudio's own prop). The studio's two
   * requests report themselves; this is for a host's.
   */
  hostNotice?: ReactNode;
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
  seedsUrl,
  hostNotice,
}: TokenStudioProps) {
  const tokenContext = useTokenContext(contextId);
  const rootNames = tokenContext.context?.rootNames;

  // TWO QUESTIONS, TWO REQUESTS. What may be written here is the same
  // for every surface writing in this context, so it comes from the one
  // route that builds it; what may be previewed against is this host's
  // alone. They fail independently — a host whose recipients can't be
  // read still has a token browser — so they are asked, reported and
  // retried independently.
  const graphUrl = `/api/token-studio/graph?context=${encodeURIComponent(contextId)}`;
  const previewSeedsUrl =
    seedsUrl ??
    `/api/token-studio/preview-seeds?context=${encodeURIComponent(contextId)}`;

  // The failure is part of the answer. Dropping it here is how a
  // request that 403s ends up looking like a host with no tokens: the
  // studio can only be honest about a request it is told about.
  const {
    data: graph,
    isLoading: graphLoading,
    error: graphError,
    refetch: refetchGraph,
  } = useQuery<TokenGraph>({
    queryKey: [graphUrl],
    enabled: open,
  });

  const {
    data: seeds,
    isLoading: seedsLoading,
    error: seedsError,
    refetch: refetchSeeds,
  } = useQuery<StudioSeeds>({
    queryKey: [previewSeedsUrl],
    enabled: open,
  });

  // The context is what BOTH requests are about, so its own failure is
  // the one to report on either line: a graph request refused because
  // this deployment offers no such context would otherwise read as a
  // graph that is still loading, forever.
  const graphState = tokenContext.error
    ? { url: tokenContext.url, error: tokenContext.error, retry: tokenContext.retry }
    : {
        url: graphUrl,
        loading: tokenContext.loading || graphLoading,
        error: graphError,
        retry: () => {
          void refetchGraph();
        },
      };
  const seedsState = tokenContext.error
    ? { url: tokenContext.url, error: tokenContext.error, retry: tokenContext.retry }
    : {
        url: previewSeedsUrl,
        loading: seedsLoading,
        error: seedsError,
        retry: () => {
          void refetchSeeds();
        },
      };

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
      tokens={graph?.pickerEntries ?? []}
      segments={graph?.segments}
      fieldIndex={graph?.fieldIndex}
      contextId={contextId}
      rootNames={rootNames}
      seeds={seeds}
      hostNotice={hostNotice}
      graphState={graphState}
      seedsState={seedsState}
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
