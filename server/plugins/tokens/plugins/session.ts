import { registerTokenPlugin } from "../registry";
import { tokenEntityOf } from "../types";

/** A closed event snapshot, not the live sessions table or session JSON. */
registerTokenPlugin({
  metadata: {
    id: "token.session",
    name: "Sign-in session",
    description: "The IP and supplied User-Agent captured at a successful sign-in",
    // The notifier registry owns the named root. This is only its closed
    // kind descriptor, like other notifier-only record kinds.
    segmentName: "__session",
    inputTypes: [],
    outputType: "session",
    hiddenFromPicker: true,
    entityFields: ["ip", "userAgent"],
    defaultLeaf: "ip",
    sampleSets: [{
      id: "martian", label: "Martian",
      values: { ip: "198.51.100.42", userAgent: "Mozilla/5.0 (Example OS) ExampleBrowser/1.0" },
    }],
  },
  async resolve() {
    return null;
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.session.ip",
    name: "Session IP address",
    description: "The normalized IP address used for this sign-in",
    segmentName: "ip",
    inputTypes: ["session"],
    outputType: "value",
    example: "198.51.100.42",
    defaultValue: "Not supplied",
  },
  async resolve(entity) {
    return String(tokenEntityOf(entity, "session")?.row.ip ?? "");
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.session.userAgent",
    name: "Session User-Agent",
    description: "The browser/device description supplied at this sign-in, without parsing or inference",
    segmentName: "user_agent",
    inputTypes: ["session"],
    outputType: "value",
    example: "Mozilla/5.0 (Example OS) ExampleBrowser/1.0",
    defaultValue: "Not supplied",
  },
  async resolve(entity) {
    const value = tokenEntityOf(entity, "session")?.row.userAgent;
    return typeof value === "string" ? value : "";
  },
});
