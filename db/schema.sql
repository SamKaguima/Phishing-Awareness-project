CREATE TABLE IF NOT EXISTS targets (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    department TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT targets_email_not_blank CHECK (length(trim(email)) > 0)
);

CREATE TABLE IF NOT EXISTS campaigns (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT campaigns_name_not_blank CHECK (length(trim(name)) > 0),
    CONSTRAINT campaigns_valid_date_range CHECK (ends_at IS NULL OR starts_at IS NULL OR starts_at <= ends_at)
);

CREATE TABLE IF NOT EXISTS emails (
    id BIGSERIAL PRIMARY KEY,
    campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    target_id BIGINT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    tracking_token TEXT NOT NULL UNIQUE,
    subject TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT emails_tracking_token_not_blank CHECK (length(trim(tracking_token)) > 0),
    CONSTRAINT emails_subject_not_blank CHECK (subject IS NULL OR length(trim(subject)) > 0),
    CONSTRAINT emails_sent_at_not_before_created CHECK (sent_at IS NULL OR sent_at >= created_at),
    CONSTRAINT emails_one_per_target_per_campaign UNIQUE (campaign_id, target_id)
);

CREATE TABLE IF NOT EXISTS email_events (
    id BIGSERIAL PRIMARY KEY,
    email_id BIGINT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'sent',
        'delivered',
        'opened',
        'clicked',
        'reported',
        'bounced'
    )),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_hash TEXT,
    user_agent TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT email_events_metadata_is_object CHECK (jsonb_typeof(metadata) = 'object'),
    CONSTRAINT email_events_ip_hash_format CHECK (ip_hash IS NULL OR length(ip_hash) = 64),
    CONSTRAINT email_events_unique_per_type_per_email UNIQUE (email_id, event_type)
);

CREATE TABLE IF NOT EXISTS ingestion_audit_log (
    id BIGSERIAL PRIMARY KEY,
    tracking_token TEXT,
    event_type TEXT,
    status TEXT NOT NULL CHECK (status IN (
        'saved',
        'duplicate_ignored',
        'invalid_token',
        'db_error',
        'smtp_send_failed'
    )),
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ingestion_audit_metadata_is_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_emails_campaign_id ON emails(campaign_id);
CREATE INDEX IF NOT EXISTS idx_emails_target_id ON emails(target_id);
CREATE INDEX IF NOT EXISTS idx_emails_tracking_token ON emails(tracking_token);

CREATE INDEX IF NOT EXISTS idx_email_events_email_id ON email_events(email_id);
CREATE INDEX IF NOT EXISTS idx_email_events_type ON email_events(event_type);
CREATE INDEX IF NOT EXISTS idx_email_events_occurred_at ON email_events(occurred_at);

CREATE INDEX IF NOT EXISTS idx_ingestion_audit_status ON ingestion_audit_log(status);
CREATE INDEX IF NOT EXISTS idx_ingestion_audit_created_at ON ingestion_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_ingestion_audit_tracking_token ON ingestion_audit_log(tracking_token);
