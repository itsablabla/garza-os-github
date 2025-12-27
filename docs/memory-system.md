# GARZA OS Memory System

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     MEMORY SOURCES                          │
├─────────────────────────────────────────────────────────────┤
│ 1. Claude Memory Edits (30 slots × 200 chars)              │
│ 2. Craft (2,698+ voice memos, contact profiles, docs)      │
│ 3. Graphiti (knowledge graph)                               │
│ 4. Conversation tools (conversation_search, recent_chats)   │
│ 5. Beeper chat history                                      │
│ 6. Gmail/Calendar                                           │
└─────────────────────────────────────────────────────────────┘
```

## Context Loading Priority

1. **Graphiti search** - Knowledge graph for relationships/facts
2. **Craft docs** - Central source of truth
3. **Beeper conversations** - Recent chat context
4. **Calendar/Email** - Appointments and correspondence

## Active Systems

### VoiceNotes Indexer
- **Location**: `workers/voicenotes-indexer/`
- **URL**: https://voicenotes-indexer.jadengarza.workers.dev
- **Function**: Polls VoiceNotes webhook, extracts entities via Claude, syncs to Craft
- **Cron**: Every 30 minutes

**Pipeline:**
```
VoiceNotes Webhook → Indexer (cron 30min) → Claude Sonnet 4 → Craft Doc + People Index
```

**Entity Extraction:**
- People (name, role, context, sentiment)
- Topics
- Decisions
- Action items
- Projects
- Key facts

**Storage:**
- `ext:{note_id}` - Full extraction + transcript
- `person:{name}` - Person index with mentions, roles, sentiment
- Craft docs in Voice Memos folder (ID: 7853)

### Craft Knowledge Base
- **MCP**: https://mcp.craft.do/links/KvkWq8X8cFZ/mcp
- **Content**: 2,698+ voice memos, contact profiles, project docs
- **Folder Structure**:
  - `/Garza Memory/` - System docs, contacts, voice memos
  - `/Voice Memos/` - Raw transcripts
  - `/AI Cology/` - Relationship intelligence

### Graphiti Knowledge Graph
- **Server**: Garza Home MCP (localhost:3000)
- **Purpose**: Relationship tracking, temporal facts, episode storage
- **Status**: Running but MCP tools need debugging

### Memory Edits
- **Limit**: 30 slots × 200 chars each
- **Strategy**: Use as pointers to Craft docs, not full rules
- **Master Config**: Craft doc 14219

## Known Issues

### 1. Context Loading Not Enforced
Instructions say to load context before responding, but no automated trigger.

**Fix**: Add mandatory first-action protocol in memory edits.

### 2. Graphiti Underutilized
MCP tools error out despite server running.

**Fix**: Debug Garza Home MCP graphiti tools.

### 3. No Unified Search
Each source searched separately, no combined results.

**Fix**: Build unified memory search worker.

### 4. Conversation Capture Unreliable
Claude Memory Pipeline built but waiting for non-existent API.

**Fix**: Use end-of-chat extraction + conversation transcripts.

## Planned Improvements

### Phase 1: Fix Graphiti
Debug why `graphiti_add_episode` fails in Garza Home MCP.

### Phase 2: Expand VoiceNotes Indexer
- Auto-update person profiles in Craft
- Topic threading (group related memos)
- Action item extraction with due dates
- Weekly digests

### Phase 3: Unified Memory Search
Single Cloudflare Worker that queries:
- Craft search
- Graphiti facts
- Beeper messages
- VoiceNotes KV

Returns merged, ranked results.

## Key Documents

| Doc | Craft ID | Purpose |
|-----|----------|---------|
| Master Config | 14219 | All GARZA OS rules |
| Identity Map | 12112 | Contact chat IDs |
| API Keys | 6801 | Credentials |
| Infrastructure | 20684 | Server/MCP docs |

## Post-Chat Protocol

After significant conversations:
1. Create Graphiti episode with facts/decisions
2. Create Craft doc in `/Garza Memory/System/` if significant
3. Update relevant person profiles if people discussed

---

*Last Updated: 2025-12-27*
