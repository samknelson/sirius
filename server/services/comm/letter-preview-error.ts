import { LetterImageError } from "./letter-image-error";
import { LetterLayoutError } from "./letter-layout-error";

/** Both preview entry points share the same controlled-error boundary. */
export function letterPreviewFailure(error: unknown): { status: number; message: string } {
  return error instanceof LetterImageError || error instanceof LetterLayoutError
    ? { status: 422, message: error.message }
    : { status: 500, message: "Unable to generate the PDF preview" };
}
