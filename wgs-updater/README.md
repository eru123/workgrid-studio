# wgs-updater

Cloudflare Worker that serves as the auto-update endpoint for WorkGrid Studio's built-in Tauri updater.

When the desktop app checks for updates it calls this worker. The worker queries the GitHub Releases API, compares the latest release against the client's current version using semver, and — if a newer release exists — returns the Tauri-compatible update payload including the signed asset download URL and its detached signature.

## Endpoint

```
GET /api/update/:target/:current_version
```

| Parameter | Description |
|---|---|
| `target` | Tauri target triple, e.g. `windows-x86_64`, `darwin-aarch64`, `linux-x86_64` |
| `current_version` | Semver string of the installed app, e.g. `0.1.3` or `app-v0.1.3` |

### Responses

| Status | Meaning |
|---|---|
| `200 OK` | Update available — body is the Tauri updater JSON payload |
| `204 No Content` | Already on the latest version, or no matching asset in the release |
| `400 Bad Request` | Unsupported `target` value |
| `500 Internal Server Error` | GitHub API request failed |

### 200 payload

```json
{
  "version": "app-v0.1.4",
  "notes": "- feat: something new",
  "pub_date": "2026-03-14T00:00:00Z",
  "signature": "<base64 minisign signature>",
  "url": "https://github.com/eru123/workgrid-studio/releases/download/app-v0.1.4/WorkGrid-Studio_0.1.4_x64-setup.nsis.zip"
}
```

## Platform → asset mapping

| `target` contains | Asset suffix |
|---|---|
| `windows` | `x64-setup.nsis.zip` |
| `darwin-aarch64` | `aarch64.app.tar.gz` |
| `darwin-x86_64` / `darwin-intel` | `x64.app.tar.gz` |
| `linux` | `amd64.AppImage.tar.gz` |

Both the asset and its `.sig` sidecar must be present in the release for the worker to return a 200.

## Environment variables / secrets

| Name | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | Optional | GitHub personal access token — raises the API rate limit from 60 to 5 000 req/hr |

Set it as a Wrangler secret so it is never stored in plain text:

```bash
npx wrangler secret put GITHUB_TOKEN
```

## Development

```bash
# Install dependencies
npm install

# Start local dev server at http://localhost:8787
npx wrangler dev

# Example request
curl "http://localhost:8787/api/update/windows-x86_64/0.1.0"
```

## Deployment

```bash
# Deploy to Cloudflare Workers (custom domain: wgs-updater.skiddph.com)
npx wrangler deploy

# Regenerate TypeScript bindings after changing wrangler.jsonc
npx wrangler types
```

## Project structure

```
wgs-updater/
├── src/
│   ├── index.ts          # Hono app — defines the /api/update route
│   └── types.ts          # Shared TypeScript types (UpdateResponse, etc.)
├── worker-configuration.d.ts   # Auto-generated Cloudflare env bindings
├── wrangler.jsonc        # Wrangler / Worker configuration
├── tsconfig.json
└── package.json
```
