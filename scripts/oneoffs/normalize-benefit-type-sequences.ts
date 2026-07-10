/**
 * One-off: normalize the sequence values of trust benefit types so they are
 * unique and dense (0, 1, 2, ...).
 *
 * Why: several benefit types shared the same sequence value (e.g. Dental, Vision
 * and Life were all -3). With tied sequences the display order is decided by an
 * unstable database heap order, so the config page and the worker-list benefit
 * icons could disagree on the order of the tied group. Making every sequence
 * unique — in the order the config page currently shows them — makes the
 * ordering deterministic everywhere.
 *
 * The current config page order is exactly `ORDER BY sequence ASC`, which is
 * what `storage.list("trust-benefit-type")` returns. We simply renumber that
 * existing order to 0..N so no rows move relative to each other; only the tie
 * ambiguity is removed.
 *
 * Idempotent: re-running when the sequences are already 0..N is a no-op.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/normalize-benefit-type-sequences.ts
 */

import { getOptionsStorage } from "../../server/modules/options-registry";

async function main() {
  const options = getOptionsStorage();
  const items = await options.list("trust-benefit-type");

  console.log(`Found ${items.length} trust benefit types (current order):`);
  for (const item of items) {
    console.log(`  ${item.sequence}\t${item.name}`);
  }

  let changed = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.sequence !== i) {
      await options.update("trust-benefit-type", item.id, { sequence: i });
      console.log(`Updated "${item.name}": ${item.sequence} -> ${i}`);
      changed++;
    }
  }

  console.log(
    changed === 0
      ? "\nNothing to do — sequences already unique and dense."
      : `\nDone — renumbered ${changed} benefit type(s) to unique dense sequences.`,
  );

  const after = await options.list("trust-benefit-type");
  console.log("\nFinal order:");
  for (const item of after) {
    console.log(`  ${item.sequence}\t${item.name}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
