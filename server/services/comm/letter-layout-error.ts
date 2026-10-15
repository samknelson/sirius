/** Fixed, actionable layout refusals, safe to show in a preview response. */
export class LetterLayoutError extends Error {
  constructor(message: string) { super(message); this.name = "LetterLayoutError"; }
}
