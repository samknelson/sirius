import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'facility.view',
  description: 'View facility details',
  scope: 'route',
  component: 'facility',
  rules: [{ authenticated: true }],
});

registerPolicy(policy);
export default policy;
