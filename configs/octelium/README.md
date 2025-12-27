# Octelium Zero-Trust Configuration

Zero-trust security layer for GARZA OS MCP infrastructure.

## Cluster Info
- **Domain**: secure.garzahive.com
- **Server**: octelium-secure (68.183.108.79)
- **Platform**: DigitalOcean + k3s + Octelium v0.23.0

## Files

| File | Description |
|------|-------------|
| `user-jaden.yaml` | Admin user with allow-all policy |
| `idp-github.yaml` | GitHub OAuth2 identity provider (placeholder) |

## Apply Configs

```bash
# SSH to server
ssh root@68.183.108.79

# Login to Octelium
export HOME=/root OCTELIUM_DOMAIN=secure.garzahive.com
octelium login --auth-token "<AUTH_TOKEN>"

# Apply user config
octeliumctl apply /path/to/user-jaden.yaml
```

## Setup GitHub OAuth (TODO)

1. Create GitHub OAuth App at https://github.com/settings/developers
2. Set callback URL: `https://secure.garzahive.com/callback`
3. Create secret: `octeliumctl secret create github-oauth-secret --value "<CLIENT_SECRET>"`
4. Update `idp-github.yaml` with actual client ID
5. Apply: `octeliumctl apply idp-github.yaml`

## Auth Token

Initial root auth token (store securely):
```
AQpABH5JzPOA7l6xd19_82W2_cmzmqWMfPe5JZC6I5Fnqr6CMLp5PS938MhMguDaVzp8bzRubdZJRBSIKocII6HkDRJACAMSECA4oL3EtUxCgMIhW9fm-uUaEObOfOq6UU6Ss4doPnkBgrgiEKKm3Nxm805-rC5ZTi_VW2EqBgi1ldrLBg
```
