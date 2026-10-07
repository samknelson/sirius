import { registerTokenPlugin } from "../registry";
import { tokenEntityOf } from "../types";

/** A closed event snapshot, not the live sessions table or session JSON. */
registerTokenPlugin({
  metadata: {
    id: "token.session",
    name: "Sign-in session",
    description: "The session IP captured at a successful sign-in",
    // The notifier registry owns the named root. This is only its closed
    // kind descriptor, like other notifier-only record kinds.
    segmentName: "__session",
    inputTypes: [],
    outputType: "session",
    hiddenFromPicker: true,
    entityFields: ["ip"],
    defaultLeaf: "ip",
    sampleSets: [{
      id: "martian", label: "Martian",
      values: { ip: "198.51.100.42" },
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
  },
  async resolve(entity) {
    return String(tokenEntityOf(entity, "session")?.row.ip ?? "");
  },
});
