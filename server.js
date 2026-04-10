const crypto = require('crypto');
const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const DATABASE_URL = process.env.DATABASE_URL;
const IP_HASH_SALT = process.env.IP_HASH_SALT || 'dev-only-salt-change-me';
const INGESTION_AUDIT_ENABLED = process.env.INGESTION_AUDIT_ENABLED !== 'false';

const pool = DATABASE_URL
    ? new Pool({
        connectionString: DATABASE_URL,
        ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false
    })
    : null;

// Initialize mailer lazily
let _mailer = null;

function getMailer() {
    if (_mailer) return _mailer;
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        throw new Error('SMTP_USER and SMTP_PASS must be set to send emails');
    }
    _mailer = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
    return _mailer;
}

const TRACKING_PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBApXW6Y8AAAAASUVORK5CYII=',
    'base64'
);

app.use(express.json());
app.use(express.static(__dirname));

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || '';
}

function hashIp(ip) {
    if (!ip) {
        return null;
    }
    return crypto.createHash('sha256').update(`${IP_HASH_SALT}:${ip}`).digest('hex');
}

function normalizeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return {};
    }
    return metadata;
}

async function logIngestionAudit({ trackingToken, eventType, status, reason = null, metadata = {} }) {
    if (!pool || !INGESTION_AUDIT_ENABLED) {
        return;
    }

    const safeMetadata = normalizeMetadata(metadata);
    const query = `
        INSERT INTO ingestion_audit_log (tracking_token, event_type, status, reason, metadata)
        VALUES ($1, $2, $3, $4, $5::jsonb);
    `;

    try {
        await pool.query(query, [
            trackingToken || null,
            eventType || null,
            status,
            reason,
            JSON.stringify(safeMetadata)
        ]);
    } catch (error) {
        console.error('Failed to write ingestion audit log:', error.message);
    }
}

async function recordEmailEvent(token, eventType, req, metadata = {}) {
    if (!pool) {
        return { saved: false, status: 'db_not_configured', reason: 'Database is not configured' };
    }

    const ipHash = hashIp(getClientIp(req));
    const userAgent = req.get('user-agent') || null;

    const query = `
        WITH email_match AS (
            SELECT e.id
            FROM emails e
            WHERE e.tracking_token = $1
        ), inserted AS (
            INSERT INTO email_events (email_id, event_type, metadata, ip_hash, user_agent)
            SELECT m.id, $2, $3::jsonb, $4, $5
            FROM email_match m
            ON CONFLICT (email_id, event_type) DO NOTHING
            RETURNING id
        )
        SELECT
            (SELECT COUNT(*)::int FROM email_match) AS email_found,
            (SELECT COUNT(*)::int FROM inserted) AS inserted_count;
    `;

    const values = [token, eventType, JSON.stringify(normalizeMetadata(metadata)), ipHash, userAgent];

    try {
        const result = await pool.query(query, values);
        const summary = result.rows[0];

        if (!summary || summary.email_found === 0) {
            await logIngestionAudit({
                trackingToken: token,
                eventType,
                status: 'invalid_token',
                reason: 'Token not found',
                metadata: { route: req.path }
            });
            return { saved: false, status: 'invalid_token', reason: 'Token not found' };
        }

        if (summary.inserted_count === 0) {
            await logIngestionAudit({
                trackingToken: token,
                eventType,
                status: 'duplicate_ignored',
                reason: 'Duplicate event ignored',
                metadata: { route: req.path }
            });
            return { saved: false, status: 'duplicate_ignored', reason: 'Duplicate event ignored' };
        }

        return { saved: true, status: 'saved' };
    } catch (error) {
        await logIngestionAudit({
            trackingToken: token,
            eventType,
            status: 'db_error',
            reason: error.message,
            metadata: { route: req.path }
        });
        return { saved: false, status: 'db_error', reason: error.message };
    }
}

function resolveTargetUrl(rawTarget) {
    if (typeof rawTarget !== 'string' || rawTarget.length === 0) {
        return '/scamScreen.html';
    }

    try {
        const decoded = decodeURIComponent(rawTarget);
        const parsed = new URL(decoded);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.toString();
        }
    } catch (error) {
        return '/scamScreen.html';
    }

    return '/scamScreen.html';
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', async (req, res) => {
    if (!pool) {
        return res.json({ ok: true, db: 'not-configured' });
    }

    try {
        await pool.query('SELECT 1;');
        return res.json({ ok: true, db: 'connected' });
    } catch (error) {
        return res.status(500).json({ ok: false, db: 'error', message: error.message });
    }
});

app.get('/track/open/:token.png', async (req, res) => {
    const result = await recordEmailEvent(req.params.token, 'opened', req, { source: 'tracking-pixel' });
    if (result.status === 'db_error') {
        console.error('Open tracking failed:', result.reason);
    }

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.send(TRACKING_PIXEL);
});

app.get('/track/click/:token', async (req, res) => {
    const destination = resolveTargetUrl(req.query.to);

    const result = await recordEmailEvent(req.params.token, 'clicked', req, { destination });
    if (result.status === 'db_error') {
        console.error('Click tracking failed:', result.reason);
    }

    return res.redirect(destination);
});

app.get('/api/stats/campaign/:campaignId', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'Database is not configured' });
    }

    const campaignId = Number(req.params.campaignId);
    if (!Number.isInteger(campaignId)) {
        return res.status(400).json({ error: 'campaignId must be an integer' });
    }

    const query = `
        SELECT
            c.id AS campaign_id,
            c.name AS campaign_name,
            COUNT(DISTINCT e.id) AS emails_sent,
            COUNT(DISTINCT e.id) FILTER (WHERE ev.event_type = 'opened') AS emails_opened,
            COUNT(DISTINCT e.id) FILTER (WHERE ev.event_type = 'clicked') AS emails_clicked,
            ROUND(
                100.0 * COUNT(DISTINCT e.id) FILTER (WHERE ev.event_type = 'opened')
                / NULLIF(COUNT(DISTINCT e.id), 0),
                2
            ) AS open_rate_pct,
            ROUND(
                100.0 * COUNT(DISTINCT e.id) FILTER (WHERE ev.event_type = 'clicked')
                / NULLIF(COUNT(DISTINCT e.id), 0),
                2
            ) AS click_rate_pct
        FROM campaigns c
        LEFT JOIN emails e ON e.campaign_id = c.id
        LEFT JOIN email_events ev ON ev.email_id = e.id
        WHERE c.id = $1
        GROUP BY c.id, c.name;
    `;

    try {
        const result = await pool.query(query, [campaignId]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        return res.json(result.rows[0]);
    } catch (error) {
        console.error('Campaign stats query failed:', error.message);
        return res.status(500).json({ error: 'Failed to fetch campaign stats' });
    }
});

// Start a campaign, sending emails to the specified targets
app.post('/api/campaigns/start', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'Database is not configured' });
    }

    const { name, description, subject, emailBody, targetUrl, targets } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: '"name" is required' });
    }
    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
        return res.status(400).json({ error: '"subject" is required' });
    }
    if (!emailBody || typeof emailBody !== 'string' || emailBody.trim().length === 0) {
        return res.status(400).json({ error: '"emailBody" is required' });
    }
    if (!Array.isArray(targets) || targets.length === 0) {
        return res.status(400).json({ error: '"targets" must be a non-empty array' });
    }
    const uniqueTargets = [];
    const seenEmails = new Set();
    for (const t of targets) {
        if (!t.email || typeof t.email !== 'string') {
            return res.status(400).json({ error: 'Each target must have an "email" field' });
        }
        const normalizedEmail = t.email.trim().toLowerCase();
        if (seenEmails.has(normalizedEmail)) {
            continue;
        }
        seenEmails.add(normalizedEmail);
        uniqueTargets.push({ ...t, email: normalizedEmail });
    }
    if (uniqueTargets.length === 0) {
        return res.status(400).json({ error: 'At least one unique target email is required' });
    }

    let transport;
    try {
        transport = getMailer();
    } catch (err) {
        return res.status(503).json({ error: err.message });
    }

    const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const campaignResult = await client.query(
            `INSERT INTO campaigns (name, description, starts_at)
             VALUES ($1, $2, NOW()) RETURNING id`,
            [name.trim(), description || null]
        );
        const campaignId = campaignResult.rows[0].id;

        const results = [];

        for (const t of uniqueTargets) {
            const email = t.email;
            const fullName = t.full_name || null;
            const department = t.department || null;

            // Upsert target (keep existing name/dept if not provided)
            const targetResult = await client.query(
                `INSERT INTO targets (email, full_name, department)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (email) DO UPDATE SET
                     full_name  = COALESCE(EXCLUDED.full_name,  targets.full_name),
                     department = COALESCE(EXCLUDED.department, targets.department)
                 RETURNING id`,
                [email, fullName, department]
            );
            const targetId = targetResult.rows[0].id;

            const token = crypto.randomBytes(24).toString('hex');

            await client.query(
                `INSERT INTO emails (campaign_id, target_id, tracking_token, subject, sent_at)
                 VALUES ($1, $2, $3, $4, NOW())`,
                [campaignId, targetId, token, subject.trim()]
            );

            const clickUrl = targetUrl
                ? `${baseUrl}/track/click/${token}?to=${encodeURIComponent(targetUrl)}`
                : `${baseUrl}/track/click/${token}`;
            const pixelUrl = `${baseUrl}/track/open/${token}.png`;

            const html = emailBody
                .replace(/\{\{name\}\}/g, fullName || email)
                .replace(/\{\{link\}\}/g, clickUrl)
                + `\n<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />`;

            try {
                await transport.sendMail({
                    from: process.env.SMTP_USER,
                    to: email,
                    subject: subject.trim(),
                    html,
                });

                await client.query(
                    `INSERT INTO email_events (email_id, event_type, metadata)
                     SELECT id, 'sent', '{}'::jsonb FROM emails WHERE tracking_token = $1
                     ON CONFLICT (email_id, event_type) DO NOTHING`,
                    [token]
                );

                results.push({ email, status: 'sent', token });
            } catch (sendErr) {
                console.error(`Failed to send to ${email}:`, sendErr.message);
                await logIngestionAudit({
                    trackingToken: token,
                    eventType: 'sent',
                    status: 'smtp_send_failed',
                    reason: sendErr.message,
                    metadata: { email }
                });
                results.push({ email, status: 'failed', reason: sendErr.message });
            }
        }

        await client.query('COMMIT');

        return res.status(201).json({
            campaignId,
            sent: results.filter(r => r.status === 'sent').length,
            failed: results.filter(r => r.status === 'failed').length,
            results,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Campaign start failed:', err.message);
        return res.status(500).json({ error: 'Failed to start campaign' });
    } finally {
        client.release();
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    if (!pool) {
        console.log('DATABASE_URL is not set. Tracking events will not be saved.');
    }
});