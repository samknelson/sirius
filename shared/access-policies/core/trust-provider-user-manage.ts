import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'trustProvider.userManage',
  description: 'Manage trust provider user accounts',
  scope: 'route',
  component: 'trust.providers.login',
  rules: [{ component: 'trust.providers.login', permission: 'trustprovider.usermanage' }],
});

registerPolicy(policy);
export default policy;
