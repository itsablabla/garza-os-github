# Runbook: Add Supabase Table

## Prerequisites
- Supabase project access
- Service key: `CF MCP:get_secret name="supabase_service_key"`

## Steps

### 1. Plan the schema
```sql
-- What data are you storing?
-- What queries will you run?
-- What indexes do you need?
```

### 2. Create via Dashboard (preferred)
1. Go to Supabase Dashboard → Table Editor
2. Click "New Table"
3. Define columns with types
4. Set primary key (usually `id uuid default gen_random_uuid()`)
5. Add created_at/updated_at timestamps
6. Enable RLS if needed

### 3. Or create via SQL
```sql
CREATE TABLE my_table (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add index for common queries
CREATE INDEX idx_my_table_name ON my_table(name);

-- Enable RLS
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;

-- Add policy (example: allow all for service role)
CREATE POLICY "Service role full access" ON my_table
  FOR ALL USING (auth.role() = 'service_role');
```

### 4. Or via API
```bash
# Using the Supabase SQL endpoint
curl -X POST "https://PROJECT.supabase.co/rest/v1/rpc/exec_sql" \
  -H "apikey: SERVICE_KEY" \
  -H "Authorization: Bearer SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "CREATE TABLE..."}'
```

### 5. Test CRUD operations
```bash
# Insert
curl -X POST "https://PROJECT.supabase.co/rest/v1/my_table" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "test"}'

# Select
curl "https://PROJECT.supabase.co/rest/v1/my_table?select=*" \
  -H "apikey: $ANON_KEY"
```

### 6. Document
- Add schema to `/templates/supabase/schemas/`
- Note table in relevant project docs

## Common Patterns

**Audit table**
```sql
created_at TIMESTAMPTZ DEFAULT NOW(),
updated_at TIMESTAMPTZ DEFAULT NOW(),
created_by UUID REFERENCES auth.users(id),
updated_by UUID REFERENCES auth.users(id)
```

**Soft delete**
```sql
deleted_at TIMESTAMPTZ,
-- Query with: WHERE deleted_at IS NULL
```

**JSONB for flexible data**
```sql
metadata JSONB DEFAULT '{}'::JSONB,
-- Query with: metadata->>'key' or metadata @> '{"key": "value"}'
```
