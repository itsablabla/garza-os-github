# UniFi Protect + Home Assistant Integration

Self-hosted home automation with full UniFi Protect camera integration.

## Overview

Home Assistant is the best self-hosted option for UniFi Protect integration. It provides:
- Live camera feeds via RTSP
- Motion/person/vehicle detection events
- Doorbell events and two-way audio
- Smart sensor integration (leak, motion, contact)
- PTZ camera controls
- LED and LCD message control

**Note:** UniFi Protect itself cannot be self-hosted—it requires Ubiquiti hardware (Dream Machine, Cloud Key, or UNVR). Home Assistant integrates with Protect running on your existing hardware.

## Prerequisites

- UniFi Protect running on UDM/Cloud Key/UNVR
- Home Assistant installed (see boulder-home stack)
- Local network access between HA and Protect console

## Setup Steps

### 1. Create Local User in UniFi

1. Log into your UniFi OS Console (not unifi.ui.com)
2. Go to **Settings > Admins & Users**
3. Click **Add Admin**
4. Configure:
   - **Account Type:** Local Access Only
   - **Username:** `homeassistant` (or similar)
   - **Password:** Strong, unique password
   - **Role:** Limited Admin or Full Admin
   - **Protect Permission:** Administrator (for full control)

⚠️ **SSO/cloud accounts won't work**—must be local.

### 2. Generate API Key

1. Log into Local Portal as administrator
2. Go to **Settings > Control Plane > Integrations**
3. Click **Create API Key**
4. Name it `Home Assistant`
5. Copy the generated key—you won't see it again

### 3. Enable RTSP on Cameras

1. In Protect, go to each camera's settings
2. Enable **RTSP Stream** (may be on by default)
3. Note: HA uses RTSP(S) for live feeds

### 4. Add Integration in Home Assistant

1. Go to **Settings > Devices & Services**
2. Click **Add Integration**
3. Search for **UniFi Protect**
4. Enter:
   - **Host:** IP of your UDM/Cloud Key/UNVR
   - **Port:** 443 (default)
   - **Username:** The local user you created
   - **Password:** The password
   - **API Key:** The key you generated
5. Click Submit

## Entities Created

Each camera gets:
- `camera.{name}` - Live feed
- `binary_sensor.{name}_motion` - Motion detection
- `binary_sensor.{name}_doorbell` - Ring events (doorbells)
- `sensor.{name}_detection_type` - Person/vehicle/etc
- `switch.{name}_recording` - Toggle recording
- `select.{name}_recording_mode` - Always/motion/never

Smart sensors get:
- `binary_sensor.{name}` - Open/closed or motion
- `sensor.{name}_battery` - Battery level
- `sensor.{name}_temperature` - Temperature
- `sensor.{name}_humidity` - Humidity
- `sensor.{name}_light` - Light level

## Example Automations

### Motion Light Trigger
```yaml
alias: "Front Door Motion - Turn On Lights"
trigger:
  - platform: state
    entity_id: binary_sensor.g4_doorbell_motion
    to: "on"
condition:
  - condition: sun
    after: sunset
action:
  - service: light.turn_on
    target:
      entity_id: light.front_porch
  - delay: "00:05:00"
  - service: light.turn_off
    target:
      entity_id: light.front_porch
```

### Person Detection Notification
```yaml
alias: "Person Detected - Send Alert"
trigger:
  - platform: state
    entity_id: sensor.driveway_camera_detected_object
    to: "person"
action:
  - service: notify.mobile_app
    data:
      title: "Person Detected"
      message: "Someone at the driveway"
      data:
        image: "/api/camera_proxy/camera.driveway"
```

### Doorbell Ring to Sonos Announcement
```yaml
alias: "Doorbell - Announce on Speakers"
trigger:
  - platform: state
    entity_id: binary_sensor.g4_doorbell_doorbell
    to: "on"
action:
  - service: tts.speak
    target:
      entity_id: tts.google_en_com
    data:
      cache: true
      media_player_entity_id: media_player.living_room_sonos
      message: "Someone is at the front door"
```

## GARZA OS Integration

The `garza-home-mcp` server already includes UniFi tools:
- `unifi_list_cameras` - List all cameras
- `unifi_get_snapshot` - Get camera snapshot  
- `unifi_get_events` - Motion/detection events
- `unifi_list_sensors` - Door/motion sensors
- `unifi_set_light` - Control smart lights

For advanced automations, use Home Assistant's REST API.

### Trigger HA Automation from Claude
```bash
curl -X POST \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "automation.front_door_motion"}' \
  https://homeassistant.local:8123/api/services/automation/trigger
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Invalid authentication" | Use local user, not SSO |
| Camera shows unavailable | Enable RTSP in camera settings |
| No motion events | Check Protect detection zones are enabled |
| API key rejected | Regenerate key, ensure admin created it |
| Lag on live feed | Use lower quality stream or RTSPS |

## Alternatives Considered

| Platform | UniFi Protect Support | Notes |
|----------|----------------------|-------|
| **Home Assistant** | ✅ Official integration | Best option |
| Hubitat | ⚠️ Community driver | Less reliable |
| openHAB | ⚠️ Community binding | Requires more setup |
| Homebridge | ✅ Plugin available | HomeKit only |
| Node-RED | ⚠️ Webhooks/RTSP | Not a full platform |

## Related Docs

- [Boulder Home Stack](/stacks/boulder-home/README.md)
- [Services Registry](/infra/services.yml)
