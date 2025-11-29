CREATE TABLE "bookmarks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charge_plugin_configs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"scope" varchar NOT NULL,
	"employer_id" varchar,
	"settings" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "charge_plugin_configs_plugin_id_scope_employer_id_unique" UNIQUE("plugin_id","scope","employer_id")
);
--> statement-breakpoint
CREATE TABLE "comm" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"medium" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"status" varchar NOT NULL,
	"sent" timestamp,
	"received" timestamp,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "comm_email" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comm_id" varchar NOT NULL,
	"to" text,
	"to_name" varchar,
	"from_address" text,
	"from_name" varchar,
	"reply_to" text,
	"subject" text,
	"body_text" text,
	"body_html" text,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "comm_email_optin" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"optin" boolean DEFAULT false NOT NULL,
	"optin_user" varchar,
	"optin_date" timestamp,
	"optin_ip" varchar,
	"allowlist" boolean DEFAULT false NOT NULL,
	"public_token" varchar,
	"email_valid" boolean,
	"validated_at" timestamp,
	"validation_response" jsonb,
	CONSTRAINT "comm_email_optin_email_unique" UNIQUE("email"),
	CONSTRAINT "comm_email_optin_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "comm_postal" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comm_id" varchar NOT NULL,
	"to_name" varchar,
	"to_company" varchar,
	"to_address_line1" text NOT NULL,
	"to_address_line2" text,
	"to_city" text NOT NULL,
	"to_state" text NOT NULL,
	"to_zip" text NOT NULL,
	"to_country" text DEFAULT 'US' NOT NULL,
	"from_name" varchar,
	"from_company" varchar,
	"from_address_line1" text,
	"from_address_line2" text,
	"from_city" text,
	"from_state" text,
	"from_zip" text,
	"from_country" text DEFAULT 'US',
	"description" text,
	"file_url" text,
	"template_id" varchar,
	"merge_variables" jsonb,
	"color" boolean DEFAULT false NOT NULL,
	"double_sided" boolean DEFAULT false NOT NULL,
	"mail_type" varchar DEFAULT 'usps_first_class' NOT NULL,
	"extra_service" varchar,
	"lob_letter_id" varchar,
	"lob_tracking_events" jsonb,
	"expected_delivery_date" timestamp,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "comm_postal_optin" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_address" text NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"zip" text NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"optin" boolean DEFAULT false NOT NULL,
	"optin_user" varchar,
	"optin_date" timestamp,
	"optin_ip" varchar,
	"allowlist" boolean DEFAULT false NOT NULL,
	"public_token" varchar,
	"deliverable" boolean,
	"deliverability_analysis" jsonb,
	"validated_at" timestamp,
	"validation_response" jsonb,
	CONSTRAINT "comm_postal_optin_canonical_address_unique" UNIQUE("canonical_address"),
	CONSTRAINT "comm_postal_optin_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "comm_sms" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comm_id" varchar NOT NULL,
	"to" varchar,
	"body" text,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "comm_sms_optin" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_number" text NOT NULL,
	"optin" boolean DEFAULT false NOT NULL,
	"optin_user" varchar,
	"optin_date" timestamp,
	"optin_ip" varchar,
	"allowlist" boolean DEFAULT false NOT NULL,
	"public_token" varchar,
	"sms_possible" boolean,
	"voice_possible" boolean,
	"validated_at" timestamp,
	"validation_response" jsonb,
	CONSTRAINT "comm_sms_optin_phone_number_unique" UNIQUE("phone_number"),
	CONSTRAINT "comm_sms_optin_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "contact_postal" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" varchar NOT NULL,
	"friendly_name" text,
	"street" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"country" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"validation_response" jsonb,
	"latitude" double precision,
	"longitude" double precision,
	"accuracy" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"given" text,
	"middle" text,
	"family" text,
	"generational" text,
	"credentials" text,
	"display_name" text NOT NULL,
	"email" text,
	"birth_date" date,
	"gender" varchar,
	"gender_nota" text,
	"gender_calc" text,
	CONSTRAINT "contacts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "cron_job_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"status" varchar NOT NULL,
	"mode" varchar DEFAULT 'live' NOT NULL,
	"output" text,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"triggered_by" varchar
);
--> statement-breakpoint
CREATE TABLE "cron_jobs" (
	"name" text PRIMARY KEY NOT NULL,
	"description" text,
	"schedule" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employer_contacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employer_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"contact_type_id" varchar
);
--> statement-breakpoint
CREATE TABLE "employers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sirius_id" serial NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"stripe_customer_id" text,
	CONSTRAINT "employers_sirius_id_unique" UNIQUE("sirius_id")
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" varchar NOT NULL,
	"storage_path" varchar NOT NULL,
	"mime_type" varchar,
	"size" integer NOT NULL,
	"uploaded_by" varchar NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"entity_type" varchar,
	"entity_id" varchar,
	"access_level" varchar DEFAULT 'private' NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charge_plugin" varchar NOT NULL,
	"charge_plugin_key" varchar NOT NULL,
	"charge_plugin_config_id" varchar,
	"amount" numeric(10, 2) NOT NULL,
	"ea_id" varchar NOT NULL,
	"reference_type" varchar,
	"reference_id" varchar,
	"date" timestamp,
	"memo" text,
	"data" jsonb,
	CONSTRAINT "ledger_charge_plugin_charge_plugin_key_unique" UNIQUE("charge_plugin","charge_plugin_key")
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "ledger_ea" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" varchar NOT NULL,
	"entity_type" varchar NOT NULL,
	"entity_id" varchar NOT NULL,
	"data" jsonb,
	CONSTRAINT "ledger_ea_account_id_entity_id_unique" UNIQUE("account_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_payments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"allocated" boolean DEFAULT false NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"payment_type" varchar NOT NULL,
	"ledger_ea_id" varchar NOT NULL,
	"details" jsonb,
	"date_created" timestamp DEFAULT now() NOT NULL,
	"date_received" timestamp,
	"date_cleared" timestamp,
	"memo" text
);
--> statement-breakpoint
CREATE TABLE "ledger_stripe_paymentmethods" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" varchar NOT NULL,
	"payment_method" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "options_employer_contact_type" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "options_employment_status" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" varchar NOT NULL,
	"employed" boolean DEFAULT false NOT NULL,
	"description" text,
	"sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "options_gender" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" varchar NOT NULL,
	"nota" boolean DEFAULT false NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "options_gender_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "options_ledger_payment_type" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "options_trust_benefit_type" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "options_trust_provider_type" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "options_worker_id_type" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"validator" text
);
--> statement-breakpoint
CREATE TABLE "options_worker_ws" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_phone" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" varchar NOT NULL,
	"friendly_name" text,
	"phone_number" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"validation_response" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" varchar NOT NULL,
	"permission_key" text NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust_benefits" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"benefit_type" varchar,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "trust_provider_contacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"contact_type_id" varchar
);
--> statement-breakpoint
CREATE TABLE "trust_providers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "trust_wmb" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"worker_id" varchar NOT NULL,
	"employer_id" varchar NOT NULL,
	"benefit_id" varchar NOT NULL,
	CONSTRAINT "trust_wmb_worker_id_employer_id_benefit_id_month_year_unique" UNIQUE("worker_id","employer_id","benefit_id","month","year")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" varchar NOT NULL,
	"role_id" varchar NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"replit_user_id" varchar,
	"email" varchar NOT NULL,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"account_status" varchar DEFAULT 'pending' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_login" timestamp,
	CONSTRAINT "users_replit_user_id_unique" UNIQUE("replit_user_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "variables" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "variables_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "winston_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"level" varchar(20),
	"message" text,
	"timestamp" timestamp DEFAULT now(),
	"source" varchar(50),
	"meta" jsonb,
	"module" varchar(100),
	"operation" varchar(100),
	"entity_id" varchar(255),
	"host_entity_id" varchar(255),
	"description" text,
	"user_id" varchar(255),
	"user_email" varchar(255),
	"ip_address" varchar(45)
);
--> statement-breakpoint
CREATE TABLE "wizard_employer_monthly" (
	"wizard_id" varchar PRIMARY KEY NOT NULL,
	"employer_id" varchar NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizard_feed_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"type" varchar NOT NULL,
	"first_row_hash" varchar NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizard_report_data" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wizard_id" varchar NOT NULL,
	"pk" varchar NOT NULL,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "idx_wizard_report_data_wizard_id_pk" UNIQUE("wizard_id","pk")
);
--> statement-breakpoint
CREATE TABLE "wizards" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" timestamp DEFAULT now() NOT NULL,
	"type" varchar NOT NULL,
	"status" varchar NOT NULL,
	"current_step" varchar,
	"entity_id" varchar,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "worker_hours" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"day" integer NOT NULL,
	"worker_id" varchar NOT NULL,
	"employer_id" varchar NOT NULL,
	"employment_status_id" varchar NOT NULL,
	"hours" double precision,
	"home" boolean DEFAULT false NOT NULL,
	CONSTRAINT "worker_hours_worker_id_employer_id_year_month_day_unique" UNIQUE("worker_id","employer_id","year","month","day")
);
--> statement-breakpoint
CREATE TABLE "worker_ids" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" varchar NOT NULL,
	"type_id" varchar NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "worker_ids_type_id_value_unique" UNIQUE("type_id","value")
);
--> statement-breakpoint
CREATE TABLE "worker_wsh" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"worker_id" varchar NOT NULL,
	"ws_id" varchar NOT NULL,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sirius_id" serial NOT NULL,
	"contact_id" varchar NOT NULL,
	"ssn" text,
	"denorm_ws_id" varchar,
	"denorm_home_employer_id" varchar,
	"denorm_employer_ids" varchar[],
	CONSTRAINT "workers_sirius_id_unique" UNIQUE("sirius_id"),
	CONSTRAINT "workers_ssn_unique" UNIQUE("ssn")
);
--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_plugin_configs" ADD CONSTRAINT "charge_plugin_configs_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm" ADD CONSTRAINT "comm_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_email" ADD CONSTRAINT "comm_email_comm_id_comm_id_fk" FOREIGN KEY ("comm_id") REFERENCES "public"."comm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_email_optin" ADD CONSTRAINT "comm_email_optin_optin_user_users_id_fk" FOREIGN KEY ("optin_user") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_postal" ADD CONSTRAINT "comm_postal_comm_id_comm_id_fk" FOREIGN KEY ("comm_id") REFERENCES "public"."comm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_postal_optin" ADD CONSTRAINT "comm_postal_optin_optin_user_users_id_fk" FOREIGN KEY ("optin_user") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_sms" ADD CONSTRAINT "comm_sms_comm_id_comm_id_fk" FOREIGN KEY ("comm_id") REFERENCES "public"."comm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_sms_optin" ADD CONSTRAINT "comm_sms_optin_optin_user_users_id_fk" FOREIGN KEY ("optin_user") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_postal" ADD CONSTRAINT "contact_postal_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_gender_options_gender_id_fk" FOREIGN KEY ("gender") REFERENCES "public"."options_gender"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_job_runs" ADD CONSTRAINT "cron_job_runs_job_name_cron_jobs_name_fk" FOREIGN KEY ("job_name") REFERENCES "public"."cron_jobs"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employer_contacts" ADD CONSTRAINT "employer_contacts_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employer_contacts" ADD CONSTRAINT "employer_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employer_contacts" ADD CONSTRAINT "employer_contacts_contact_type_id_options_employer_contact_type_id_fk" FOREIGN KEY ("contact_type_id") REFERENCES "public"."options_employer_contact_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_ea_id_ledger_ea_id_fk" FOREIGN KEY ("ea_id") REFERENCES "public"."ledger_ea"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_ea" ADD CONSTRAINT "ledger_ea_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_payments" ADD CONSTRAINT "ledger_payments_payment_type_options_ledger_payment_type_id_fk" FOREIGN KEY ("payment_type") REFERENCES "public"."options_ledger_payment_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_payments" ADD CONSTRAINT "ledger_payments_ledger_ea_id_ledger_ea_id_fk" FOREIGN KEY ("ledger_ea_id") REFERENCES "public"."ledger_ea"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_phone" ADD CONSTRAINT "contact_phone_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_benefits" ADD CONSTRAINT "trust_benefits_benefit_type_options_trust_benefit_type_id_fk" FOREIGN KEY ("benefit_type") REFERENCES "public"."options_trust_benefit_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_provider_contacts" ADD CONSTRAINT "trust_provider_contacts_provider_id_trust_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."trust_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_provider_contacts" ADD CONSTRAINT "trust_provider_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_provider_contacts" ADD CONSTRAINT "trust_provider_contacts_contact_type_id_options_trust_provider_type_id_fk" FOREIGN KEY ("contact_type_id") REFERENCES "public"."options_trust_provider_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_wmb" ADD CONSTRAINT "trust_wmb_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_wmb" ADD CONSTRAINT "trust_wmb_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_wmb" ADD CONSTRAINT "trust_wmb_benefit_id_trust_benefits_id_fk" FOREIGN KEY ("benefit_id") REFERENCES "public"."trust_benefits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizard_employer_monthly" ADD CONSTRAINT "wizard_employer_monthly_wizard_id_wizards_id_fk" FOREIGN KEY ("wizard_id") REFERENCES "public"."wizards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizard_employer_monthly" ADD CONSTRAINT "wizard_employer_monthly_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizard_feed_mappings" ADD CONSTRAINT "wizard_feed_mappings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizard_report_data" ADD CONSTRAINT "wizard_report_data_wizard_id_wizards_id_fk" FOREIGN KEY ("wizard_id") REFERENCES "public"."wizards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_hours" ADD CONSTRAINT "worker_hours_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_hours" ADD CONSTRAINT "worker_hours_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_hours" ADD CONSTRAINT "worker_hours_employment_status_id_options_employment_status_id_fk" FOREIGN KEY ("employment_status_id") REFERENCES "public"."options_employment_status"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_ids" ADD CONSTRAINT "worker_ids_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_ids" ADD CONSTRAINT "worker_ids_type_id_options_worker_id_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."options_worker_id_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_wsh" ADD CONSTRAINT "worker_wsh_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_wsh" ADD CONSTRAINT "worker_wsh_ws_id_options_worker_ws_id_fk" FOREIGN KEY ("ws_id") REFERENCES "public"."options_worker_ws"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_denorm_ws_id_options_worker_ws_id_fk" FOREIGN KEY ("denorm_ws_id") REFERENCES "public"."options_worker_ws"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_denorm_home_employer_id_employers_id_fk" FOREIGN KEY ("denorm_home_employer_id") REFERENCES "public"."employers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_winston_logs_entity_id" ON "winston_logs" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "idx_winston_logs_host_entity_id" ON "winston_logs" USING btree ("host_entity_id");--> statement-breakpoint
CREATE INDEX "idx_winston_logs_module" ON "winston_logs" USING btree ("module");--> statement-breakpoint
CREATE INDEX "idx_winston_logs_operation" ON "winston_logs" USING btree ("operation");--> statement-breakpoint
CREATE INDEX "idx_winston_logs_user_id" ON "winston_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_wizard_employer_monthly_period" ON "wizard_employer_monthly" USING btree ("year","month");--> statement-breakpoint
CREATE INDEX "idx_wizard_employer_monthly_employer" ON "wizard_employer_monthly" USING btree ("employer_id");--> statement-breakpoint
CREATE INDEX "idx_wizard_feed_mappings_user_type_hash" ON "wizard_feed_mappings" USING btree ("user_id","type","first_row_hash");--> statement-breakpoint
CREATE INDEX "idx_wizard_report_data_wizard_id" ON "wizard_report_data" USING btree ("wizard_id");