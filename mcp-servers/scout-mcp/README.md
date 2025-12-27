# Scout MCP

MCP server for Scout APM monitoring and performance insights.

## Features
- List applications
- Get app metrics (response time, throughput)
- Get endpoint metrics
- View traces and spans
- Error group analysis
- Performance insights (N+1, memory bloat, slow queries)
- Setup instructions for frameworks

## Deployment
Cloudflare Workers (MCP Agent)

## Environment Variables
- `SCOUT_API_KEY` - Scout APM API key

## Supported Frameworks
- FastAPI, Django, Flask
- Rails, Celery, Dramatiq
- SQLAlchemy, and more

## Tech Stack
- TypeScript
- @modelcontextprotocol/sdk
- Zod validation
