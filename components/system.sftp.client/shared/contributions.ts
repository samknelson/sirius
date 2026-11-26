import type { ComponentContributions } from "../../../shared/component-contributions";
declare module "../../../shared/tabRegistry" {
  interface TabEntityTypes { sftp_client_destination: true; }
}
export const contributions: ComponentContributions = {
  tabs: ["details", "connection", "test", "logs", "edit"].map(id => ({
    entity: "sftp_client_destination",
    tab: {
      id, label: id[0].toUpperCase() + id.slice(1),
      hrefTemplate: `/config/sftp/client/{id}${id === "details" ? "" : `/${id}`}`,
      permission: "admin", component: "system.sftp.client",
    },
  })),
};
