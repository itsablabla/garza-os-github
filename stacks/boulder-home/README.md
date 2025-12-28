# GARZA Home Stack

Replicable Home Assistant deployment for GARZA properties with full UniFi Protect integration.

## Locations
- **Boulder** - Mac mini (primary)

## Quick Deploy
```bash
git clone [repo-url] garza-home-stack
cd garza-home-stack
cp config/secrets.yaml.example config/secrets.yaml
# Edit secrets.yaml with location-specific values
docker compose up -d
```

## Architecture
- Home Assistant (host network mode, port 8123)
- Mosquitto MQTT (ports 1883, 9001)
- [Optional] Zigbee2MQTT (uncomment in docker-compose.yml)

## Integrations

### UniFi Protect
Full camera and sensor integration. See [UniFi Protect Guide](/docs/integrations/unifi-protect.md)

**Quick setup:**
1. Create local user in UniFi OS Console
2. Generate API key (Settings > Control Plane > Integrations)
3. Add UniFi Protect integration in HA
4. Use host IP, local username, password, and API key

### Abode Security
Native Home Assistant integration for alarm panel and devices.

### MCP Integration
Claude/GARZA OS controls this via `garza-home-mcp` server running on Fly.io.
Direct HA API access available via long-lived token.

## Per-Location Config
Edit `config/configuration.yaml`:
- homeassistant.name: Location name
- homeassistant.time_zone: Local timezone
- homeassistant.latitude/longitude: For sun automations

## Secrets Required
```yaml
# config/secrets.yaml
unifi_host: "192.168.1.1"
unifi_username: "homeassistant"
unifi_password: "your-password"
unifi_api_key: "your-api-key"
abode_username: "email@example.com"
abode_password: "password"
```

## Useful Commands
```bash
# View logs
docker compose logs -f homeassistant

# Restart HA
docker compose restart homeassistant

# Update
docker compose pull && docker compose up -d

# Check config
docker exec homeassistant python -m homeassistant --script check_config -c /config
```

## Related Docs
- [UniFi Protect Integration](/docs/integrations/unifi-protect.md)
- [Services Registry](/infra/services.yml)
- [Garza Home MCP](/mcp-servers/garza-home/)
