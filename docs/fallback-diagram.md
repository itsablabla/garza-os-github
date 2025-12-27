# Tool Fallback Decision Trees

> Visual representation of execution cascades. Copy mermaid blocks to preview.

---

## Mac Command Execution

```mermaid
flowchart TD
    A[Run command on Mac] --> B{CF MCP:shell_exec}
    B -->|✅ Success| Z[Done]
    B -->|❌ 500 Error| C{CF MCP:ssh_exec<br/>host='mac'}
    C -->|✅ Success| Z
    C -->|❌ Failed| D{SSH Back Up:ssh_exec<br/>host='192.168.4.81'}
    D -->|✅ Success| Z
    D -->|❌ Failed| E[Mac Offline?<br/>Check Tailscale]
    
    style B fill:#4CAF50
    style C fill:#FFC107
    style D fill:#FF9800
    style E fill:#f44336
```

---

## GarzaHive Command Execution

```mermaid
flowchart TD
    A[Run command on GarzaHive] --> B{CF MCP:ssh_exec<br/>host='garzahive'}
    B -->|✅ Success| Z[Done]
    B -->|❌ Failed| C{Garza Hive MCP:execute_command}
    C -->|✅ Success| Z
    C -->|❌ Failed| D{SSH Back Up:ssh_exec<br/>host='64.23.180.137'}
    D -->|✅ Success| Z
    D -->|❌ Failed| E[VPS Down?<br/>Check DigitalOcean]
    
    style B fill:#4CAF50
    style C fill:#FFC107
    style D fill:#FF9800
    style E fill:#f44336
```

---

## File Operations on Mac

```mermaid
flowchart TD
    A[File operation on Mac] --> B{CF MCP:fs_*}
    B -->|✅ Success| Z[Done]
    B -->|❌ Failed| C{CF MCP:shell_exec<br/>cat/echo/mkdir}
    C -->|✅ Success| Z
    C -->|❌ Failed| D{CF MCP:ssh_exec host='mac'<br/>cat/echo/mkdir}
    D -->|✅ Success| Z
    D -->|❌ Failed| E[Escalate to<br/>SSH Back Up]
    
    style B fill:#4CAF50
    style C fill:#FFC107
    style D fill:#FF9800
```

---

## Fly.io Deployment

```mermaid
flowchart TD
    A[Deploy to Fly.io] --> B{scripts/deploy-fly.sh}
    B -->|✅ Success| Z[Done]
    B -->|❌ Auth Error| C[fly auth login]
    C --> B
    B -->|❌ No App| D[fly apps create]
    D --> B
    B -->|❌ Region Error| E[Edit fly.toml<br/>region = 'dfw']
    E --> B
    B -->|❌ OOM| F[fly scale memory 512]
    F --> B
    
    style B fill:#4CAF50
    style C fill:#FFC107
    style D fill:#FFC107
    style E fill:#FFC107
    style F fill:#FFC107
```

---

## Domain + Certificate Setup

```mermaid
flowchart TD
    A[Add custom domain] --> B{scripts/add-domain.sh}
    B -->|✅ DNS Created| C{fly certs add}
    C -->|✅ Cert Issued| Z[Done]
    C -->|⏳ Awaiting| D[Wait 5-10 min]
    D --> E{fly certs show}
    E -->|✅ Issued| Z
    E -->|❌ Still Pending| F[Check DNS points<br/>to app.fly.dev]
    F -->|✅ Correct| D
    F -->|❌ Wrong| G[Fix CNAME record]
    G --> D
    
    style B fill:#4CAF50
    style C fill:#4CAF50
    style D fill:#FFC107
    style F fill:#FF9800
```

---

## Beeper Message Send

```mermaid
flowchart TD
    A[Send Beeper message] --> B{CF MCP:beeper_send_message}
    B -->|✅ Success| Z[Done]
    B -->|❌ Timeout| C[Is Beeper Desktop<br/>running on Mac?]
    C -->|No| D[Start Beeper Desktop]
    D --> B
    C -->|Yes| E{Garza Home MCP:beeper_send_message}
    E -->|✅ Success| Z
    E -->|❌ Failed| F[Check Beeper<br/>login status]
    
    style B fill:#4CAF50
    style E fill:#FFC107
    style F fill:#f44336
```

---

## MCP Tool Selection

```mermaid
flowchart TD
    A[Need to run a tool] --> B{What target?}
    B -->|Mac local| C[CF MCP]
    B -->|GarzaHive VPS| D[CF MCP:ssh_exec<br/>or Garza Hive MCP]
    B -->|Home automation| E[Garza Home MCP]
    B -->|n8n workflows| F[N8N MCP]
    B -->|Beeper messages| G[CF MCP:beeper_*<br/>or Garza Home MCP]
    
    C --> H{Tool type?}
    H -->|Shell| I[shell_exec]
    H -->|Files| J[fs_*]
    H -->|SSH to remote| K[ssh_exec]
    H -->|Cameras| L[unifi_*]
    
    style C fill:#4CAF50
    style D fill:#4CAF50
    style E fill:#2196F3
    style F fill:#9C27B0
    style G fill:#00BCD4
```

---

## Quick Reference Table

| Target | Primary Tool | Fallback 1 | Fallback 2 |
|--------|--------------|------------|------------|
| Mac shell | `CF MCP:shell_exec` | `CF MCP:ssh_exec` host=mac | `SSH Back Up` IP=192.168.4.81 |
| Mac files | `CF MCP:fs_*` | `CF MCP:shell_exec` | `CF MCP:ssh_exec` |
| GarzaHive | `CF MCP:ssh_exec` host=garzahive | `Garza Hive MCP:execute_command` | `SSH Back Up` IP=64.23.180.137 |
| Beeper | `CF MCP:beeper_*` | `Garza Home MCP:beeper_*` | - |
| Cameras | `CF MCP:unifi_*` | `Garza Home MCP:unifi_*` | - |
| Abode | `Garza Home MCP:abode_*` | `Garza Hive MCP:abode_*` | - |
