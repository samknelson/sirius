import { definePolicy, registerPolicy } from '../../index';

const policy = definePolicy({
  id: 'trust.provider.manage',
  description: 'Manage trust provider user accounts',
  scope: 'route',
  component: 'trust.providers.login',
  rules: [{ permission: 'trust.provider.manage' }],
});

registerPolicy(policy);
export default policy;
