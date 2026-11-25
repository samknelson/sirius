import type { ComponentContributions } from "../../../shared/component-contributions";

export const contributions: ComponentContributions = {
  tabs: [{
    entity: "user",
    tab: { id: 'session_history', label: 'Session History', hrefTemplate: '/users/{id}/session_history', permission: 'admin', component: 'system.session_history' },
  }],
};
