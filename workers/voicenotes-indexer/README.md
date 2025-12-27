# VoiceNotes Indexer

Cloudflare Worker that automatically indexes voice memos from VoiceNotes, extracts entities using Claude, and syncs to Craft.

## Architecture

```
VoiceNotes App → voicenotes-webhook → voicenotes-indexer (cron 30min) → Claude Sonnet 4 → Craft + KV
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/process` | Manual trigger processing |
| GET | `/status` | Processing stats |
| GET | `/people` | List all tracked people |
| GET | `/extractions` | List all extractions |
| GET | `/extraction/:id` | Get specific extraction with transcript |

## Entity Extraction

Claude extracts:
- **People**: name, role, context, sentiment
- **Topics**: subjects discussed
- **Decisions**: choices made
- **Action Items**: tasks identified
- **Projects**: referenced projects
- **Key Facts**: important information
- **Summary**: one-line overview

## Storage

### KV Namespace: `voicenotes-extractions`

| Key Pattern | Contents |
|-------------|----------|
| `ext:{note_id}` | Full extraction + transcript + audio_url + craft_doc_id |
| `person:{name}` | Person index with mentions[], roles[], sentiment_history[] |
| `_stats` | Processing statistics |

## Craft Integration

- **Folder**: Voice Memos (ID: 7853)
- **Document Structure**: Summary → People → Decisions → Actions → Projects → Key Facts → Full Transcript → Audio Link

## Deployment

```bash
# Set secret
wrangler secret put ANTHROPIC_API_KEY

# Deploy
wrangler deploy
```

## Configuration

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key (secret) |
| `VOICENOTES` | Service binding to voicenotes-webhook |
| `EXTRACTIONS` | KV namespace for storage |

## Cron Schedule

Runs every 30 minutes: `*/30 * * * *`

## Garbage Detection

Automatically skips transcripts containing:
- `eyJ` (JWT tokens)
- `fm2_` (encoded data)
- Less than 20 characters
