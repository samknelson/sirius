import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'bulk.edit',
  description: 'Access bulk messaging pages',
  scope: 'route',
  component: 'bulk',
  rules: [{ anyPermission: ['admin', 'staff.bulk'] }],
});

registerPolicy(policy);
export default policy;
