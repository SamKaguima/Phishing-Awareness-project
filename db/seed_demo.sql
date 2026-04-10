INSERT INTO targets (email, full_name, department)
VALUES ('employee1@example.com', 'Employee One', 'IT')
ON CONFLICT (email) DO NOTHING;

INSERT INTO campaigns (name, description)
VALUES ('April Simulation', 'Demo campaign for local testing')
ON CONFLICT DO NOTHING;

INSERT INTO emails (campaign_id, target_id, tracking_token, subject, sent_at)
SELECT c.id, t.id, 'demo-token-001', 'Security Update Required', NOW()
FROM campaigns c
JOIN targets t ON t.email = 'employee1@example.com'
WHERE c.name = 'April Simulation'
ON CONFLICT (tracking_token) DO NOTHING;
