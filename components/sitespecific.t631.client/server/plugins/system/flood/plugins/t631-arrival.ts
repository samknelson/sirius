import { registerFloodPlugin } from "../../../../../../../server/plugins/system/flood/registry";
import { T631_ARRIVAL_IP_FLOOD_EVENT, T631_ARRIVAL_WORKER_FLOOD_EVENT } from "../../../../../../../server/flood/constants";

registerFloodPlugin({
  id: T631_ARRIVAL_WORKER_FLOOD_EVENT, name: "T631 arrival failures per worker", singleton: true,
  requiredComponent: "sitespecific.t631.client",
  description: "Limits failed remote arrival authentication attempts per submitted worker ID.",
  defaults: { threshold: 5, windowSeconds: 60 },
  getIdentifier(context) {
    if (!context.workerIdInput) throw new Error("workerIdInput is required for t631-arrival-worker flood event");
    return context.workerIdInput;
  },
});
registerFloodPlugin({
  id: T631_ARRIVAL_IP_FLOOD_EVENT, name: "T631 arrival failures per IP", singleton: true,
  requiredComponent: "sitespecific.t631.client",
  description: "Limits failed remote arrival authentication attempts per IP address, independently of the per-worker limit.",
  defaults: { threshold: 5, windowSeconds: 60 },
  getIdentifier(context) {
    if (!context.ip) throw new Error("ip is required for t631-arrival-ip flood event");
    return context.ip;
  },
});
