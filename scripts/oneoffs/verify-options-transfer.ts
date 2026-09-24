/**
 * One-off verification for the options JSON export/import tools.
 *
 * Round-trips the awkward options types against the dev database:
 *  - a plain type with no sirius id and a component-gated field (department)
 *  - a sequenced type (classification)
 *  - the hierarchical type, including reparenting (worker-rating)
 *  - a cross-type reference (worker-ms -> industry)
 *  - undeclared JSONB keys (dispatch-job-type)
 *  - guarded deletes (note-type)
 *
 * Every mutating check writes and then restores, so the database is left as
 * it was found.
 *
 * Run: npx tsx scripts/oneoffs/verify-options-transfer.ts
 */
import { loadComponentCache } from "../../server/services/component-cache";
import type { OptionsImportResult } from "../../shared/optionsTransfer";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function describe(result: OptionsImportResult): string {
  const s = result.summary;
  const errors = result.errors.map((e) => e.message).join(" | ");
  return `create=${s.create} update=${s.update} unchanged=${s.unchanged} delete=${s.delete} skipped=${s.skipped}${errors ? ` errors=[${errors}]` : ""}`;
}

async function main() {
  await loadComponentCache();

  const { buildOptionsExport, runOptionsImport } = await import(
    "../../server/modules/options-transfer"
  );
  const { getOptionsType, getOptionsStorage } = await import(
    "../../server/modules/options-registry"
  );
  const storage = getOptionsStorage();

  const plan = async (
    type: string,
    envelope: unknown,
    options: Partial<{ create: boolean; update: boolean; delete: boolean }> = {},
    dryRun = true,
  ) =>
    runOptionsImport({
      type: type as any,
      config: getOptionsType(type)!,
      text: typeof envelope === "string" ? envelope : JSON.stringify(envelope),
      options: { create: true, update: true, delete: false, ...options },
      dryRun,
    });

  // ---------------------------------------------------------------- round trip
  const types = [
    "department",
    "classification",
    "worker-rating",
    "worker-ms",
    "dispatch-job-type",
    "note-type",
  ];
  for (const type of types) {
    const envelope = await buildOptionsExport(type as any);
    const result = await plan(type, envelope);
    const clean =
      result.errors.length === 0 &&
      result.summary.create === 0 &&
      result.summary.update === 0 &&
      result.summary.delete === 0 &&
      result.summary.unchanged === envelope.records.length;
    check(`${type}: unedited export round-trips as all-unchanged`, clean, describe(result));

    // And applying it writes nothing.
    const applied = await plan(type, envelope, {}, false);
    check(
      `${type}: applying an unedited export writes nothing`,
      applied.applied && applied.summary.create === 0 && applied.summary.update === 0,
      describe(applied),
    );
  }

  // ------------------------------------------------- refuses the wrong file
  const deptEnvelope = await buildOptionsExport("department" as any);
  const wrongType = await plan("classification", deptEnvelope);
  check(
    "refuses a file exported from a different options type",
    wrongType.errors.length === 1 && /different|importing into/.test(wrongType.errors[0].message),
    wrongType.errors[0]?.message,
  );

  const malformed = await plan("department", "{not json");
  check(
    "refuses malformed JSON",
    malformed.errors.length === 1 && /not valid JSON/.test(malformed.errors[0].message),
    malformed.errors[0]?.message,
  );

  // ------------------------------------------------------- component gating
  // department.availableForDispatch lives in `data` and is gated behind
  // dispatch.department; the same helper drives the definition endpoint.
  const { getDisabledOptionFieldNames } = await import(
    "../../server/modules/options-transfer"
  );
  const { isComponentEnabled } = await import("../../server/modules/components");
  const dispatchDept = await isComponentEnabled("dispatch.department");
  const disabledDeptFields = await getDisabledOptionFieldNames("department" as any);
  check(
    "the gated department field is hidden exactly when its component is off",
    disabledDeptFields.has("availableForDispatch") === !dispatchDept,
    `component=${dispatchDept} disabled=${Array.from(disabledDeptFields).join(",") || "(none)"}`,
  );
  const gatedExported = deptEnvelope.records.some(
    (r: any) => r.data && typeof r.data === "object" && "availableForDispatch" in r.data,
  );
  check(
    "the gated key is exported only when its component is on",
    dispatchDept || !gatedExported,
    `component=${dispatchDept} exported=${gatedExported}`,
  );

  // --------------------------------------------------- duplicate detection
  if (deptEnvelope.records.length > 0) {
    const dup = {
      ...deptEnvelope,
      records: [
        ...deptEnvelope.records,
        { name: deptEnvelope.records[0].name },
      ],
    };
    const dupResult = await plan("department", dup);
    check(
      "refuses two records that match the same existing record",
      dupResult.errors.some((e) => /share the name|Matches the same existing record/.test(e.message)),
      dupResult.errors.map((e) => e.message).join(" | "),
    );
  }

  // ------------------------------------------------------- required fields
  const missingName = { ...deptEnvelope, records: [{ description: "no name here" }] };
  const missingResult = await plan("department", missingName);
  check(
    "refuses a record missing a required field",
    missingResult.errors.some((e) => /required/i.test(e.message)),
    missingResult.errors.map((e) => e.message).join(" | "),
  );

  // ----------------------------------------------- unresolvable reference
  const msEnvelope = await buildOptionsExport("worker-ms" as any);
  if (msEnvelope.records.length > 0) {
    const broken = {
      ...msEnvelope,
      records: msEnvelope.records.map((r, i) =>
        i === 0 ? { ...r, industryId: { id: null, siriusId: null, name: "No Such Industry" } } : r,
      ),
    };
    const brokenResult = await plan("worker-ms", broken);
    check(
      "refuses a reference naming a record that does not exist",
      brokenResult.errors.some((e) => /No Such Industry/.test(e.message)),
      brokenResult.errors.map((e) => e.message).join(" | "),
    );
    const exported = msEnvelope.records[0].industryId as any;
    check(
      "worker-ms exports its industry as a reference object",
      !!exported && typeof exported === "object" && "id" in exported && "name" in exported,
      JSON.stringify(exported),
    );
  }

  // ------------------------------------------------------------ parent cycle
  const ratingEnvelope = await buildOptionsExport("worker-rating" as any);
  if (ratingEnvelope.records.length >= 2) {
    const [a, b] = ratingEnvelope.records;
    const cyclic = {
      ...ratingEnvelope,
      records: ratingEnvelope.records.map((r) => {
        if (r.id === a.id) return { ...r, parent: { id: b.id, name: b.name } };
        if (r.id === b.id) return { ...r, parent: { id: a.id, name: a.name } };
        return r;
      }),
    };
    const cycleResult = await plan("worker-rating", cyclic);
    check(
      "refuses a parent cycle",
      cycleResult.errors.some((e) => /cycle/i.test(e.message)),
      cycleResult.errors.map((e) => e.message).join(" | "),
    );
  }

  // ------------------------------------------------- create / update / delete
  const marker = `ZZ Transfer Test ${Date.now()}`;
  const childMarker = `${marker} Child`;
  const createEnvelope = {
    ...ratingEnvelope,
    records: [
      ...ratingEnvelope.records,
      { name: marker },
      { name: childMarker, parent: { name: marker } },
    ],
  };
  const createPreview = await plan("worker-rating", createEnvelope);
  check(
    "hierarchical create with a self reference to a new record previews cleanly",
    createPreview.errors.length === 0 && createPreview.summary.create === 2,
    describe(createPreview),
  );
  const createApplied = await plan("worker-rating", createEnvelope, {}, false);
  check("hierarchical create applies", createApplied.applied, describe(createApplied));

  const afterCreate = await storage.list("worker-rating" as any);
  const parentRow = afterCreate.find((r: any) => r.name === marker);
  const childRow = afterCreate.find((r: any) => r.name === childMarker);
  check(
    "the newly created child points at the newly created parent",
    !!parentRow && !!childRow && childRow.parent === parentRow.id,
    `parent=${parentRow?.id} child.parent=${childRow?.parent}`,
  );

  // Rename + reparent (rename is recognised by id, not delete-plus-create).
  const renamed = `${marker} Renamed`;
  const reparentEnvelope = {
    ...(await buildOptionsExport("worker-rating" as any)),
  };
  reparentEnvelope.records = reparentEnvelope.records.map((r: any) => {
    if (r.id === parentRow?.id) return { ...r, name: renamed };
    if (r.id === childRow?.id) return { ...r, parent: null };
    return r;
  });
  const reparentPreview = await plan("worker-rating", reparentEnvelope);
  check(
    "rename + reparent previews as two updates",
    reparentPreview.errors.length === 0 && reparentPreview.summary.update === 2,
    describe(reparentPreview),
  );
  await plan("worker-rating", reparentEnvelope, {}, false);
  const afterReparent = await storage.list("worker-rating" as any);
  const renamedRow = afterReparent.find((r: any) => r.id === parentRow?.id);
  const orphan = afterReparent.find((r: any) => r.id === childRow?.id);
  check(
    "rename kept the same row and the child was detached",
    renamedRow?.name === renamed && orphan?.parent === null,
    `name=${renamedRow?.name} child.parent=${orphan?.parent}`,
  );

  // Delete them again by leaving them out of the file.
  const cleanupEnvelope = {
    ...(await buildOptionsExport("worker-rating" as any)),
  };
  cleanupEnvelope.records = cleanupEnvelope.records.filter(
    (r: any) => r.id !== parentRow?.id && r.id !== childRow?.id,
  );
  const deletePreview = await plan("worker-rating", cleanupEnvelope, { delete: true });
  check(
    "records missing from the file preview as deletes",
    deletePreview.errors.length === 0 && deletePreview.summary.delete === 2,
    describe(deletePreview),
  );
  const deleteOff = await plan("worker-rating", cleanupEnvelope, { delete: false });
  check(
    "with delete switched off the same file is a no-op",
    deleteOff.summary.delete === 0 && deleteOff.errors.length === 0,
    describe(deleteOff),
  );
  const deleteApplied = await plan("worker-rating", cleanupEnvelope, { delete: true }, false);
  check("delete applies", deleteApplied.applied, describe(deleteApplied));
  const afterDelete = await storage.list("worker-rating" as any);
  check(
    "the test records are gone",
    !afterDelete.some((r: any) => r.id === parentRow?.id || r.id === childRow?.id),
    `${afterDelete.length} rows remain`,
  );

  // ------------------------------------------------------------- sequencing
  const classEnvelope = await buildOptionsExport("classification" as any);
  if (classEnvelope.records.length >= 2) {
    const reordered = {
      ...classEnvelope,
      records: [...classEnvelope.records].reverse().map((r: any) => {
        const { sequence, ...rest } = r;
        return rest;
      }),
    };
    const seqPreview = await plan("classification", reordered);
    check(
      "dropping sequence values and rearranging the file plans a reorder",
      seqPreview.errors.length === 0 && seqPreview.summary.update > 0,
      describe(seqPreview),
    );
  }

  // ------------------------------------------------- undeclared JSONB keys
  const jobTypeEnvelope = await buildOptionsExport("dispatch-job-type" as any);
  const jobTypeData = jobTypeEnvelope.records.map((r: any) => r.data);
  check(
    "dispatch job types export their data column verbatim",
    jobTypeEnvelope.records.every((r: any) => "data" in r),
    JSON.stringify(jobTypeData).slice(0, 160),
  );
  const bullpenRecord: any = jobTypeEnvelope.records.find(
    (r: any) => r.data && typeof r.data === "object" && "bullpen" in r.data,
  );
  if (bullpenRecord) {
    // Editing a record without mentioning `data` must not drop the
    // undeclared keys that live there.
    const before = JSON.stringify(bullpenRecord.data);
    const edited = {
      ...jobTypeEnvelope,
      records: jobTypeEnvelope.records.map((r: any) => {
        if (r.id !== bullpenRecord.id) return r;
        const { data, ...rest } = r;
        return { ...rest, description: `${r.description ?? ""} (transfer test)`.trim() };
      }),
    };
    await plan("dispatch-job-type", edited, {}, false);
    const afterEdit = await buildOptionsExport("dispatch-job-type" as any);
    const afterRecord: any = afterEdit.records.find((r: any) => r.id === bullpenRecord.id);
    check(
      "editing a record without mentioning data keeps its undeclared keys",
      JSON.stringify(afterRecord?.data) === before,
      `${before} -> ${JSON.stringify(afterRecord?.data)}`,
    );
    // Restore the description.
    await plan("dispatch-job-type", jobTypeEnvelope, {}, false);
    const restored = await buildOptionsExport("dispatch-job-type" as any);
    const restoredRecord: any = restored.records.find((r: any) => r.id === bullpenRecord.id);
    check(
      "the dispatch job type was restored",
      restoredRecord?.description === bullpenRecord.description &&
        JSON.stringify(restoredRecord?.data) === before,
      `${restoredRecord?.description}`,
    );
  }

  // ---------------------------------------------------------- guarded delete
  const noteEnvelope = await buildOptionsExport("note-type" as any);
  if (noteEnvelope.records.length > 0) {
    const withoutFirst = { ...noteEnvelope, records: noteEnvelope.records.slice(1) };
    const guarded = await plan("note-type", withoutFirst, { delete: true });
    console.log(
      `INFO: note-type delete preview (guards only fire for in-use types): ${describe(guarded)}`,
    );
    check(
      "a guarded delete is planned or refused, never silently partial",
      guarded.summary.delete === 1,
      describe(guarded),
    );
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
