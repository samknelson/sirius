/**
 * One-off end-to-end verification for the bulk participant token root.
 *
 * Against real data:
 *   1. bulk's declared roots lead with `bulk_participant`, and the chains an
 *      author writes — {{bulk_participant}}, .medium, .contact,
 *      .contact.worker — validate there and NOWHERE else,
 *   2. the row delivery seeds carries every field the kind advertises (the
 *      failure mode that previews fine and delivers blank),
 *   3. the plumbing columns the kind deliberately does not advertise are
 *      refused by the same validation an author's template goes through,
 *   4. a real participant loads through the kind's preview source, is gated
 *      on its RECIPIENT, and renders the same values delivery renders,
 *   5. the Lob merge-variable keys are exactly what they were before this
 *      root existed.
 *
 * Run: npx tsx scripts/oneoffs/verify-bulk-participant-tokens.ts
 */
import { initializeTokenPluginSystem } from "../../server/plugins/tokens";
import { tokenPluginRegistry } from "../../server/plugins/tokens/registry";
import { storage } from "../../server/storage";
import { loadComponentCache } from "../../server/services/component-cache";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  await loadComponentCache();
  initializeTokenPluginSystem();

  const {
    buildTokenCatalogForRoots,
    validateTokenExpressionForRoots,
    renderTokens,
    createTokenEvalContext,
  } = await import("../../server/plugins/tokens");
  const { missingCatalogFields } = await import(
    "../../server/plugins/tokens/root-coverage"
  );
  const { BULK_TOKEN_ROOT_NAMES, BULK_POSTAL_MERGE_ROOT_NAMES } = await import(
    "../../server/modules/bulk/token-roots"
  );
  const {
    BULK_PARTICIPANT_ROOT_NAME,
    BULK_PARTICIPANT_FIELDS,
    composeBulkParticipantEntity,
  } = await import("../../server/plugins/tokens/plugins/bulk-participant");

  console.log("\n--- declared roots ---");
  check(
    "bulk leads with the participant root",
    BULK_TOKEN_ROOT_NAMES[0] === BULK_PARTICIPANT_ROOT_NAME,
    BULK_TOKEN_ROOT_NAMES.join(", "),
  );
  check(
    "the recipient-side roots stay on offer",
    ["contact", "worker", "system"].every((n) => BULK_TOKEN_ROOT_NAMES.includes(n)),
  );

  const { listTokenPreviewRoots } = await import(
    "../../server/plugins/tokens/preview-roots"
  );
  const previewRoots = listTokenPreviewRoots(BULK_TOKEN_ROOT_NAMES);
  const participantRoot = previewRoots.find(
    (r) => r.name === BULK_PARTICIPANT_ROOT_NAME,
  );
  check(
    "the seed panel leads with a participant root",
    previewRoots[0]?.name === BULK_PARTICIPANT_ROOT_NAME &&
      participantRoot?.kind === "bulk_participant",
    previewRoots.map((r) => `${r.name} (${r.label})`).join(", "),
  );

  const catalog = buildTokenCatalogForRoots(BULK_TOKEN_ROOT_NAMES).map((e) => e.id);
  check(
    "the picker offers the participant and the chains through it",
    catalog.includes("bulk_participant") &&
      catalog.includes('bulk_participant.contact.field(name="")'),
    catalog.filter((id) => id.startsWith("bulk_participant")).join(", "),
  );

  // Validation takes the CHAIN, the way `extractTokenExpressions` hands
  // it over — no braces.
  console.log("\n--- what an author may write ---");
  const valid = [
    "bulk_participant",
    'bulk_participant.field(name="medium")',
    "bulk_participant.contact",
    'bulk_participant.contact.field(name="display_name")',
    'bulk_participant.contact.worker.field(name="job_title")',
    "contact",
    'worker.field(name="job_title")',
  ];
  for (const expr of valid) {
    const result = validateTokenExpressionForRoots(expr, BULK_TOKEN_ROOT_NAMES);
    check(`valid in bulk: {{${expr}}}`, result.ok, result.ok ? undefined : result.error);
  }

  // Plumbing is not a token just because it is a column.
  const refused = [
    'bulk_participant.field(name="data")',
    'bulk_participant.field(name="status")',
    'bulk_participant.field(name="comm_id")',
    'bulk_participant.field(name="contact_id")',
    'bulk_participant.field(name="id")',
  ];
  for (const expr of refused) {
    const result = validateTokenExpressionForRoots(expr, BULK_TOKEN_ROOT_NAMES);
    check(`refused in bulk: {{${expr}}}`, !result.ok);
  }

  // A chain ending at a worker means the same thing however it is
  // reached: the worker kind declares a default leaf, so
  // {{bulk_participant.contact.worker}} is as writable as {{worker}}.
  // The participant root inherits that, rather than inventing a default
  // of its own.
  const bareWorker = validateTokenExpressionForRoots("worker", BULK_TOKEN_ROOT_NAMES);
  const bareHoppedWorker = validateTokenExpressionForRoots(
    "bulk_participant.contact.worker",
    BULK_TOKEN_ROOT_NAMES,
  );
  check(
    "a bare worker chain behaves the same however it is reached",
    bareWorker.ok === bareHoppedWorker.ok,
    `{{worker}} ok=${bareWorker.ok}, {{bulk_participant.contact.worker}} ok=${bareHoppedWorker.ok}`,
  );

  // The root exists only where it is declared.
  const elsewhere = validateTokenExpressionForRoots(
    'bulk_participant.field(name="medium")',
    ["contact", "worker", "system"],
  );
  check("participant root is unknown outside bulk", !elsewhere.ok);

  console.log("\n--- the row delivery seeds ---");
  const sampleRow = composeBulkParticipantEntity({
    id: "00000000-0000-0000-0000-000000000000",
    contactId: "00000000-0000-0000-0000-000000000001",
    medium: "email",
  });
  const missing = missingCatalogFields(sampleRow);
  check(
    "every advertised field is present in the seeded row",
    missing.length === 0,
    missing.join(", ") || `advertised: ${BULK_PARTICIPANT_FIELDS.join(", ")}`,
  );

  console.log("\n--- against a real participant ---");
  const [message] = await storage.bulkMessages.getAll();
  const participants = message
    ? await storage.bulkParticipants.listForMessageWithRelations(message.id)
    : [];
  const participant = participants[0];
  if (!participant) {
    console.log("SKIP: no bulk participants in this database");
  } else {
    const source = tokenPluginRegistry
      .list()
      .find((p) => p.metadata.id === "token.bulk_participant")?.metadata.previewEntity;
    if (!source) {
      check("the kind declares a preview source", false);
    } else {
      const loaded = await source.load(storage, participant.id);
      check("a real participant loads by id", loaded !== null, loaded?.label);
      check(
        "the read is gated on the recipient, not the participant row",
        source.gate.scope === "record" &&
          source.gate.policy === "contact.view" &&
          loaded?.gateEntityId === participant.contactId,
      );
      if (loaded) {
        // The preview seeds what it loaded; delivery seeds what it
        // composed. Same composer, so the same render.
        const previewCtx = createTokenEvalContext(storage, participant.contactId, {
          seeds: [{ name: BULK_PARTICIPANT_ROOT_NAME, entity: loaded.entity }],
        });
        const deliveryCtx = createTokenEvalContext(storage, participant.contactId, {
          seeds: [
            {
              name: BULK_PARTICIPANT_ROOT_NAME,
              entity: composeBulkParticipantEntity(participant),
            },
          ],
        });
        const template =
          "{{bulk_participant}} / " +
          '{{bulk_participant.contact.field(name="display_name")}} / ' +
          '{{bulk_participant.contact.worker.field(name="sirius_id")}}';
        const previewed = (
          await renderTokens(template, previewCtx, { strictUnknown: true })
        ).output;
        const delivered = (
          await renderTokens(template, deliveryCtx, { strictUnknown: true })
        ).output;
        check("a participant renders real values", previewed.startsWith(participant.medium), previewed);
        check("preview and delivery render the same string", previewed === delivered, delivered);
        check(
          "the recipient's name renders through the participant",
          !previewed.includes("[unknown token"),
        );

        // The studio seeds ONLY the root the author picked. A picked
        // participant must still make its recipient the recipient, or
        // plain {{contact…}} tokens would preview as a sample stranger
        // and deliver as this person.
        const { renderTemplatePreview } = await import(
          "../../server/modules/template-preview"
        );
        const preview = await renderTemplatePreview({
          storage,
          fields: [{ key: "body", label: "Body" }],
          templates: {
            body:
              '{{bulk_participant}} / {{contact.field(name="display_name")}} / ' +
              '{{worker.field(name="sirius_id")}}',
          },
          rootNames: BULK_TOKEN_ROOT_NAMES,
          seeds: [
            {
              name: BULK_PARTICIPANT_ROOT_NAME,
              entity: composeBulkParticipantEntity(participant),
            },
          ],
        });
        check(
          "a picked participant makes its recipient the render's recipient",
          preview.contactId === participant.contactId,
          `${preview.contactId}`,
        );
        check(
          "the recipient roots render for real beside the send",
          preview.fields.body?.rendered === previewed,
          `${preview.fields.body?.rendered} vs ${previewed}`,
        );
        check(
          "the preview does not call itself a sample",
          preview.sample === false &&
            preview.roots.every((r) => r.real || r.name === "system"),
          preview.roots.map((r) => `${r.name}=${r.real ? "real" : "sample"}`).join(", "),
        );
      }
    }
  }

  console.log("\n--- the postal contract ---");
  check(
    "Lob merge roots gained nothing",
    !BULK_POSTAL_MERGE_ROOT_NAMES.includes(BULK_PARTICIPANT_ROOT_NAME),
    BULK_POSTAL_MERGE_ROOT_NAMES.join(", "),
  );
  const mergeKeys = buildTokenCatalogForRoots(BULK_POSTAL_MERGE_ROOT_NAMES).map(
    (e) => e.id,
  );
  check(
    "no merge key mentions the participant",
    mergeKeys.every((k) => !k.startsWith(BULK_PARTICIPANT_ROOT_NAME)),
  );

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
