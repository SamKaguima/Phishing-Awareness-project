# Phishing-Awareness-project

A simple local simulator that demonstrates how phishing/scams operate via email and how you can avoid them.

## Prerequisites

- Docker Desktop (recommended for team/grading portability)
- Optional for local non-Docker run: Node.js 20+ and PostgreSQL

## Quick Start (Docker)

1. Install Docker Desktop.
2. From project root, run: `docker compose up --build`
3. Open app: `http://localhost:3000`
4. Stop services with: `docker compose down`

Notes:

- This starts both app and PostgreSQL.
- Database schema and demo seed data are auto-loaded on first run.
- To reset the database, run: `docker compose down -v` then `docker compose up --build`.

## Optional Local Run (without Docker)

1. `npm install`
2. Copy `.env.example` to `.env`
3. Set `DATABASE_URL` in `.env`
4. Create database and run schema: `psql -d phishing_awareness -f .\db\schema.sql`
5. Optional seed data: `psql -d phishing_awareness -f .\db\seed_demo.sql`
6. Start app: `npm start`

Environment variables for local run:

- `PORT=3000`
- `DATABASE_URL=postgres://postgres:postgres@localhost:5432/phishing_awareness`
- `IP_HASH_SALT=change-me-in-real-env`
- `PG_SSL=false`
- `INGESTION_AUDIT_ENABLED=true`
- `SMTP_USER=your-gmail@gmail.com`
- `SMTP_PASS=your-16-char-app-password`

## Verify It Works

- Landing page: `http://localhost:3000`
- Admin dashboard: `http://localhost:3000/admin.html`
- Health check: `http://localhost:3000/health`
- Campaign stats example: `http://localhost:3000/api/stats/campaign/1`

## Database model

- `targets`: recipient profiles
- `campaigns`: phishing simulation campaigns
- `emails`: one email sent per target and campaign
- `email_events`: immutable event log (`opened`, `clicked`, etc.)
- `ingestion_audit_log`: records ingestion issues (`invalid_token`, duplicate ignored, DB errors)

## Event data contract

Use this contract for all event ingestion so analytics stay consistent.

### Canonical event types

- `sent`: app attempted to send the email
- `delivered`: provider accepted delivery
- `opened`: tracking pixel endpoint requested
- `clicked`: tracked link endpoint requested
- `reported`: user reported suspected phishing
- `bounced`: delivery failed

### Required fields per event

- `event_type`: one of the canonical values above
- `occurred_at`: server timestamp
- `tracking_token`: token that maps to one record in `emails`
- `email_id`: resolved by token lookup in the backend
- `campaign_id`: linked through the email record
- `target_id`: linked through the email record

### Optional fields

- `user_agent`
- `ip_hash` (never store raw IP)
- `metadata` JSON (for destination URL, source, or extra context)

### Ingestion rules

- Only accept known `event_type` values
- Generate `occurred_at` server-side
- Do not store raw client IP values
- Keep event writes resilient (log failures, do not crash request flow)
- Treat repeated open/click calls as possible duplicates during analytics

Ingestion reliability behavior:

- Duplicate events for the same `email_id + event_type` are ignored.
- Invalid tracking tokens are logged to `ingestion_audit_log`.
- Database write failures are logged to `ingestion_audit_log`.

## Tracking endpoints

- Open pixel: `/track/open/:token.png`
- Click redirect: `/track/click/:token?to=<urlencoded-target-url>`

Example click URL:

`http://localhost:3000/track/click/abc123?to=https%3A%2F%2Fexample.com`

## Stats endpoint

Campaign summary:

`GET /api/stats/campaign/:campaignId`

Example:

`http://localhost:3000/api/stats/campaign/1`

## SQL files

- `db/schema.sql`: create tables, constraints, and indexes
- `db/seed_demo.sql`: insert demo campaign, target, and email token (`demo-token-001`)
- `db/analytics.sql`: run starter analytics queries (rates and time-to-click)

Quick audit check query:

`SELECT status, COUNT(*) FROM ingestion_audit_log GROUP BY status ORDER BY status;`

## Data Portability

- Docker makes runtime setup portable across teammates and grading machines.
- Live DB data in Docker volumes is local to each machine.
- Export/import your dataset when you need to share exact results.

PowerShell export example:

`pg_dump -U postgres -d phishing_awareness > data_dump.sql`

PowerShell import example:

`psql -U postgres -d phishing_awareness -f .\data_dump.sql`

## The stack:

- Email design - Canva
- Frontend - HTML/CSS/JS (Landing page)
- Backend - Node.js (CLI app using Nodemailer, Express), PostgreSQL

## Current status

- [ ] Prompts for email/password in the console
- [ ] Sends email to self using input credentials
- [ ] Links in email redirect back to this local server
- [ ] The landing page is working and informational