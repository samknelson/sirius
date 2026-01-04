/**
 * Policy Loader
 * 
 * Imports all policy files to register them with the policy registry.
 * This file should be imported once during server startup.
 */

import './core/authenticated';
import './core/admin';
import './core/staff';
import './core/masquerade';
import './trust/provider/manage';

import './ledger/stripe-admin';
import './ledger/stripe-employer';
import './ledger/ea/view';
import './ledger/ea/edit';

import './employer/manage';
import './employer/view';
import './employer/mine';
import './employer/ledger';

import './worker/view';
import './worker/edit';
import './worker/mine';
import './worker/ledger';

import './provider/ledger';

import './cardcheck/view';
import './cardcheck/edit';

import './esig/view';
import './esig/edit';

import './file/upload';
import './file/read';
import './file/update';
import './file/delete';

import './contact/view';
import './contact/edit';

import './employer/dispatch';
import './employer/dispatch/manage';
import './worker/dispatch/dnc/view';
import './worker/dispatch/dnc/edit';

export { getAllPolicies, getPolicy, hasPolicy } from './index';
