import type { TrustProviderEdiPlugin, TrustProviderEdiContext } from "./registry";
import { effectiveBenefitSiriusIds, resolveBenefitIds, ymdCompact } from "./base";
import { loadTerminationCandidates, type TerminationCandidate } from "./termination-population";
import { readTerminationPolicy, assertTerminationContract, terminationContractBlocker, terminationProperties } from "./termination-policy";

/**
 * Compose once at registration. The carrier still owns its layout and all
 * demographic/COBRA/QMSCO mappings. Historical batches contain one covered
 * month at a time so supplemental medical lookups cannot borrow today's plan.
 */
export function withMembershipLifecycle(plugin: TrustProviderEdiPlugin): TrustProviderEdiPlugin {
  if (!plugin.benefitSiriusIds?.length) return plugin; // Local 11 hours excluded.
  const getKeys = plugin.getPrimaryKeys!;
  const process = plugin.processBatch.bind(plugin);
  const columns = plugin.getColumns.bind(plugin);
  const populations = new WeakMap<TrustProviderEdiContext, Map<string, TerminationCandidate>>();
  const blocker = terminationContractBlocker(plugin.id);
  function check(ctx: TrustProviderEdiContext) {
    const policy = ctx.terminationPolicy ?? readTerminationPolicy(ctx.configData);
    assertTerminationContract(plugin.id, policy);
    return policy;
  }
  async function population(ctx: TrustProviderEdiContext) {
    const policy = check(ctx);
    if (!policy.subscribers && !policy.dependents) return new Map<string, TerminationCandidate>();
    const cached = populations.get(ctx);
    if (cached) return cached;
    const benefits = await resolveBenefitIds(ctx, effectiveBenefitSiriusIds(ctx, plugin.benefitSiriusIds!));
    const candidates = await loadTerminationCandidates(ctx, benefits);
    const map = new Map(candidates.map(c => [`termination:${c.eventId}`, c]));
    populations.set(ctx, map);
    return map;
  }
  return {
    ...plugin,
    inputSchema: {
      ...plugin.inputSchema, type: "object",
      properties: { ...plugin.inputSchema?.properties, ...terminationProperties },
      description: [plugin.inputSchema?.description,
        blocker ? `Explicit termination generation is blocked pending carrier confirmation: ${blocker}` :
          "Explicit terminations include ended people; active membership is unchanged.",
        "Save run parameters before generating. Turn both flags off for omission mode. Saving invalidates previous output; regeneration is required.",
      ].filter(Boolean).join(" "),
    },
    getColumns: () => [
      ...columns(),
      { id: "terminationRole", header: "Termination role", type: "string", width: 130 },
      { id: "terminationEnd", header: "Last covered date", type: "string", width: 130 },
      { id: "terminationEvidence", header: "Termination evidence", type: "string", width: 160 },
    ],
    async getPrimaryKeys(ctx) {
      check(ctx);
      populations.delete(ctx); // every regeneration re-evaluates authoritative history
      const terms = await population(ctx);
      return [...await getKeys(ctx), ...terms.keys()];
    },
    async processBatch(keys, ctx) {
      check(ctx);
      const active = keys.filter(k => !k.startsWith("termination:"));
      const rows = active.length ? await process(active, ctx) : [];
      const termKeys = keys.filter(k => k.startsWith("termination:"));
      if (!termKeys.length) return rows;
      const terms = await population(ctx);
      const groups = new Map<string, TerminationCandidate[]>();
      for (const key of termKeys) {
        const candidate = terms.get(key);
        if (!candidate) throw new Error("Termination population changed. Regenerate this report.");
        const group = groups.get(candidate.end) ?? [];
        group.push(candidate);
        groups.set(candidate.end, group);
      }
      for (const [end, candidates] of groups) {
        const historical = await process(
          [...new Set(candidates.map(c => c.familyWmbId))],
          { ...ctx, input: { ...ctx.input, asOfDate: end } },
        );
        const byKey = new Map(historical.map(r => [String(r.pk), r]));
        for (const candidate of candidates) {
          const row = byKey.get(candidate.rowKey);
          if (!row) throw new Error(`Termination event ${candidate.eventId}: carrier member row could not be reconstructed. No file should be delivered.`);
          rows.push({
            ...row,
            pk: `term:${candidate.benefitId}:${candidate.workerId}:${candidate.familyWmbId}:${candidate.end}`,
            coverageStart: ymdCompact(candidate.start),
            coverageEnd: ymdCompact(candidate.end),
            terminationRole: candidate.role, terminationEnd: candidate.end,
            terminationEvidence: candidate.evidence,
          });
        }
      }
      return rows;
    },
  };
}
