import { registerFloodEvent } from "./registry";
import { FloodEventDefinition, FloodContext } from "./types";

export const bookmarkFloodEvent: FloodEventDefinition = {
  name: "bookmark",
  threshold: 1000,
  windowSeconds: 360,
  getIdentifier: (context: FloodContext): string => {
    if (!context.userId) {
      throw new Error("userId is required for bookmark flood event");
    }
    return context.userId;
  },
};

export function registerFloodEvents(): void {
  registerFloodEvent(bookmarkFloodEvent);
}
