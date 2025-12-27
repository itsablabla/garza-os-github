# VoiceNotes Webhook

Cloudflare Worker that syncs voice memos from VoiceNotes.com to Cloudflare KV for processing by GARZA OS.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/sync` | Pull latest recordings from VoiceNotes |
| GET | `/sync` | Get sync status |
| GET | `/notes` | List all notes (supports `?limit=N` and `?unsynced=true`) |
| GET | `/notes/:id` | Get single note |
| DELETE | `/notes/:id` | Delete note |
| POST | `/notes/:id/synced` | Mark note as synced to Craft |
| GET | `/export` | Export all notes as markdown |

## Setup

1. Create KV namespace:
   ```bash
   wrangler kv:namespace create NOTES
   ```

2. Update `wrangler.toml` with the KV namespace ID

3. Set the VoiceNotes API key:
   ```bash
   wrangler secret put VOICENOTES_API_KEY
   ```

4. Deploy:
   ```bash
   wrangler deploy
   ```

## Integration with GARZA OS

When Jaden says "vm", "voice", or "memo", Claude:
1. Calls `POST /sync` to pull latest
2. Calls `GET /notes?limit=1` to get most recent
3. Classifies intent (email/message/task/note/instruction)
4. Proposes action
5. Calls `POST /notes/:id/synced` after processing

## KV Structure

- `note:{id}` - Individual note with transcript, summary, tags
- `_last_sync` - Timestamp of last sync
- `_sync_count` - Total sync operations
