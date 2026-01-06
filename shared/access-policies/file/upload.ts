import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'files.upload',
  description: 'Upload files',
  scope: 'route',
  rules: [
    { permission: 'files.upload' },
    { permission: 'staff' },
  ],
});

registerPolicy(policy);
export default policy;
