import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'workers.comm',
  description: 'Access worker communication features (SMS, email, postal, in-app)',
  scope: 'entity',
  entityType: 'worker',
  
  rules: [
    { permission: 'staff' }
  ],
});

registerPolicy(policy);
export default policy;
