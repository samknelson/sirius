import type { ComponentContributions } from "../../../shared/component-contributions";

export const contributions: ComponentContributions = {
  tabs: [
    { entity: "ws_client", before: "test", tab: { id: "freeman-bearer-authorization", label: "Freeman Bearer Authorization", hrefTemplate: "/admin/ws/clients/{id}/freeman-bearer-authorization", permission: "admin", component: "sitespecific.freeman.authorization" } },
  ],
  operationAliases: {
    "authorize-bearer": "sitespecific.freeman.authorization.bearer",
  },
};
