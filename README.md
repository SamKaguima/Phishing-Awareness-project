# Phishing-Awareness-project

A simple local simulator that demonstrates how phishing/scams operate via email and how you can avoid them.

## Quick start

1. `npm install`
2. Copy `.env.example` to `.env`
3. Set `DATABASE_URL` in `.env`
4. Create the database schema (run SQL in `db/schema.sql`)
5. Start the server: `npm start`

## Setup 

Use Docker Compose

1. Install Docker Desktop
2. From project root, run: `docker compose up --build`
3. Open app: `http://localhost:3000`
4. Stop services with: `docker compose down`

Notes:

- This starts both app and PostgreSQL.
- Database schema and demo seed data are auto-loaded on first run.
- If you want a fresh database, run: `docker compose down -v` then `docker compose up --build`.

## Environment variables

- `PORT=3000`
- `DATABASE_URL=postgres://postgres:postgres@localhost:5432/phishing_awareness`
- `IP_HASH_SALT=change-me-in-real-env`
- `PG_SSL=false`

## Database model

- `targets`: recipient profiles
- `campaigns`: phishing simulation campaigns
- `emails`: one email sent per target and campaign
- `email_events`: immutable event log (`opened`, `clicked`, etc.)

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

- `db/schema.sql`: tables, constraints, and indexes
- `db/analytics.sql`: starter queries for open/click rates and time-to-click
- `db/seed_demo.sql`: demo campaign/target/email with tracking token `demo-token-001`

## The stack:

- Email design - Canva
- Frontend - HTML/CSS/JS (Landing page)
- Backend - Node.js (CLI app using Nodemailer, Express)

## Checklist:

- [ ] Prompts for email/password in the console
- [ ] Sends email to self using input credentials
- [ ] Links in email redirect back to this local server
- [ ] The landing page is working and informational