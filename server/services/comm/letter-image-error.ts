/** Only these controlled messages may cross the preview boundary. */
export class LetterImageError extends Error {
  constructor(
    readonly category: "invalid" | "unsafe-svg" | "complexity" | "dimensions" | "size" | "conversion" | "timeout" | "transport" | "unavailable",
    message: string,
    readonly imageNumber?: number,
    readonly transportStatus?: number,
    readonly transportCode?: string,
  ) {
    super(imageNumber ? `Could not load letter image ${imageNumber}: ${message}` : message);
    this.name = "LetterImageError";
  }
}

export function letterFailureContext(error: unknown, stage: string): Record<string, unknown> {
  return {
    stage,
    category: error instanceof LetterImageError ? error.category : "unexpected",
    ...(error instanceof LetterImageError ? {
      imageNumber: error.imageNumber,
      transportStatus: error.transportStatus,
      transportCode: error.transportCode,
    } : {}),
  };
}
