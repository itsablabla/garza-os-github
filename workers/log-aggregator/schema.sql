-- GARZA OS Log Aggregator Schema
-- Run: wrangler d1 execute garza-logs --file=schema.sql

CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  level TEXT DEFAULT 'info',
  message TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  timestamp TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_logs_service ON logs(service);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_service_timestamp ON logs(service, timestamp DESC);

-- Cleanup old logs (run periodically)
-- DELETE FROM logs WHERE timestamp < datetime('now', '-7 days');
