import { anyPermissionPolicy, registerPolicy } from '../index';

const policy = anyPermissionPolicy(
  'worker.list',
  ['staff', 'trust.provider'],
  'View the worker list'
);

registerPolicy(policy);
export default policy;
