-- MCP Router Database Schema

-- Table to store registered MCP servers
CREATE TABLE IF NOT EXISTS mcp_servers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    url TEXT NOT NULL,
    auth_key TEXT,  -- Optional auth key for the MCP server
    enabled BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 100,  -- Lower = higher priority
    health_status TEXT DEFAULT 'unknown',  -- healthy, unhealthy, unknown
    last_health_check TIMESTAMPTZ,
    tool_manifest JSONB,  -- Cached tool definitions
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_priority ON mcp_servers(priority);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_mcp_servers_updated_at ON mcp_servers;
CREATE TRIGGER update_mcp_servers_updated_at
    BEFORE UPDATE ON mcp_servers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Table to log tool calls (optional, for debugging)
CREATE TABLE IF NOT EXISTS mcp_tool_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    server_id UUID REFERENCES mcp_servers(id),
    tool_name TEXT NOT NULL,
    input JSONB,
    output JSONB,
    duration_ms INTEGER,
    success BOOLEAN,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for log queries
CREATE INDEX IF NOT EXISTS idx_mcp_tool_logs_server ON mcp_tool_logs(server_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_logs_created ON mcp_tool_logs(created_at DESC);

-- Insert some initial MCP servers (your current setup)
INSERT INTO mcp_servers (name, description, url, auth_key, enabled, priority) VALUES
    ('CF MCP', 'Mac orchestration and SSH gateway', 'https://mcp-cf.garzahive.com/sse', NULL, true, 10),
    ('Garza Hive MCP', 'Primary VPS operations', 'https://mcp.garzahive.com/sse', NULL, true, 20),
    ('Garza Home MCP', 'Home automation and local services', 'https://garza-home-mcp.fly.dev/sse', NULL, true, 30),
    ('N8N MCP', 'Workflow automation server', 'https://n8n-mcp.garzahive.com/sse', NULL, true, 40)
ON CONFLICT (name) DO UPDATE SET
    url = EXCLUDED.url,
    description = EXCLUDED.description,
    priority = EXCLUDED.priority;
