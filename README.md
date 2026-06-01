# OpenClaw Agent Consultation Access

Standalone OpenClaw plugin for owner-controlled consultation access. It exposes:

- Owner-authenticated policy, grant, revoke, session, and audit HTTP APIs
- WebSocket consultation sessions for human and agent requesters
- Deterministic pre-agent policy enforcement with no-bypass tests
- Finite grants with expiry, revocation, turn limits, session limits, and hashed bearer tokens

## Default surfaces

- HTTP admin API: `/v1/consultation`
- WebSocket session API: `/v1/consultations`

## Config

The plugin config is the object described by `openclaw.plugin.json`. The main required field for a working setup is `owners`.

### Networking modes

- `private`:
  Use this when the requester is already inside your tailnet or private network. Grant creation keeps returning a host-derived `ws_url`, so the requester must be able to reach that private endpoint.
- `tailscale-private-admin-public-session`:
  Use this when the owner/admin APIs stay private on Tailscale, but the requester session endpoint is exposed through Tailscale Funnel or a public reverse proxy. External requesters do not need to join your tailnet in this mode.

Keep the admin API private by default. Do not expose `/v1/consultation/policies`, `/v1/consultation/grants`, `/v1/consultation/grants/:id/revoke`, or audit/session admin routes publicly unless you are intentionally putting them behind an auth proxy.

Only the requester WebSocket/session path should be public:

- Expose `/v1/consultations`
- Keep grant tokens, TTL, turn limits, session limits, revocation, and policy enforcement enabled
- Set either `publicBaseUrl` or `publicWsUrl`

`ws_url` is computed in this order:

1. `publicWsUrl`
2. `publicBaseUrl` + `wsPath` with `http -> ws` and `https -> wss`
3. Incoming admin request host/proto fallback

Example split private-admin/public-session config:

```json
{
  "networkMode": "tailscale-private-admin-public-session",
  "internalBaseUrl": "https://consultation-host.tailnet.ts.net",
  "publicBaseUrl": "https://consult.superada.ai",
  "publicWsUrl": "wss://consult.superada.ai/v1/consultations",
  "owners": [
    {
      "id": "owner-1",
      "token": "owner-token-1",
      "agentIds": ["agent-owner-1"]
    }
  ]
}
```

If you omit `publicBaseUrl` and `publicWsUrl`, the plugin stays in host-inferred private mode and the requester must be able to reach the returned private/tailnet `ws_url`.

## Build and verify

```bash
npm install
npm run test
npm run typecheck
npm run build
npm run plugin:validate
```


## Install from GitHub

```bash
openclaw plugins install git+https://github.com/h-mascot/openclaw-agent-consultation-access.git
openclaw plugins enable openclaw-agent-consultation-access
openclaw plugins inspect openclaw-agent-consultation-access --runtime --json
```

Then configure the plugin under `plugins.entries.openclaw-agent-consultation-access.config` with at least one owner token. Keep the admin API private.

Minimal private config shape:

```json
{
  "enabled": true,
  "apiBasePath": "/v1/consultation",
  "wsPath": "/v1/consultations",
  "owners": [
    {
      "id": "owner-1",
      "token": "replace-with-a-secret-owner-token",
      "agentIds": ["main"]
    }
  ]
}
```

For external requesters who should not join your tailnet, expose only `/v1/consultations` through Tailscale Funnel or a reverse proxy and set:

```json
{
  "networkMode": "tailscale-private-admin-public-session",
  "internalBaseUrl": "https://consultation-host.tailnet.ts.net",
  "publicBaseUrl": "https://consult.example.com",
  "publicWsUrl": "wss://consult.example.com/v1/consultations"
}
```

## Test it

### 1. Local package tests

```bash
git clone https://github.com/h-mascot/openclaw-agent-consultation-access.git
cd openclaw-agent-consultation-access
npm ci
npm test
npm run typecheck
npm run build
npm run plugin:validate
```

Expected result: all tests pass, TypeScript emits no errors, and `plugin:validate` prints a success message for the plugin manifest and runtime entry.

### 2. Local API smoke test

The test suite already starts an in-memory gateway runtime and proves policy dry-run, grant creation, WebSocket session start, allowed/denied prompts, audit retrieval, revocation, expiry, and public `ws_url` derivation. Run the focused gateway tests with:

```bash
node --import tsx --test tests/consultation-gateway.test.ts
```

### 3. Installed OpenClaw smoke test

After installing/enabling the plugin and restarting the gateway, create a policy:

```bash
OWNER_TOKEN="replace-with-a-secret-owner-token"
BASE_URL="http://127.0.0.1:18800"

curl -sS -X POST "$BASE_URL/v1/consultation/policies" \
  -H "authorization: Bearer $OWNER_TOKEN" \
  -H "content-type: application/json" \
  -d '{"name":"Read only research","template":"read-only-research"}'
```

Create a grant using the returned `policy_id`:

```bash
POLICY_ID="pol_replace_me"

curl -sS -X POST "$BASE_URL/v1/consultation/grants" \
  -H "authorization: Bearer $OWNER_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"target_agent_id\":\"main\",\"requester\":{\"type\":\"human\",\"display_name\":\"Requester\"},\"policy_id\":\"$POLICY_ID\",\"max_turns\":2,\"ttl_seconds\":300,\"max_sessions\":1}"
```

The grant response includes:

- `grant_id`
- `grant_token`
- `ws_url`
- expiry and limit metadata

Connect to `ws_url` and start a requester session:

```json
{
  "protocol_version": "2026-05-31",
  "type": "session.start",
  "grant_token": "grant_token_from_response",
  "client": {
    "type": "human",
    "display_name": "Requester",
    "response_format": "text"
  }
}
```

Then send a consultation turn:

```json
{
  "protocol_version": "2026-05-31",
  "type": "consultation.send",
  "message_id": "msg-1",
  "content": {
    "type": "text",
    "text": "Summarize the public market context."
  }
}
```

Expected WebSocket events include `session.started` followed by either `agent.final` for allowed prompts or `policy.denied` for blocked prompts. Denied prompts should not reach the agent adapter.

### 4. Admin audit and revoke checks

List sessions for a grant:

```bash
GRANT_ID="gr_replace_me"

curl -sS "$BASE_URL/v1/consultation/grants/$GRANT_ID/sessions" \
  -H "authorization: Bearer $OWNER_TOKEN"
```

Fetch a session audit:

```bash
SESSION_ID="sess_replace_me"

curl -sS "$BASE_URL/v1/consultation/sessions/$SESSION_ID/audit" \
  -H "authorization: Bearer $OWNER_TOKEN"
```

Revoke a grant:

```bash
curl -sS -X POST "$BASE_URL/v1/consultation/grants/$GRANT_ID/revoke" \
  -H "authorization: Bearer $OWNER_TOKEN" \
  -H "content-type: application/json" \
  -d '{"reason":"done"}'
```

Expected result: active WebSocket sessions for the grant receive a close event with `reason: "grant_revoked"`.

## Security notes

- Treat owner tokens as secrets.
- Keep `/v1/consultation/*` private or behind a trusted auth proxy.
- Expose only `/v1/consultations` publicly for external requesters.
- Grants are short-lived and enforce TTL, turn limits, session limits, revocation, and policy checks.
