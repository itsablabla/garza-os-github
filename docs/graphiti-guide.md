# Graphiti Knowledge Graph Guide

**Graphiti stores relationship and context data that persists across sessions.**

---

## What is Graphiti?

A knowledge graph that stores:
- **Entities**: People, projects, companies, concepts
- **Facts**: Relationships between entities
- **Episodes**: Events/conversations that created facts

---

## When to Use Graphiti

### ✅ Add Episode When:
- Learning something new about a person
- Making a decision that should be remembered
- Completing a project milestone
- Having a significant conversation
- Discovering a new relationship between things

### ❌ Don't Add When:
- Routine task completion
- Temporary information
- Already in Craft docs
- Sensitive/private data

---

## Tools Available

### Search (read)
```
Garza Home MCP:graphiti_search
- query: "search terms"
- limit: number of results (optional)
```

**Use for:**
- Finding context before responding
- Looking up what's known about a person
- Finding related information

### Get Facts (read)
```
Garza Home MCP:graphiti_get_facts
- entity: "person or thing name"
```

**Use for:**
- Getting all known facts about an entity
- Understanding relationships

### Add Episode (write)
```
Garza Home MCP:graphiti_add_episode
- name: "Episode title"
- content: "What happened / what was learned"
- source: "Where this came from" (optional)
```

**Use for:**
- Recording new information
- Documenting decisions
- Storing conversation outcomes

---

## Episode Format

### Good Episode
```json
{
  "name": "Learned Travis prefers morning meetings",
  "content": "In conversation on 2025-01-15, Travis mentioned he's most productive in mornings and prefers scheduling calls before 11am. He finds afternoon meetings disruptive to deep work.",
  "source": "Beeper conversation"
}
```

### Bad Episode
```json
{
  "name": "Travis chat",
  "content": "Talked to Travis",
  "source": ""
}
```

---

## Best Practices

### 1. Be Specific
```
❌ "Met with Eric"
✅ "Eric confirmed Q1 budget is approved at $50k. Mentioned concern about timeline."
```

### 2. Include Context
```
❌ "Jessica likes flowers"
✅ "Jessica mentioned she loves peonies, especially pink ones. Good for anniversary gift ideas."
```

### 3. Note Relationships
```
❌ "David is helpful"
✅ "David Ronca is on SOAB advisory board. Expert in operations. Reports he's available Tuesdays."
```

### 4. Include Dates When Relevant
```
✅ "As of Dec 2024, Verizon debt stands at $2.8M. Payment plan discussed but not finalized."
```

---

## Query Patterns

### Before contacting someone
```
1. graphiti_search query="[person name]"
2. graphiti_get_facts entity="[person name]"
3. Review what's known
4. Tailor communication accordingly
```

### After significant conversation
```
1. Identify key facts learned
2. graphiti_add_episode with structured content
3. Include: who, what, when, decisions, next steps
```

### Starting a project
```
1. graphiti_search query="[project/topic]"
2. See what's already known
3. Build on existing context
```

---

## Integration with Memory

```
┌─────────────────────────────────────────────┐
│              Claude Memory                   │
│  (User edits - persistent instructions)      │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│              Graphiti                        │
│  (Facts, relationships, episodes)            │
│  - Who knows who                             │
│  - What decisions were made                  │
│  - Historical context                        │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│              Craft Docs                      │
│  (Structured documents, SOPs, configs)       │
│  - Master config                             │
│  - Identity map                              │
│  - Project docs                              │
└─────────────────────────────────────────────┘
```

**Rule**: Graphiti for facts/relationships, Craft for documents/procedures.

---

## Common Entities

- **People**: Family, business contacts, friends
- **Companies**: Last Rock, Nomad Internet, partners
- **Projects**: GARZA OS, Jessica Program, etc.
- **Decisions**: Major choices with context
- **Preferences**: Personal preferences discovered over time
