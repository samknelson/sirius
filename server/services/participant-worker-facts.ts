import { alterHooks } from "@shared/alter";
export const participantWorkerFactsHook = alterHooks.declare<
  { isSteward: boolean }, { readonly workerId: string }, Record<string, never>
>({
  id: "events.participant-worker-facts",
  description: "Enrich a participant's worker classification before emitting the saved event",
  semantics: "Read-only in caller transaction; default has no optional classification. Failure aborts enrichment, never grants authority.",
});
export async function participantWorkerFacts(workerId: string) {
  return alterHooks.run(participantWorkerFactsHook, { isSteward: false }, { workerId });
}
