import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'facility.edit',
  description: 'Edit facility details',
  scope: 'entity',
  entityType: 'facility',
  component: 'facility',
  rules: [{ permission: 'staff' }],
});

registerPolicy(policy);
export default policy;
