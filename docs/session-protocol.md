# Session Protocol

**Standard operating procedure for every Claude session.**

---

## 🚀 Session Start

### Automatic (Claude does this)
```
1. Load docs/claude-preflight.md from memory
2. Apply stack-first.md principles
3. Use credentials-index.md for any API calls
```

### Optional (If needed)
```bash
# Run health check if building/deploying
/Users/customer/garza-os-github/scripts/health-check.sh

# Check for failed deploys
flyctl status -a <recent-app>
```

---

## 🔨 During Session

### Before Building Anything New
1. ✅ Check stack-first.md - can existing tools do it?
2. ✅ Check DEPLOYED.yml - is something similar running?
3. ✅ Check templates/ - is there a starter?
4. ✅ Check snippets/ - is the pattern already written?

### When Hitting Errors
1. ✅ Check error-playbook.md for known solutions
2. ✅ Follow fallback-diagram.md for alternatives
3. ✅ Log new errors and solutions

### When Using APIs
1. ✅ Get credentials from vault first: `CF MCP:get_secret`
2. ✅ Use curl-examples.md for tested commands
3. ✅ Check credentials-index.md for auth format

---

## 🏁 Session End

### Always Do
```bash
# If you changed code/config
cd /Users/customer/garza-os-github
git add -A
git commit -m "Description of changes"
git push

# If you deployed something
# → Update DEPLOYED.yml with new app/service
```

### If Applicable
```
# If you solved a new error
→ Add to docs/error-playbook.md

# If you wrote reusable code
→ Add to templates/snippets/

# If you built something significant
→ Create Craft doc in /System/

# If you learned something about a person/project
→ Add Graphiti episode
```

---

## 📋 Checklist Format

### Quick Session (< 10 min)
```
□ Answer question / complete task
□ Commit if changed files
```

### Build Session (new feature/app)
```
□ Load preflight.md
□ Check stack-first.md
□ Check templates
□ Build
□ Test
□ Deploy (if needed)
□ Update DEPLOYED.yml
□ Commit + push
□ Add to error-playbook if new errors
```

### Debug Session
```
□ Check error-playbook.md
□ Follow fallback chain
□ Fix issue
□ Document solution in error-playbook.md
□ Commit
```

---

## 🚨 Red Flags (Stop and Check)

| If you're doing this... | Stop and... |
|------------------------|-------------|
| Installing new database | Check Supabase first |
| Setting up new VPS | Use Fly.io instead |
| Writing custom scheduler | Use n8n or CF Worker cron |
| Hardcoding API keys | Put in Supabase vault |
| Guessing API endpoints | Check curl-examples.md |
| Trying random MCP tools | Check DEPLOYED.yml for right server |

---

## 📊 Session Metrics (Mental Model)

**Good session:**
- 0-1 wrong tool selections
- 0 credential hunts (knew where to look)
- Changes committed
- Docs updated if learned something

**Bad session:**
- 3+ tool changes mid-task
- Guessing API keys/endpoints
- Built something that already existed
- No commit at end
