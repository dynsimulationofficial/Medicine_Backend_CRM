-- Create pgcrypto extension if not exists
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Sequence for lead_number
CREATE SEQUENCE IF NOT EXISTS lead_number_seq START 1;

-- Prevent hard delete function for system_users
CREATE OR REPLACE FUNCTION prevent_hard_delete_system_users()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Hard delete on system_users is not allowed. Use soft delete (deleted_at).';
END;
$$ LANGUAGE plpgsql;

-- 1. assigned_lead_notifications
CREATE TABLE IF NOT EXISTS public.assigned_lead_notifications (
	id uuid NOT NULL,
	recipient_user_id uuid NOT NULL,
	title varchar(255) NOT NULL,
	body varchar(255) NOT NULL,
	"data" jsonb NULL,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL,
	CONSTRAINT assigned_lead_notifications_pkey PRIMARY KEY (id)
);

-- 2. consolidated_credit_statuses
CREATE TABLE IF NOT EXISTS public.consolidated_credit_statuses (
	id uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL,
	is_active bool DEFAULT true NOT NULL,
	CONSTRAINT consolidated_credit_statuses_name_key UNIQUE (name),
	CONSTRAINT consolidated_credit_statuses_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS ix_consolidated_credit_statuses_active ON public.consolidated_credit_statuses USING btree (is_active);

-- 3. email_templates
CREATE TABLE IF NOT EXISTS public.email_templates (
	id uuid NOT NULL,
	title varchar(255) NOT NULL,
	subject varchar(255) NOT NULL,
	body text NOT NULL,
	attachments jsonb NULL,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL,
	deleted_at timestamptz NULL,
	CONSTRAINT email_templates_pkey PRIMARY KEY (id)
);

-- 4. expenses
CREATE TABLE IF NOT EXISTS public.expenses (
	id uuid NOT NULL,
	user_id uuid NOT NULL,
	reason varchar(255) NOT NULL,
	amount numeric(12, 2) NOT NULL,
	expense_date date NOT NULL,
	transaction_date date NULL,
	pay_from uuid NOT NULL,
	description text NULL,
	CONSTRAINT expenses_pkey PRIMARY KEY (id)
);

-- 5. lead_debt_statuses
CREATE TABLE IF NOT EXISTS public.lead_debt_statuses (
	id uuid NOT NULL,
	"name" text NOT NULL,
	is_active bool DEFAULT true NULL,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL,
	CONSTRAINT lead_debt_statuses_name_key UNIQUE (name),
	CONSTRAINT lead_debt_statuses_pkey PRIMARY KEY (id)
);

-- 6. lead_dispositions
CREATE TABLE IF NOT EXISTS public.lead_dispositions (
	id uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	description text NULL,
	is_active bool DEFAULT true NOT NULL,
	created_at timestamptz NOT NULL,
	CONSTRAINT lead_dispositions_name_key UNIQUE (name),
	CONSTRAINT lead_dispositions_pkey PRIMARY KEY (id)
);

-- 7. lead_sources
CREATE TABLE IF NOT EXISTS public.lead_sources (
	id uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL,
	CONSTRAINT lead_sources_name_key UNIQUE (name),
	CONSTRAINT lead_sources_pkey PRIMARY KEY (id)
);

-- 8. permissions
CREATE TABLE IF NOT EXISTS public.permissions (
	id uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	description text NULL,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL,
	CONSTRAINT permissions_name_key UNIQUE (name),
	CONSTRAINT permissions_pkey PRIMARY KEY (id)
);

-- 9. roles
CREATE TABLE IF NOT EXISTS public.roles (
	id uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"level" int4 NOT NULL,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL,
	CONSTRAINT roles_pkey PRIMARY KEY (id)
);

-- 10. web_push_notifications
CREATE TABLE IF NOT EXISTS public.web_push_notifications (
	id uuid NOT NULL,
	"type" varchar(255) NOT NULL,
	ref_id uuid NULL,
	fcmtoken text NOT NULL,
	title varchar(255) NOT NULL,
	body text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	status varchar(255) DEFAULT 'pending'::character varying NOT NULL,
	message_id text NULL,
	error_message text NULL,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL,
	recipient_user_id uuid NULL,
	CONSTRAINT web_push_notifications_pkey PRIMARY KEY (id)
);

-- 11. web_push_tokens
CREATE TABLE IF NOT EXISTS public.web_push_tokens (
	id uuid NOT NULL,
	system_user_id uuid NULL,
	fcmtoken text NOT NULL,
	is_active bool DEFAULT true NULL,
	created_at timestamptz NULL,
	updated_at timestamptz NULL,
	CONSTRAINT web_push_tokens_fcmtoken_key UNIQUE (fcmtoken),
	CONSTRAINT web_push_tokens_pkey PRIMARY KEY (id),
	CONSTRAINT web_push_tokens_system_user_id_key UNIQUE (system_user_id)
);

-- 12. role_permissions
CREATE TABLE IF NOT EXISTS public.role_permissions (
	role_id uuid NOT NULL,
	permission_id uuid NOT NULL,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL,
	CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id)
);

-- 13. system_users
CREATE TABLE IF NOT EXISTS public.system_users (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	mobile_number varchar(255) NOT NULL,
	email varchar(255) NOT NULL,
	"password" varchar(255) NOT NULL,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL,
	deleted_at timestamptz NULL,
	is_blocked bool DEFAULT false NOT NULL,
	blocked_at timestamptz NULL,
	blocked_by uuid NULL,
	block_reason text NULL,
	CONSTRAINT system_users_pkey PRIMARY KEY (id)
);

-- Ensure system_users columns exist
ALTER TABLE public.system_users ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false;
ALTER TABLE public.system_users ADD COLUMN IF NOT EXISTS blocked_at timestamptz NULL;
ALTER TABLE public.system_users ADD COLUMN IF NOT EXISTS blocked_by uuid NULL;
ALTER TABLE public.system_users ADD COLUMN IF NOT EXISTS block_reason text NULL;

-- 14. user_login_otp
CREATE TABLE IF NOT EXISTS public.user_login_otp (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	system_user_id uuid NOT NULL,
	otp varchar(6) NOT NULL,
	is_used bool DEFAULT false NOT NULL,
	expires_at timestamptz NOT NULL,
	created_at timestamptz NOT NULL,
	CONSTRAINT user_login_otp_pkey PRIMARY KEY (id)
);

-- 15. user_otps
CREATE TABLE IF NOT EXISTS public.user_otps (
	id serial4 NOT NULL,
	system_user_id uuid NOT NULL,
	otp varchar(6) NOT NULL,
	is_used bool DEFAULT false NOT NULL,
	expires_at timestamptz NOT NULL,
	created_at timestamptz NOT NULL,
	CONSTRAINT user_otps_pkey PRIMARY KEY (id)
);

-- 16. user_role
CREATE TABLE IF NOT EXISTS public.user_role (
	system_user_id uuid NOT NULL,
	role_id uuid NOT NULL,
	created_at timestamptz NULL,
	updated_at timestamptz NULL,
	CONSTRAINT user_role_pkey PRIMARY KEY (system_user_id, role_id)
);

-- 17. leads
CREATE TABLE IF NOT EXISTS public.leads (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	full_name varchar(255) NOT NULL,
	email varchar(255) NOT NULL,
	phone varchar(255) NOT NULL,
	address_line1 varchar(255) NULL,
	address_line2 varchar(255) NULL,
	city varchar(255) NULL,
	state varchar(255) NULL,
	postal_code varchar(255) NULL,
	country varchar(255) NULL,
	lead_score int4 DEFAULT 0 NULL,
	lead_quality varchar(255) NULL,
	best_time_to_call varchar(255) NULL,
	agent_id uuid NULL,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL,
	deleted_at timestamptz NULL,
	lead_number text DEFAULT 'L'::text || to_char(nextval('lead_number_seq'::regclass), 'FM000000'::text) NOT NULL,
	debt_consolidation_status_id uuid NULL,
	lead_source_id uuid NULL,
	first_name varchar(255) NULL,
	last_name varchar(255) NULL,
	whatsapp_number varchar(30) NULL,
	consolidated_credit_status_id uuid NULL,
	note text NULL,
	status varchar(100) NULL,
	company varchar(255) NULL,
	activity_summary text NULL,
	CONSTRAINT leads_lead_number_key UNIQUE (lead_number),
	CONSTRAINT leads_pkey PRIMARY KEY (id)
);

-- Ensure missing columns exist on leads table
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS first_name varchar(255) NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_name varchar(255) NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS whatsapp_number varchar(30) NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS note text NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS status varchar(100) NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company varchar(255) NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS activity_summary text NULL;

-- 18. system_user_activity
CREATE TABLE IF NOT EXISTS public.system_user_activity (
	id serial4 NOT NULL,
	user_activity varchar(255) NOT NULL,
	"uuid" uuid NOT NULL,
	activity_timestamp timestamptz NULL,
	"module" varchar(255) NULL,
	"type" varchar(255) NULL,
	CONSTRAINT system_user_activity_pkey PRIMARY KEY (id)
);

-- 19. system_user_secret
CREATE TABLE IF NOT EXISTS public.system_user_secret (
	id uuid NOT NULL,
	user_id uuid NOT NULL,
	secret_key varchar(255) NOT NULL,
	description varchar(255) NULL,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL,
	CONSTRAINT system_user_secret_pkey PRIMARY KEY (id),
	CONSTRAINT system_user_secret_secret_key_key UNIQUE (secret_key)
);

-- 20. lead_activity_history
CREATE TABLE IF NOT EXISTS public.lead_activity_history (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	lead_id uuid NOT NULL,
	agent_id uuid NULL,
	disposition_id uuid NOT NULL,
	conversation text NOT NULL,
	occurred_at timestamptz DEFAULT now() NOT NULL,
	created_at timestamptz DEFAULT now() NOT NULL,
	updated_at timestamptz DEFAULT now() NULL,
	deleted_at timestamptz NULL,
	is_edited bool DEFAULT false NULL,
	CONSTRAINT lead_activity_history_pkey PRIMARY KEY (id)
);

-- 21. lead_bulk_documents
CREATE TABLE IF NOT EXISTS public.lead_bulk_documents (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	lead_id uuid NOT NULL,
	file_name varchar(255) NOT NULL,
	storage_path text NOT NULL,
	created_at timestamptz DEFAULT now() NOT NULL,
	updated_at timestamptz DEFAULT now() NOT NULL,
	deleted_at timestamptz NULL,
	CONSTRAINT lead_bulk_documents_pkey PRIMARY KEY (id)
);

-- 22. lead_documents
CREATE TABLE IF NOT EXISTS public.lead_documents (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	lead_id uuid NOT NULL,
	uploaded_by uuid NULL,
	file_name varchar(255) NOT NULL,
	mime_type varchar(100) NOT NULL,
	file_size int8 NOT NULL,
	storage_path text NOT NULL,
	is_image bool DEFAULT false NOT NULL,
	created_at timestamptz DEFAULT now() NOT NULL,
	updated_at timestamptz DEFAULT now() NOT NULL,
	deleted_at timestamptz NULL,
	notes text NULL,
	is_edited bool DEFAULT false NOT NULL,
	edited_by uuid NULL,
	CONSTRAINT lead_documents_pkey PRIMARY KEY (id)
);

ALTER TABLE public.lead_documents ADD COLUMN IF NOT EXISTS notes text NULL;
ALTER TABLE public.lead_documents ADD COLUMN IF NOT EXISTS is_edited bool DEFAULT false NOT NULL;
ALTER TABLE public.lead_documents ADD COLUMN IF NOT EXISTS edited_by uuid NULL;

-- 23. lead_tasks
CREATE TABLE IF NOT EXISTS public.lead_tasks (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	lead_id uuid NOT NULL,
	assigned_agent_id uuid NULL,
	details text NOT NULL,
	timer_minutes int4 NOT NULL,
	timer_hours int4 DEFAULT 0 NOT NULL,
	due_at timestamptz NOT NULL,
	status varchar(20) DEFAULT 'pending'::character varying NOT NULL,
	created_at timestamptz DEFAULT now() NOT NULL,
	updated_at timestamptz DEFAULT now() NOT NULL,
	task_type varchar(20) DEFAULT 'meeting'::character varying NOT NULL,
	subject varchar(255) NULL,
	start_at timestamptz NULL,
	end_at timestamptz NULL,
	"location" varchar(255) NULL,
	deleted_at timestamptz NULL,
	CONSTRAINT lead_tasks_pkey PRIMARY KEY (id)
);
