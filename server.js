const crypto = require('crypto');
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const DATABASE_URL = process.env.DATABASE_URL;
const IP_HASH_SALT = process.env.IP_HASH_SALT || 'dev-only-salt-change-me';

const pool = DATABASE_URL
    ? new Pool({
        connectionString: DATABASE_URL,
        ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false
    })
    : null;

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

async function recordEmailEvent(token, eventType, req, metadata = {}) {
    if (!pool) {
        return { saved: false, reason: 'Database is not configured' };
    }

    const ipHash = hashIp(getClientIp(req));
    const userAgent = req.get('user-agent') || null;

    const query = `
        INSERT INTO email_events (email_id, event_type, metadata, ip_hash, user_agent)
        SELECT e.id, $2, $3::jsonb, $4, $5
        FROM emails e
        WHERE e.tracking_token = $1
        RETURNING id;
    `;

    const values = [token, eventType, JSON.stringify(metadata), ipHash, userAgent];
    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
        return { saved: false, reason: 'Token not found' };
    }

    return { saved: true };
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
    try {
        await recordEmailEvent(req.params.token, 'opened', req, { source: 'tracking-pixel' });
    } catch (error) {
        console.error('Open tracking failed:', error.message);
    }

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.send(TRACKING_PIXEL);
});

app.get('/track/click/:token', async (req, res) => {
    const destination = resolveTargetUrl(req.query.to);

    try {
        await recordEmailEvent(req.params.token, 'clicked', req, { destination });
    } catch (error) {
        console.error('Click tracking failed:', error.message);
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

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    if (!pool) {
        console.log('DATABASE_URL is not set. Tracking events will not be saved.');
    }
});