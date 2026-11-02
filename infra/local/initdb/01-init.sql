\i /migrations/0001_foundation.sql
\i /migrations/0002_scans.sql
\i /migrations/0003_findings.sql
\i /migrations/0004_history.sql
\i /migrations/0005_not_seen.sql

-- Local Compose credential only. Production credentials belong in Secret Manager.
alter role webops_app login password 'webops_dev_password';
alter role webops_worker login password 'webops_worker_dev_password';
