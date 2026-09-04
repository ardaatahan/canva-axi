# canva-axi

AXI-compliant CLI for Canva designs via Canva API — agent-ergonomic
slideshow/design ops. Built against Spec `axi/1.0-2026-07`, Node.js 20+,
TypeScript, and Canva's official public Connect REST API.

Phase A intentionally exposes only verified Canva operations: design metadata,
blank preset/custom creation, PNG/JPEG export jobs and downloads, and
dataset-backed text/image Autofill updates. It does not use Canva MCP.

## Install

```sh
npm install
npm run build
npm link
canva-axi --help
```

Without linking, run `node bin/canva-axi.js`.

## Authentication

Canva Connect uses OAuth 2.0 Authorization Code flow with PKCE. Every shipped
API endpoint requires a user bearer access token with the relevant scopes.
Supply that token only through this CLI's environment interface:

```sh
export CANVA_ACCESS_TOKEN="<OAuth user access token>"
```

`CANVA_ACCESS_TOKEN` is the package's explicit environment variable; Canva's
API documentation specifies the `Authorization: Bearer {token}` header but
does not prescribe an environment-variable name for an already-issued access
token. This distinction is intentional rather than claiming an official name
that does not exist.

Canva's official starter-kit quickstart names these integration configuration
variables:

- `CANVA_CLIENT_ID`
- `CANVA_CLIENT_SECRET`
- `BASE_CANVA_CONNECT_API_URL`
- `BASE_CANVA_CONNECT_AUTH_URL`

`canva-axi` reads `BASE_CANVA_CONNECT_API_URL` (default:
`https://api.canva.com/rest`; China: `https://api.canva.cn/rest`) and
`CANVA_ACCESS_TOKEN`. It does not read the client ID, client secret, auth base
URL, refresh tokens, files, command flags, or prompts. The client ID and secret
are used by a backend to complete OAuth token exchange; they are not substitutes
for the user access token required by design endpoints. Help and local
discovery work without authentication.

Required Canva scopes by command:

| Scope | Commands |
| --- | --- |
| `design:meta:read` | `designs list`, `designs get`, `autofills get` |
| `design:content:read` | `designs dataset`, `designs export-formats`, `exports create`, `exports get`, `exports download` |
| `design:content:write` | `designs create`, `autofills update` |

## Commands

```sh
# Design discovery
canva-axi designs list
canva-axi designs list --query "TikTok" --ownership owned --limit 50
canva-axi designs get <design-id>

# Blank design creation: preset or custom dimensions
canva-axi designs create --preset presentation --title Slides --confirm
canva-axi designs create \
  --width 1080 --height 1920 --title "TikTok slides" --confirm

# Check a design's export formats and create image export jobs
canva-axi designs export-formats <design-id>
canva-axi exports create <design-id> --format png --pages 1,2,3 --confirm
canva-axi exports create <design-id> --format jpg --quality 90 --confirm
canva-axi exports get <export-id>

# Download each successful export URL as a numbered local image
canva-axi exports download <export-id> \
  --output-dir ./pages --format png --confirm

# Dataset-backed updates (Canva Enterprise; limited development trials may apply)
canva-axi designs dataset <design-id>
canva-axi autofills update <design-id> \
  --data '{"headline":{"type":"text","text":"Hello"},"hero":{"type":"image","asset_id":"Msd59349ff"}}' \
  --confirm
canva-axi autofills get <job-id>
```

Use `--help` on the root, any group, or any command for exact arguments and
validated option values. All data commands accept `--json`.

`exports create` supports the officially documented PNG/JPEG page selection,
dimensions, regular/pro export quality, JPEG compression quality, and PNG
lossless/background/single-image options. `exports get` returns the signed
download URLs Canva documents as valid for 24 hours. `exports download` is a
local convenience over those URLs; it refuses to overwrite existing files.
Canva API requests time out after 30 seconds; export downloads, including the
streamed response body, time out after 120 seconds.

Autofill is not arbitrary element editing. The target design must have fields
configured through Canva Data autofill, and field names not present in the
current dataset are silently skipped by Canva. Inspect `designs dataset`
immediately before an update. Phase A validates and sends only documented text
and image field values.

## Safety gate

Every network or filesystem mutation requires `--confirm`:

- `designs create`
- `exports create`
- `exports download`
- `autofills update`

The gate authorizes one invocation only. There are no prompts and no remembered
consent. Missing confirmation and invalid input fail before any network
request. Reads (`list`, `get`, `dataset`, `export-formats`, and job status) do
not require confirmation.

## Output and exit codes

Compact TOON is the default on stdout:

```text
designs[1]{id,title,page_count,design_types,updated_at}:
 DAFVztcvd9z,TikTok campaign,5,presentation,1692928800
continuation: next-token
```

Use `--json` for JSON. Errors also use JSON when `--json` is present. Secrets
are never included in request bodies or output.

| Code | Meaning |
| --- | --- |
| `0` | Success or informational help |
| `1` | Usage, configuration, local validation, or missing confirmation |
| `2` | Runtime, network, download, or Canva API error |

## Development

```sh
npm test
npm run typecheck
npm run skill:check
```

Tests mock HTTP and pass without Canva credentials.

## UNRESOLVED / intentionally not implemented

- **Brand-template copy creation:** `POST /v1/designs` documents
  `type: brand_template`, but marks it preview and explicitly says public
  integrations using preview features cannot pass review. Phase A does not
  expose it.
- **Existing-design copy and design pages metadata:** both are documented as
  preview APIs with the same public-integration warning. Exports can still
  select documented one-based page numbers.
- **Arbitrary text/image element editing:** Connect exposes no general public
  element-update endpoint. Only preconfigured dataset fields are updated
  through Autofill.
- **General brand-template Autofill creation:** the official API exists but is
  outside the narrow Phase A slideshow surface. Only in-place `update_design`
  is exposed.
- **OAuth login/token refresh:** authorization requires user interaction,
  redirect handling, PKCE, secure refresh-token rotation, and client
  credentials. Phase A consumes a pre-issued access token from the environment
  and does not implement an unsafe partial OAuth flow.
- PDF, GIF, MP4, PPTX, CSV, HTML, and SVG exports; uploads; folders; comments;
  analytics; and arbitrary raw endpoint/payload access are not exposed.

## Official documentation used

Reviewed against Canva's live documentation and OpenAPI description:

- [Connect APIs overview](https://www.canva.dev/docs/connect/)
- [Authentication (OAuth 2.0 with PKCE)](https://www.canva.dev/docs/connect/authentication/)
- [Generate an access token](https://www.canva.dev/docs/connect/api-reference/authentication/generate-access-token/)
- [Official Connect quickstart and environment names](https://www.canva.dev/docs/connect/quickstart/)
- [List designs](https://www.canva.dev/docs/connect/api-reference/designs/list-designs/)
- [Get design](https://www.canva.dev/docs/connect/api-reference/designs/get-design/)
- [Create design](https://www.canva.dev/docs/connect/api-reference/designs/create-design/)
- [Get design dataset](https://www.canva.dev/docs/connect/api-reference/designs/get-design-dataset/)
- [Get design export formats](https://www.canva.dev/docs/connect/api-reference/designs/get-design-export-formats/)
- [Create design export job](https://www.canva.dev/docs/connect/api-reference/exports/create-design-export-job/)
- [Get design export job](https://www.canva.dev/docs/connect/api-reference/exports/get-design-export-job/)
- [Autofill overview](https://www.canva.dev/docs/connect/api-reference/autofills/)
- [Create design autofill job](https://www.canva.dev/docs/connect/api-reference/autofills/create-design-autofill-job/)
- [Get design autofill job](https://www.canva.dev/docs/connect/api-reference/autofills/get-design-autofill-job/)
- [Current Connect OpenAPI description](https://www.canva.dev/sources/connect/api/latest/api.yml)
