--
-- PostgreSQL database dump
--


-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: bargaining_units; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.users VALUES ('a34c7d38-e6be-4e12-ac83-0c7de80a9bea', '50175491', 'mmcdermott@cgtconsultinginc.com', NULL, NULL, NULL, 'linked', true, '2026-01-13 15:31:00.185393', '2026-01-13 15:31:06.718', '2026-01-13 16:26:37.077', NULL);


--
-- Data for Name: bookmarks; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: cardcheck_definitions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: options_gender; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: contacts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.contacts VALUES ('f55fe2d4-7407-4afe-b81c-8e5b5311ab29', NULL, NULL, NULL, NULL, NULL, NULL, 'Unnamed Contact', 'mmcdermott@cgtconsultinginc.com', NULL, NULL, NULL, NULL);


--
-- Data for Name: options_employer_type; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: policies; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: employers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: files; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: esigs; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: options_worker_ws; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: workers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: cardchecks; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: charge_plugin_configs; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: comm; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: comm_email; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: comm_email_optin; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: comm_inapp; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: comm_postal; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: comm_postal_optin; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: comm_sms; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: comm_sms_optin; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: contact_phone; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: contact_postal; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: cron_jobs; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.cron_jobs VALUES ('delete-expired-reports', 'Deletes wizard report data that has exceeded its retention period', '0 2 * * *', true, NULL, '2026-01-13 15:30:17.027904', '2026-01-13 15:30:17.027904');
INSERT INTO public.cron_jobs VALUES ('delete-old-cron-logs', 'Deletes cron job run logs that are older than 30 days', '0 3 * * *', true, NULL, '2026-01-13 15:30:17.034278', '2026-01-13 15:30:17.034278');
INSERT INTO public.cron_jobs VALUES ('process-wmb-batch', 'Processes pending WMB scan jobs from the queue in batches', '*/5 * * * *', false, NULL, '2026-01-13 15:30:17.042734', '2026-01-13 15:30:17.042734');
INSERT INTO public.cron_jobs VALUES ('delete-expired-flood-events', 'Deletes flood control events that have expired', '0 * * * *', true, NULL, '2026-01-13 15:40:33.910885', '2026-01-13 15:40:33.910885');
INSERT INTO public.cron_jobs VALUES ('delete-expired-hfe', 'Deletes Hold for Employer entries where the hold date has passed', '0 4 * * *', true, NULL, '2026-01-13 15:40:33.919796', '2026-01-13 15:40:33.919796');
INSERT INTO public.cron_jobs VALUES ('sweep-expired-ban-elig', 'Clears dispatch eligibility entries for expired worker bans', '0 5 * * *', true, NULL, '2026-01-13 15:40:33.927546', '2026-01-13 15:40:33.927546');
INSERT INTO public.cron_jobs VALUES ('sync-ban-active-status', 'Synchronizes the active status of worker bans based on their expiration dates', '0 6 * * *', true, NULL, '2026-01-13 15:40:33.93475', '2026-01-13 15:40:33.93475');


--
-- Data for Name: cron_job_runs; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.cron_job_runs VALUES ('01aa9462-2513-48a5-a5f5-a687a7f477c6', 'delete-expired-flood-events', 'error', 'live', NULL, 'relation "flood" does not exist', '2026-01-13 16:00:00.01', '2026-01-13 16:00:00.046', NULL);
INSERT INTO public.cron_job_runs VALUES ('2b733ac8-36d5-40d8-83a7-6174dd8df3ed', 'delete-expired-flood-events', 'success', 'live', '{"executionTimeMs":34,"executionTimeSec":"0.03","summary":{"mode":"live","deletedCount":0}}', NULL, '2026-01-13 17:00:00.013', '2026-01-13 17:00:00.047', NULL);
INSERT INTO public.cron_job_runs VALUES ('65411629-9538-445a-9914-cadfc37ce78a', 'delete-expired-flood-events', 'success', 'live', '{"executionTimeMs":52,"executionTimeSec":"0.05","summary":{"mode":"live","deletedCount":0}}', NULL, '2026-01-13 18:00:00.008', '2026-01-13 18:00:00.06', NULL);
INSERT INTO public.cron_job_runs VALUES ('0c302d47-4b42-4350-a790-c1510792a856', 'delete-expired-flood-events', 'success', 'live', '{"executionTimeMs":33,"executionTimeSec":"0.03","summary":{"mode":"live","deletedCount":0}}', NULL, '2026-01-13 19:00:00.008', '2026-01-13 19:00:00.041', NULL);
INSERT INTO public.cron_job_runs VALUES ('031daec9-da1a-4f98-82fd-86d98cb67dba', 'delete-expired-flood-events', 'success', 'live', '{"executionTimeMs":82,"executionTimeSec":"0.08","summary":{"mode":"live","deletedCount":0}}', NULL, '2026-01-20 17:00:00.02', '2026-01-20 17:00:00.103', NULL);
INSERT INTO public.cron_job_runs VALUES ('c303c8ca-f97d-41ad-84ad-f7cb041128b3', 'delete-expired-flood-events', 'success', 'live', '{"executionTimeMs":260,"executionTimeSec":"0.26","summary":{"mode":"live","deletedCount":0}}', NULL, '2026-01-20 18:00:00.009', '2026-01-20 18:00:00.269', NULL);
INSERT INTO public.cron_job_runs VALUES ('bf54f6c1-6f04-4f31-a998-8c3b34a2221b', 'delete-expired-flood-events', 'success', 'live', '{"executionTimeMs":280,"executionTimeSec":"0.28","summary":{"mode":"live","deletedCount":0}}', NULL, '2026-01-20 19:00:00.012', '2026-01-20 19:00:00.292', NULL);
INSERT INTO public.cron_job_runs VALUES ('16e75bab-17db-4512-8391-61e01bf56a6c', 'delete-expired-flood-events', 'success', 'live', '{"executionTimeMs":283,"executionTimeSec":"0.28","summary":{"mode":"live","deletedCount":0}}', NULL, '2026-01-20 20:00:00.009', '2026-01-20 20:00:00.293', NULL);
INSERT INTO public.cron_job_runs VALUES ('e34a4b63-dd13-42d7-964e-c77b7e3bef94', 'delete-expired-flood-events', 'success', 'live', '{"executionTimeMs":54,"executionTimeSec":"0.05","summary":{"mode":"live","deletedCount":0}}', NULL, '2026-01-20 21:00:00.008', '2026-01-20 21:00:00.062', NULL);
INSERT INTO public.cron_job_runs VALUES ('d5abbe83-ac86-4cd9-901a-be56c1726e8f', 'delete-expired-flood-events', 'success', 'live', '{"executionTimeMs":323,"executionTimeSec":"0.32","summary":{"mode":"live","deletedCount":0}}', NULL, '2026-01-20 22:00:00.008', '2026-01-20 22:00:00.331', NULL);


--
-- Data for Name: options_dispatch_job_type; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dispatch_jobs; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dispatches; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: options_employer_contact_type; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: employer_contacts; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: employer_policy_history; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: options_event_type; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: events; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: event_occurrences; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: event_participants; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: flood; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: ledger_accounts; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: ledger_ea; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: ledger; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: options_ledger_payment_type; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: ledger_payments; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: ledger_stripe_paymentmethods; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: options_employment_status; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: options_skills; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: options_trust_benefit_type; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: options_trust_provider_type; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: options_worker_id_type; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.role_permissions VALUES ('b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', 'workers.manage', '2026-01-13 15:31:00.076368');
INSERT INTO public.role_permissions VALUES ('b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', 'workers.view', '2026-01-13 15:31:00.087719');
INSERT INTO public.role_permissions VALUES ('b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', 'bookmark', '2026-01-13 15:31:00.092546');
INSERT INTO public.role_permissions VALUES ('b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', 'masquerade', '2026-01-13 15:31:00.102889');
INSERT INTO public.role_permissions VALUES ('b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', 'ledger.employer', '2026-01-13 15:31:00.110979');
INSERT INTO public.role_permissions VALUES ('b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', 'ledger.staff', '2026-01-13 15:31:00.115774');
INSERT INTO public.role_permissions VALUES ('b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', 'staff', '2026-01-13 15:31:00.11919');
INSERT INTO public.role_permissions VALUES ('b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', 'provider', '2026-01-13 15:31:00.128267');
INSERT INTO public.role_permissions VALUES ('b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', 'employer', '2026-01-13 15:31:00.143528');
INSERT INTO public.role_permissions VALUES ('b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', 'worker', '2026-01-13 15:31:00.155663');
INSERT INTO public.role_permissions VALUES ('b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', 'admin', '2026-01-13 15:31:00.166794');
INSERT INTO public.role_permissions VALUES ('b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', 'employer.usermanage', '2026-01-13 15:31:00.17796');


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.roles VALUES ('b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', 'admin', 'Administrator role with all permissions', 0, '2026-01-13 15:31:00.061947');


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.sessions VALUES ('_owl-R225DbbbZcFpbJO-K8-ngPU-WZu', '{"cookie": {"path": "/", "secure": false, "expires": "2026-01-20T16:24:50.389Z", "httpOnly": true, "originalMaxAge": 604800000}, "passport": {"user": {"claims": {"aud": "bdf3d54d-6e4e-4fe4-9565-af116a23d02d", "exp": 1768325090, "iat": 1768321490, "iss": "https://replit.com/oidc", "sub": "50175491", "email": "mmcdermott@cgtconsultinginc.com", "at_hash": "BpIdYKd9BIX-FxfzV2QXuA", "username": "mmcdermott4", "auth_time": 1768321490, "last_name": null, "first_name": null}, "dbUser": {"id": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "data": null, "email": "mmcdermott@cgtconsultinginc.com", "isActive": true, "lastName": null, "createdAt": "2026-01-13T15:31:00.185Z", "firstName": null, "lastLogin": "2026-01-13T16:24:42.164Z", "updatedAt": "2026-01-13T15:31:06.718Z", "replitUserId": "50175491", "accountStatus": "linked", "profileImageUrl": null}, "expires_at": 1768325090, "access_token": "-fikeBbkgsV8rimrciEjs5lbR52IKWROS0u1qXZ2Rte", "refresh_token": "Z5psA_hlyalS_zpSNhg6goHu9ixIwdc_c94h05ZTTpA"}}}', '2026-01-20 17:51:40');
INSERT INTO public.sessions VALUES ('JVO8X7bUKgUiCnoNthjoKQ89Qz6rWvT7', '{"cookie": {"path": "/", "secure": false, "expires": "2026-01-20T16:26:37.101Z", "httpOnly": true, "originalMaxAge": 604800000}, "passport": {"user": {"claims": {"aud": "bdf3d54d-6e4e-4fe4-9565-af116a23d02d", "exp": 1768325196, "iat": 1768321596, "iss": "https://replit.com/oidc", "sub": "50175491", "email": "mmcdermott@cgtconsultinginc.com", "at_hash": "3aULFiqSlcYpc5tXgJUf2A", "username": "mmcdermott4", "auth_time": 1768321596, "last_name": null, "first_name": null}, "dbUser": {"id": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "data": null, "email": "mmcdermott@cgtconsultinginc.com", "isActive": true, "lastName": null, "createdAt": "2026-01-13T15:31:00.185Z", "firstName": null, "lastLogin": "2026-01-13T16:24:50.369Z", "updatedAt": "2026-01-13T15:31:06.718Z", "replitUserId": "50175491", "accountStatus": "linked", "profileImageUrl": null}, "expires_at": 1768325196, "access_token": "IFqlf4leEoPtTNSGiwVDCCe7Juqt980W-Kwx0akIqsK", "refresh_token": "4vf_VV51uqJO-Zk3mEA1M94glhXJLxyKltMOCTyduw7"}}}', '2026-01-20 16:26:40');


--
-- Data for Name: sitespecific_btu_csg; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: sitespecific_btu_employer_map; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: trust_benefits; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: trust_providers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: trust_provider_contacts; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: trust_wmb; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: trust_wmb_scan_status; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: trust_wmb_scan_queue; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: user_roles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.user_roles VALUES ('a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', '2026-01-13 15:31:00.191326');


--
-- Data for Name: variables; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.variables VALUES ('e4e8de36-b362-48d5-9583-21e4c13773a6', 'address_validation_config', '{"mode": "local", "local": {"enabled": true, "countries": ["US"], "strictValidation": true}, "google": {"enabled": false, "apiKeyName": "GOOGLE_MAPS_API_KEY", "components": {"country": true, "postal_code": true, "administrative_area_level_1": true}}, "fallback": {"logValidationAttempts": true, "useLocalOnGoogleFailure": true}}');
INSERT INTO public.variables VALUES ('8ae98714-09ce-4e54-bb8d-8cc3044c03bb', 'migrations_version', '1');


--
-- Data for Name: winston_logs; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.winston_logs VALUES (1, 'info', 'Storage operation: variables.create', '2026-01-13 15:30:17.021', 'storage', '{"args": [{"name": "address_validation_config", "value": {"mode": "local", "local": {"enabled": true, "countries": ["US"], "strictValidation": true}, "google": {"enabled": false, "apiKeyName": "GOOGLE_MAPS_API_KEY", "components": {"country": true, "postal_code": true, "administrative_area_level_1": true}}, "fallback": {"logValidationAttempts": true, "useLocalOnGoogleFailure": true}}}], "after": {"id": "e4e8de36-b362-48d5-9583-21e4c13773a6", "name": "address_validation_config", "value": {"mode": "local", "local": {"enabled": true, "countries": ["US"], "strictValidation": true}, "google": {"enabled": false, "apiKeyName": "GOOGLE_MAPS_API_KEY", "components": {"country": true, "postal_code": true, "administrative_area_level_1": true}}, "fallback": {"logValidationAttempts": true, "useLocalOnGoogleFailure": true}}}}', 'variables', 'create', 'address_validation_config', NULL, 'Created variable "address_validation_config"', NULL, NULL, NULL);
INSERT INTO public.winston_logs VALUES (2, 'info', 'Storage operation: users.createRole', '2026-01-13 15:31:00.074', 'storage', '{"args": [{"name": "admin", "description": "Administrator role with all permissions"}], "after": {"id": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "name": "admin", "sequence": 0, "createdAt": "2026-01-13T15:31:00.061Z", "description": "Administrator role with all permissions"}}', 'users', 'createRole', 'admin', NULL, 'Created user "admin"', NULL, NULL, '74.98.244.68');
INSERT INTO public.winston_logs VALUES (3, 'info', 'Storage operation: users.assignPermissionToRole', '2026-01-13 15:31:00.084', 'storage', '{"args": [{"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "permissionKey": "workers.manage"}], "after": {"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "assignedAt": "2026-01-13T15:31:00.076Z", "permissionKey": "workers.manage"}}', 'users', 'assignPermissionToRole', 'b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', NULL, 'assignPermissionToRole on user "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b"', NULL, NULL, '74.98.244.68');
INSERT INTO public.winston_logs VALUES (4, 'info', 'Storage operation: users.assignPermissionToRole', '2026-01-13 15:31:00.138', 'storage', '{"args": [{"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "permissionKey": "provider"}], "after": {"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "assignedAt": "2026-01-13T15:31:00.128Z", "permissionKey": "provider"}}', 'users', 'assignPermissionToRole', 'b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', NULL, 'assignPermissionToRole on user "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b"', NULL, NULL, '74.98.244.68');
INSERT INTO public.winston_logs VALUES (5, 'info', 'Storage operation: users.assignPermissionToRole', '2026-01-13 15:31:00.109', 'storage', '{"args": [{"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "permissionKey": "masquerade"}], "after": {"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "assignedAt": "2026-01-13T15:31:00.102Z", "permissionKey": "masquerade"}}', 'users', 'assignPermissionToRole', 'b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', NULL, 'assignPermissionToRole on user "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b"', NULL, NULL, '74.98.244.68');
INSERT INTO public.winston_logs VALUES (6, 'info', 'Storage operation: users.assignPermissionToRole', '2026-01-13 15:31:00.091', 'storage', '{"args": [{"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "permissionKey": "workers.view"}], "after": {"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "assignedAt": "2026-01-13T15:31:00.087Z", "permissionKey": "workers.view"}}', 'users', 'assignPermissionToRole', 'b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', NULL, 'assignPermissionToRole on user "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b"', NULL, NULL, '74.98.244.68');
INSERT INTO public.winston_logs VALUES (7, 'info', 'Storage operation: users.assignPermissionToRole', '2026-01-13 15:31:00.165', 'storage', '{"args": [{"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "permissionKey": "worker"}], "after": {"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "assignedAt": "2026-01-13T15:31:00.155Z", "permissionKey": "worker"}}', 'users', 'assignPermissionToRole', 'b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', NULL, 'assignPermissionToRole on user "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b"', NULL, NULL, '74.98.244.68');
INSERT INTO public.winston_logs VALUES (8, 'info', 'Storage operation: users.assignPermissionToRole', '2026-01-13 15:31:00.148', 'storage', '{"args": [{"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "permissionKey": "employer"}], "after": {"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "assignedAt": "2026-01-13T15:31:00.143Z", "permissionKey": "employer"}}', 'users', 'assignPermissionToRole', 'b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', NULL, 'assignPermissionToRole on user "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b"', NULL, NULL, '74.98.244.68');
INSERT INTO public.winston_logs VALUES (9, 'info', 'Storage operation: users.assignPermissionToRole', '2026-01-13 15:31:00.101', 'storage', '{"args": [{"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "permissionKey": "bookmark"}], "after": {"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "assignedAt": "2026-01-13T15:31:00.092Z", "permissionKey": "bookmark"}}', 'users', 'assignPermissionToRole', 'b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', NULL, 'assignPermissionToRole on user "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b"', NULL, NULL, '74.98.244.68');
INSERT INTO public.winston_logs VALUES (10, 'info', 'Storage operation: users.assignPermissionToRole', '2026-01-13 15:31:00.125', 'storage', '{"args": [{"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "permissionKey": "staff"}], "after": {"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "assignedAt": "2026-01-13T15:31:00.119Z", "permissionKey": "staff"}}', 'users', 'assignPermissionToRole', 'b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', NULL, 'assignPermissionToRole on user "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b"', NULL, NULL, '74.98.244.68');
INSERT INTO public.winston_logs VALUES (11, 'info', 'Storage operation: users.assignPermissionToRole', '2026-01-13 15:31:00.114', 'storage', '{"args": [{"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "permissionKey": "ledger.employer"}], "after": {"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "assignedAt": "2026-01-13T15:31:00.110Z", "permissionKey": "ledger.employer"}}', 'users', 'assignPermissionToRole', 'b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', NULL, 'assignPermissionToRole on user "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b"', NULL, NULL, '74.98.244.68');
INSERT INTO public.winston_logs VALUES (12, 'info', 'Storage operation: users.assignPermissionToRole', '2026-01-13 15:31:00.118', 'storage', '{"args": [{"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "permissionKey": "ledger.staff"}], "after": {"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "assignedAt": "2026-01-13T15:31:00.115Z", "permissionKey": "ledger.staff"}}', 'users', 'assignPermissionToRole', 'b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', NULL, 'assignPermissionToRole on user "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b"', NULL, NULL, '74.98.244.68');
INSERT INTO public.winston_logs VALUES (13, 'info', 'Storage operation: users.assignPermissionToRole', '2026-01-13 15:31:00.176', 'storage', '{"args": [{"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "permissionKey": "admin"}], "after": {"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "assignedAt": "2026-01-13T15:31:00.166Z", "permissionKey": "admin"}}', 'users', 'assignPermissionToRole', 'b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', NULL, 'assignPermissionToRole on user "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b"', NULL, NULL, '74.98.244.68');
INSERT INTO public.winston_logs VALUES (14, 'info', 'Storage operation: users.assignPermissionToRole', '2026-01-13 15:31:00.184', 'storage', '{"args": [{"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "permissionKey": "employer.usermanage"}], "after": {"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "assignedAt": "2026-01-13T15:31:00.177Z", "permissionKey": "employer.usermanage"}}', 'users', 'assignPermissionToRole', 'b5a7db3c-6abd-4e21-801b-bc05ae9fad0b', NULL, 'assignPermissionToRole on user "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b"', NULL, NULL, '74.98.244.68');
INSERT INTO public.winston_logs VALUES (15, 'info', 'Storage operation: users.assignRoleToUser', '2026-01-13 15:31:00.212', 'storage', '{"args": [{"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "userId": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea"}], "after": {"roleId": "b5a7db3c-6abd-4e21-801b-bc05ae9fad0b", "userId": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "assignedAt": "2026-01-13T15:31:00.191Z"}}', 'users', 'assignRoleToUser', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'Assigned "admin" to Mitchell McDermott', NULL, NULL, '74.98.244.68');
INSERT INTO public.winston_logs VALUES (16, 'info', 'Storage operation: users.createUser', '2026-01-13 15:31:00.19', 'storage', '{"args": [{"email": "mmcdermott@cgtconsultinginc.com", "isActive": true, "lastName": "McDermott", "firstName": "Mitchell", "replitUserId": null, "accountStatus": "pending"}], "after": {"id": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "email": "mmcdermott@cgtconsultinginc.com", "isActive": true, "lastName": "McDermott", "createdAt": "2026-01-13T15:31:00.185Z", "firstName": "Mitchell", "lastLogin": null, "updatedAt": "2026-01-13T15:31:00.185Z", "replitUserId": null, "accountStatus": "pending", "profileImageUrl": null}}', 'users', 'createUser', 'mmcdermott@cgtconsultinginc.com', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'Created user "mmcdermott@cgtconsultinginc.com"', NULL, NULL, '74.98.244.68');
INSERT INTO public.winston_logs VALUES (17, 'info', 'Storage operation: users.linkReplitAccount', '2026-01-13 15:31:06.725', 'storage', '{"args": ["a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "50175491", {"email": "mmcdermott@cgtconsultinginc.com", "lastName": null, "firstName": null}], "after": {"id": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "email": "mmcdermott@cgtconsultinginc.com", "isActive": true, "lastName": null, "createdAt": "2026-01-13T15:31:00.185Z", "firstName": null, "lastLogin": null, "updatedAt": "2026-01-13T15:31:06.718Z", "replitUserId": "50175491", "accountStatus": "linked", "profileImageUrl": null}, "before": {"id": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "email": "mmcdermott@cgtconsultinginc.com", "isActive": true, "lastName": "McDermott", "createdAt": "2026-01-13T15:31:00.185Z", "firstName": "Mitchell", "lastLogin": null, "updatedAt": "2026-01-13T15:31:00.185Z", "replitUserId": null, "accountStatus": "pending", "profileImageUrl": null}, "changes": {"lastName": {"to": null, "from": "McDermott"}, "firstName": {"to": null, "from": "Mitchell"}, "updatedAt": {"to": "2026-01-13T15:31:06.718Z", "from": "2026-01-13T15:31:00.185Z"}, "replitUserId": {"to": "50175491", "from": null}, "accountStatus": {"to": "linked", "from": "pending"}}}', 'users', 'linkReplitAccount', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'Linked Replit account for "mmcdermott@cgtconsultinginc.com"', NULL, NULL, NULL);
INSERT INTO public.winston_logs VALUES (18, 'info', 'Authentication event: login', '2026-01-13 15:31:06.731', 'storage', '{"email": "mmcdermott@cgtconsultinginc.com", "userId": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "replitUserId": "50175491", "accountLinked": true}', 'auth', 'login', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', NULL, 'User logged in (account linked): mmcdermott@cgtconsultinginc.com', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'mmcdermott@cgtconsultinginc.com', NULL);
INSERT INTO public.winston_logs VALUES (19, 'info', 'Storage operation: variables.create', '2026-01-13 15:40:33.902316', 'storage', '{"meta": {"args": [{"name": "migrations_version", "value": 1}], "after": {"id": "8ae98714-09ce-4e54-bb8d-8cc3044c03bb", "name": "migrations_version", "value": 1}}, "service": "sirius"}', 'variables', 'create', 'migrations_version', NULL, 'Created variable "migrations_version"', NULL, NULL, NULL);
INSERT INTO public.winston_logs VALUES (20, 'info', 'Storage operation: contacts.createContact', '2026-01-13 16:24:42.187331', 'storage', '{"meta": {"args": [{"email": "mmcdermott@cgtconsultinginc.com", "given": null, "family": null, "displayName": "Unnamed Contact"}], "after": {"id": "f55fe2d4-7407-4afe-b81c-8e5b5311ab29", "email": "mmcdermott@cgtconsultinginc.com", "given": null, "title": null, "family": null, "gender": null, "middle": null, "birthDate": null, "genderCalc": null, "genderNota": null, "credentials": null, "displayName": "Unnamed Contact", "generational": null}}, "service": "sirius"}', 'contacts', 'createContact', 'Unnamed Contact', 'f55fe2d4-7407-4afe-b81c-8e5b5311ab29', 'Created contact "Unnamed Contact"', NULL, NULL, NULL);
INSERT INTO public.winston_logs VALUES (21, 'info', 'Storage operation: users.updateUser', '2026-01-13 16:24:42.227377', 'storage', '{"meta": {"args": ["a34c7d38-e6be-4e12-ac83-0c7de80a9bea", {"email": "mmcdermott@cgtconsultinginc.com", "lastName": null, "firstName": null}], "after": {"id": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "data": null, "email": "mmcdermott@cgtconsultinginc.com", "isActive": true, "lastName": null, "createdAt": "2026-01-13T15:31:00.185Z", "firstName": null, "lastLogin": "2026-01-13T15:31:06.724Z", "updatedAt": "2026-01-13T15:31:06.718Z", "replitUserId": "50175491", "accountStatus": "linked", "profileImageUrl": null}, "before": {"id": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "data": null, "email": "mmcdermott@cgtconsultinginc.com", "isActive": true, "lastName": null, "createdAt": "2026-01-13T15:31:00.185Z", "firstName": null, "lastLogin": "2026-01-13T15:31:06.724Z", "updatedAt": "2026-01-13T15:31:06.718Z", "replitUserId": "50175491", "accountStatus": "linked", "profileImageUrl": null}}, "service": "sirius"}', 'users', 'updateUser', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'Updated user "mmcdermott@cgtconsultinginc.com" (no changes detected)', NULL, NULL, NULL);
INSERT INTO public.winston_logs VALUES (22, 'info', 'Authentication event: login', '2026-01-13 16:24:42.227447', 'storage', '{"meta": {"email": "mmcdermott@cgtconsultinginc.com", "userId": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "replitUserId": "50175491"}, "service": "sirius"}', 'auth', 'login', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', NULL, 'User logged in: mmcdermott@cgtconsultinginc.com', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'mmcdermott@cgtconsultinginc.com', NULL);
INSERT INTO public.winston_logs VALUES (23, 'info', 'Storage operation: users.updateUser', '2026-01-13 16:24:50.396296', 'storage', '{"meta": {"args": ["a34c7d38-e6be-4e12-ac83-0c7de80a9bea", {"email": "mmcdermott@cgtconsultinginc.com", "lastName": null, "firstName": null}], "after": {"id": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "data": null, "email": "mmcdermott@cgtconsultinginc.com", "isActive": true, "lastName": null, "createdAt": "2026-01-13T15:31:00.185Z", "firstName": null, "lastLogin": "2026-01-13T16:24:42.164Z", "updatedAt": "2026-01-13T15:31:06.718Z", "replitUserId": "50175491", "accountStatus": "linked", "profileImageUrl": null}, "before": {"id": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "data": null, "email": "mmcdermott@cgtconsultinginc.com", "isActive": true, "lastName": null, "createdAt": "2026-01-13T15:31:00.185Z", "firstName": null, "lastLogin": "2026-01-13T16:24:42.164Z", "updatedAt": "2026-01-13T15:31:06.718Z", "replitUserId": "50175491", "accountStatus": "linked", "profileImageUrl": null}}, "service": "sirius"}', 'users', 'updateUser', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'Updated user "mmcdermott@cgtconsultinginc.com" (no changes detected)', NULL, NULL, NULL);
INSERT INTO public.winston_logs VALUES (24, 'info', 'Authentication event: login', '2026-01-13 16:24:50.399889', 'storage', '{"meta": {"email": "mmcdermott@cgtconsultinginc.com", "userId": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "replitUserId": "50175491"}, "service": "sirius"}', 'auth', 'login', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', NULL, 'User logged in: mmcdermott@cgtconsultinginc.com', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'mmcdermott@cgtconsultinginc.com', NULL);
INSERT INTO public.winston_logs VALUES (25, 'info', 'Storage operation: users.updateUser', '2026-01-13 16:26:37.104812', 'storage', '{"meta": {"args": ["a34c7d38-e6be-4e12-ac83-0c7de80a9bea", {"email": "mmcdermott@cgtconsultinginc.com", "lastName": null, "firstName": null}], "after": {"id": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "data": null, "email": "mmcdermott@cgtconsultinginc.com", "isActive": true, "lastName": null, "createdAt": "2026-01-13T15:31:00.185Z", "firstName": null, "lastLogin": "2026-01-13T16:24:50.369Z", "updatedAt": "2026-01-13T15:31:06.718Z", "replitUserId": "50175491", "accountStatus": "linked", "profileImageUrl": null}, "before": {"id": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "data": null, "email": "mmcdermott@cgtconsultinginc.com", "isActive": true, "lastName": null, "createdAt": "2026-01-13T15:31:00.185Z", "firstName": null, "lastLogin": "2026-01-13T16:24:50.369Z", "updatedAt": "2026-01-13T15:31:06.718Z", "replitUserId": "50175491", "accountStatus": "linked", "profileImageUrl": null}}, "service": "sirius"}', 'users', 'updateUser', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'Updated user "mmcdermott@cgtconsultinginc.com" (no changes detected)', NULL, NULL, NULL);
INSERT INTO public.winston_logs VALUES (26, 'info', 'Authentication event: login', '2026-01-13 16:26:37.113219', 'storage', '{"meta": {"email": "mmcdermott@cgtconsultinginc.com", "userId": "a34c7d38-e6be-4e12-ac83-0c7de80a9bea", "replitUserId": "50175491"}, "service": "sirius"}', 'auth', 'login', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', NULL, 'User logged in: mmcdermott@cgtconsultinginc.com', 'a34c7d38-e6be-4e12-ac83-0c7de80a9bea', 'mmcdermott@cgtconsultinginc.com', NULL);


--
-- Data for Name: wizards; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: wizard_employer_monthly; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: wizard_feed_mappings; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: wizard_report_data; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: worker_bans; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: worker_dispatch_dnc; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: worker_dispatch_elig_denorm; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: worker_dispatch_hfe; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: worker_dispatch_status; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: worker_hours; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: worker_ids; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: worker_skills; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: worker_steward_assignments; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: worker_wsh; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Name: employers_sirius_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.employers_sirius_id_seq', 1, false);


--
-- Name: winston_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.winston_logs_id_seq', 26, true);


--
-- Name: workers_sirius_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.workers_sirius_id_seq', 1, false);


--
-- PostgreSQL database dump complete
--

\unrestrict FJOYmoy5J0CKxYeNFmUo2L7LInPjOwqHPIvMs8psfnj5WXecP67baPbpIXE3wkt

