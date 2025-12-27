# GARZA Home Stack

Replicable Home Assistant deployment for GARZA properties.

## Locations
- **Boulder** - Mac mini (primary)
- [Add more locations here]

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

## MCP Integration
Claude/GARZA OS controls this via Home Assistant MCP Server integration.
Configure at: Settings > Devices & Services > Add Integration > MCP Server

## Per-Location Config
Edit `config/configuration.yaml`:
- homeassistant.name: Location name
- homeassistant.time_zone: Local timezone
