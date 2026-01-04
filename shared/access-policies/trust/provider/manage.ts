import { definePolicy, registerPolicy } from '../../index';

const policy = definePolicy({
  id: 'trust.provider.manage',
  description: 'Manage trust provider user accounts',
  scope: 'route',
  component: 'trust.providers.login',
  rules: [{ component: 'trust.providers.login', permission: 'trustprovider.usermanage' }],
});

registerPolicy(policy);
export default policy;
