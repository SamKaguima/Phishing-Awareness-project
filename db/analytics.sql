-- 1) Campaign summary (open/click rates)
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
GROUP BY c.id, c.name
ORDER BY c.id;

-- 2) Time-to-click per email (minutes after sent)
SELECT
    e.id AS email_id,
    e.sent_at,
    MIN(ev.occurred_at) FILTER (WHERE ev.event_type = 'clicked') AS first_click_at,
    EXTRACT(EPOCH FROM (
        MIN(ev.occurred_at) FILTER (WHERE ev.event_type = 'clicked') - e.sent_at
    )) / 60.0 AS minutes_to_first_click
FROM emails e
LEFT JOIN email_events ev ON ev.email_id = e.id
GROUP BY e.id, e.sent_at
ORDER BY e.id;

-- 3) Repeat clickers by target
SELECT
    t.id AS target_id,
    t.email,
    COUNT(*) AS click_events
FROM targets t
JOIN emails e ON e.target_id = t.id
JOIN email_events ev ON ev.email_id = e.id
WHERE ev.event_type = 'clicked'
GROUP BY t.id, t.email
ORDER BY click_events DESC;
