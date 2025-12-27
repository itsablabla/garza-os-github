# Runbook: Create New n8n Workflow

## Prerequisites
- n8n Cloud access: https://jadengarza.app.n8n.cloud
- API key in vault: `CF MCP:get_secret name="n8n_cloud_api"`

## Steps

### 1. Plan the workflow
```
Trigger → What starts it?
  - Webhook (external call)
  - Schedule (cron)
  - Manual (button)
  - Event (email, etc)

Steps → What does it do?
  - HTTP Request (call APIs)
  - Code (JavaScript)
  - IF (branching)
  - Set (transform data)

Output → What happens at end?
  - HTTP Response
  - Send message (Beeper/email)
  - Store data (Supabase)
```

### 2. Create via UI (preferred)
1. Go to https://jadengarza.app.n8n.cloud
2. Click "Add Workflow"
3. Add trigger node
4. Add processing nodes
5. Test with sample data
6. Activate

### 3. Or create via API
```bash
# Get API key
API_KEY=$(CF MCP:get_secret name="n8n_cloud_api")

# Create workflow
curl -X POST "https://jadengarza.app.n8n.cloud/api/v1/workflows" \
  -H "X-N8N-API-KEY: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Workflow",
    "nodes": [...],
    "connections": {...}
  }'
```

### 4. Common patterns

**Webhook → Process → Respond**
```
Webhook → Set → HTTP Response
```

**Scheduled job**
```
Schedule Trigger → HTTP Request → IF → Slack/Email
```

**Data sync**
```
Schedule → Supabase (read) → Loop → HTTP Request → Supabase (write)
```

### 5. Test the workflow
```bash
# For webhook workflows
curl -X POST "https://jadengarza.app.n8n.cloud/webhook/xxx" \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# For manual trigger
curl -X POST "https://jadengarza.app.n8n.cloud/api/v1/workflows/{id}/execute" \
  -H "X-N8N-API-KEY: $API_KEY"
```

### 6. Document
- Add workflow ID to relevant docs
- Note webhook URL if applicable
- Add to DEPLOYED.yml if significant

## Templates
See `/templates/n8n/` for starter workflows.
