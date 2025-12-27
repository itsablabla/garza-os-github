-- Basic Table Template
-- Copy and modify for new tables

CREATE TABLE IF NOT EXISTS table_name (
  -- Primary key
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Your columns here
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active',
  data JSONB DEFAULT '{}'::JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_table_name_status ON table_name(status);
CREATE INDEX IF NOT EXISTS idx_table_name_created ON table_name(created_at DESC);

-- Enable RLS
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- Policy: Service role has full access
CREATE POLICY "Service role full access" ON table_name
  FOR ALL 
  TO service_role
  USING (true);

-- Optional: Anon read access
-- CREATE POLICY "Anon read access" ON table_name
--   FOR SELECT
--   TO anon
--   USING (status = 'public');

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_table_name_updated_at
  BEFORE UPDATE ON table_name
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
