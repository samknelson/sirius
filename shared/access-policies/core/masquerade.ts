import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'masquerade',
  description: 'Impersonate another user',
  scope: 'route',
  rules: [{ anyPermission: ['masquerade', 'admin'] }],
});

registerPolicy(policy);
export default policy;
