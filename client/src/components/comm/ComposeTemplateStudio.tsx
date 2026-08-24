import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, Maximize2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TokenStudio, type StudioField } from "@/components/template-studio/TokenStudio";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { COMPOSE_CHANNEL_FIELDS } from "@shared/delivery-fields";
import type {
  ComposeChannel,
  ComposeRenderResponse,
  ComposeTemplateTarget,
} from "@shared/comm-compose";

/**
 * "WRITE THIS MESSAGE FROM A TEMPLATE" — on every compose screen.
 *
 * The author opens the Template Studio, writes tokenized text against
 * the record the page is about, and on close the text is RENDERED
 * server-side and the finished strings replace the form's fields. What
 * the form holds afterwards is exactly what will be sent: the send path
 * never sees a token, so there is no second evaluation to disagree with
 * the one the author just previewed.
 *
 * THE DRAFT IS KEPT, THE APPLY IS ONE-WAY. Reopening the studio shows
 * the tokenized text again, not the rendered result — rendering is not
 * reversible, and re-parsing a finished letter back into tokens would
 * be guesswork. The form, meanwhile, is still an ordinary form: the
 * author may edit the finished text by hand, and the studio warns
 * before overwriting those edits rather than silently discarding them.
 */

/**
 * Text still carrying token syntax, in the order a reader would meet it.
 *
 * The studio is the only place a tokenized string is written, and the
 * form it hands back holds finished text. But the form is an ordinary
 * form, so an author who has just seen tokens work can reasonably type
 * another one straight into it — and nothing downstream would evaluate
 * it. The send would go out with `{{worker.first_name}}` printed in it.
 *
 * So a compose screen that OFFERS the studio refuses to send text that
 * looks like a template, and says where to write one instead. Screens
 * without the studio are untouched: there, braces are just braces.
 */
export function unrenderedTokens(values: Record<string, string>): string[] {
  const found: string[] = [];
  for (const value of Object.values(values)) {
    for (const match of (value ?? "").matchAll(/\{\{([^{}]*)\}\}/g)) {
      const token = `{{${match[1].trim()}}}`;
      if (!found.includes(token)) found.push(token);
    }
  }
  return found;
}

type ToastFn = ReturnType<typeof useToast>["toast"];

/**
 * Refuse the send when the form still holds token syntax, and say so.
 * Returns true when the caller must stop.
 */
export function refuseUnrenderedTokens(
  values: Record<string, string>,
  toast: ToastFn,
): boolean {
  const tokens = unrenderedTokens(values);
  if (tokens.length === 0) return false;
  toast({
    title: "This message still has tokens in it",
    description: `${tokens.join(", ")} — tokens are only filled in when you compose from a template. Use "Compose from template", or remove them.`,
    variant: "destructive",
  });
  return true;
}

interface ComposeTemplateStudioProps {
  /**
   * The record this screen is about. Absent on a screen that has not
   * (yet) said — the affordance then does not appear at all, because a
   * studio with nothing to render against can only offer sample people.
   */
  target?: ComposeTemplateTarget;
  channel: ComposeChannel;
  /** Title of the studio popup, e.g. "Compose Email". */
  title: string;
  /** The fields the studio composes, in the order they are shown. */
  fields: StudioField[];
  /** The form's current text for those fields. */
  values: Record<string, string>;
  /** Hand the finished text back to the form, one entry per field. */
  onApply: (rendered: Record<string, string>) => void;
  testId?: string;
}

export function ComposeTemplateStudio({
  target,
  channel,
  title,
  fields,
  values,
  onApply,
  testId = "button-compose-template-studio",
}: ComposeTemplateStudioProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  /** The tokenized text, which only ever lives here. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  /**
   * What was handed to the form last time. Anything else in the form is
   * a hand edit, and hand edits are what the overwrite warning is about.
   */
  const [applied, setApplied] = useState<Record<string, string> | null>(null);
  const [confirming, setConfirming] = useState<Record<string, string> | null>(
    null,
  );
  /**
   * The draft as it stands RIGHT NOW, readable from inside the awaited
   * render. `draft` closed over by an async function is the draft as it
   * was when that function started, and the studio stays editable while
   * the render is in flight.
   */
  const draftRef = useRef<Record<string, string>>({});
  /** One render at a time — a second close must not start another. */
  const rendering = useRef(false);

  const render = useMutation<ComposeRenderResponse, Error, Record<string, string>>(
    {
      mutationFn: async (templates) =>
        await apiRequest("POST", "/api/comm-compose/render", {
          scope: target?.scope,
          recordId: target?.recordId,
          channel,
          values: templates,
        }),
    },
  );

  if (!target) return null;

  const fieldKeys = fields.map((f) => f.key);

  const openStudio = () => {
    // Seed the draft from the form the first time: whatever the author
    // already typed is the template they are starting from. Afterwards
    // the draft is the source of truth, so reopening shows the tokens
    // they wrote rather than the text those tokens produced.
    if (applied === null) {
      const seeded: Record<string, string> = {};
      for (const key of fieldKeys) seeded[key] = values[key] ?? "";
      setDraft(seeded);
      draftRef.current = seeded;
    }
    setOpen(true);
  };

  const editDraft = (key: string, value: string) => {
    draftRef.current = { ...draftRef.current, [key]: value };
    setDraft(draftRef.current);
  };

  const handEdited = () =>
    applied !== null &&
    fieldKeys.some(
      (key) => (values[key] ?? "") !== (applied[key] ?? ""),
    );

  const commit = (rendered: Record<string, string>) => {
    setApplied(rendered);
    onApply(rendered);
    setOpen(false);
    toast({
      title: "Message composed",
      description: "The finished text is in the form — review it before sending.",
    });
  };

  const applyDraft = async () => {
    if (rendering.current) return;
    rendering.current = true;
    try {
      // The studio stays editable while the render is in flight, so what
      // comes back is only the finished message if the draft has not
      // moved on since. If it has, render again: committing the older
      // result would silently discard the edit the author just made.
      for (;;) {
        const sent = draftRef.current;
        let result: ComposeRenderResponse;
        try {
          result = await render.mutateAsync(sent);
        } catch (error) {
          toast({
            title: "Could not compose the message",
            description:
              error instanceof Error ? error.message : "The render failed.",
            variant: "destructive",
          });
          return;
        }
        if (draftRef.current !== sent) continue;

        // A token the scope does not have renders as a visible marker.
        // Text carrying one must not reach the form, where the next
        // click sends it: refuse, name the tokens, and leave the studio
        // open on the draft that has to change.
        const unknown = Array.from(
          new Set(
            Object.values(result.fields).flatMap((field) => field.unknownTokens),
          ),
        );
        if (unknown.length > 0) {
          toast({
            title: "Unknown tokens",
            description: `${unknown.join(", ")} — these do not exist for this message. Remove or correct them before applying.`,
            variant: "destructive",
          });
          return;
        }

        const rendered: Record<string, string> = {};
        for (const key of fieldKeys) {
          rendered[key] = result.fields[key]?.rendered ?? "";
        }

        if (handEdited()) {
          setConfirming(rendered);
          return;
        }
        commit(rendered);
        return;
      }
    } finally {
      rendering.current = false;
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openStudio}
        data-testid={testId}
      >
        <Maximize2 className="h-4 w-4 mr-1.5" />
        Compose from template
      </Button>

      {open && (
        <TokenStudio
          open={open}
          onOpenChange={(next) => {
            if (next) {
              setOpen(true);
              return;
            }
            // Closing the studio IS the apply: the author is done
            // writing, so the text they wrote becomes the message.
            void applyDraft();
          }}
          title={title}
          description="Write the message with tokens. Closing the studio renders it against this record and puts the finished text in the form."
          channel={channel}
          fields={fields}
          values={draft}
          onValueChange={editDraft}
          fieldSpecs={COMPOSE_CHANNEL_FIELDS[channel]}
          catalogUrl={`/api/comm-compose/token-catalog?scope=${encodeURIComponent(target.scope)}&recordId=${encodeURIComponent(target.recordId)}`}
          treeBaseUrl={`/api/comm-compose/tree/${encodeURIComponent(target.scope)}`}
        />
      )}

      {render.isPending && (
        <span className="ml-2 inline-flex items-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          Composing…
        </span>
      )}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-compose-overwrite">
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your edits?</AlertDialogTitle>
            <AlertDialogDescription>
              You changed this message in the form after the last time you
              composed it. Applying the template replaces those changes with
              the newly rendered text.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-compose-overwrite-cancel">
              Keep my edits
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const rendered = confirming;
                setConfirming(null);
                if (rendered) commit(rendered);
              }}
              data-testid="button-compose-overwrite-confirm"
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
