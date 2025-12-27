-- Audit Table Template
-- For tracking changes to important data

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- What changed
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  
  -- Change details
  old_data JSONB,
  new_data JSONB,
  changed_fields TEXT[],
  
  -- Who/when
  performed_by TEXT,
  performed_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Context
  session_id TEXT,
  ip_address INET,
  user_agent TEXT
);

-- Indexes
CREATE INDEX idx_audit_table ON audit_log(table_name);
CREATE INDEX idx_audit_record ON audit_log(record_id);
CREATE INDEX idx_audit_time ON audit_log(performed_at DESC);

-- Function to log changes (call from triggers)
CREATE OR REPLACE FUNCTION log_audit()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    performed_by
  ) VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP != 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) END,
    current_user
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Example: Add audit trigger to a table
-- CREATE TRIGGER audit_my_table
--   AFTER INSERT OR UPDATE OR DELETE ON my_table
--   FOR EACH ROW EXECUTE FUNCTION log_audit();
