import type { CommPostal } from "@shared/schema";
import { postalMessageDefaultsSchema } from "@shared/message-defaults";

/** Never consult site settings while displaying a historical communication. */
export async function renderRecordedLetter(record: Pick<CommPostal, "body" | "data">): Promise<Buffer> {
  const data = record.data as Record<string, unknown> | null;
  const snapshot = postalMessageDefaultsSchema.parse(data?.messageDefaults);
  if (!record.body) throw new Error("Recorded letter not found.");
  const { renderLetterPdf } = await import("./letter-pdf");
  // Effective body already contains the letterhead selected at delivery.
  return renderLetterPdf(record.body, {
    previewGuides: true, defaults: { ...snapshot, letterheadHtml: "" },
  });
}
