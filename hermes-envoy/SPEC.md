# Hermes Envoy - Super Spec

## 1. Title Block

| Field | Value |
|---|---|
| Title | Hermes Envoy |
| Date | 2026-06-02 |
| Status | Draft for implementation |
| Mode | technical+implementation+agent+ops |
| Owner | Henry Mascot |
| Requested model | GPT-5.4 |
| Artifact | `/home/jamify/clawd/output/super-spec/2026-06-02-hermes-envoy-super-spec.md` |
| Evidence packet | `/home/jamify/clawd/output/super-spec/2026-06-02-hermes-envoy-evidence.md` |
| Canonical repo | `https://github.com/h-mascot/agent-envoy` |
| Monorepo subprojects | `openclaw-envoy`, `hermes-envoy` |
| Hermes plugin id | `hermes-envoy` |
| Display name | `Hermes Envoy` |

## 2. Source Map

### Evidence Used

| Source | Classification | How Used |
|---|---|---|
| `/home/jamify/clawd/output/super-spec/2026-06-02-hermes-envoy-evidence.md` | Primary requirement packet | Used for repo naming, Hermes plugin conventions, OpenClaw Envoy interoperability facts, MVP direction, and required output sections. |
| `/home/jamify/clawd/output/super-spec/2026-05-31-agent-consultation-access-plugin-v5.md` | Prior OpenClaw protocol/spec evidence | Used only to inherit the requester WebSocket event shapes already defined for Agent Envoy, especially `session.start`, `session.started`, `consultation.send`, `agent.final`, `policy.denied`, and `session.closed`. |
| OpenClaw plugin packaging facts summarized inside the evidence packet | Packaging evidence | Used to keep Hermes Envoy aligned with the existing OpenClaw Envoy project split and validation expectations. |
| Hermes plugin loader and installer facts summarized inside the evidence packet | Runtime evidence | Used to define `plugin.yaml`, `__init__.py`, registration behavior, enablement flow, install constraints, and hook choices. |

### Evidence Ignored or Deferred

| Evidence / Topic | Reason |
|---|---|
| Hermes as a public consultation provider/server in MVP | Evidence explicitly says this is more invasive and should be phase 2 unless Hermes exposes stable gateway route APIs for plugins. |
| Long-lived default grant token storage | Evidence says to avoid storing long-lived grant tokens when possible. This spec keeps per-session token entry as the default. |
| Marketplace, payments, public discovery, or non-owner-controlled access | Out of scope for this plugin and unsupported by the requirement packet. |
| Any undocumented Hermes route-extension mechanism | Not established by the evidence. Treat as an open question rather than assume it exists. |

### Assumptions

1. Hermes Envoy is the Hermes-side requester counterpart to the existing OpenClaw Agent Envoy, not a replacement for it.
2. The initial Hermes build target is Book/Hermes with local owner control under `~/.hermes`.
3. The OpenClaw Envoy requester WebSocket contract remains compatible with the event shapes captured in the prior OpenClaw spec.
4. Hermes tools can register JSON-schema-shaped inputs through `PluginContext.register_tool(...)` as reflected in the evidence packet.
5. Hermes plugin installation from a monorepo subdirectory is not guaranteed by the native installer, so local copy/symlink install must be a first-class path.
6. Raw grant tokens must never be written to persistent state or logs.
7. Remote Envoy responses are untrusted content and must be treated as plain text data, not instructions for local tool execution.

### Decisions

1. Build Hermes Envoy as an **MVP requester/client plugin only**.
2. Keep the monorepo split explicit: `agent-envoy/openclaw-envoy` and `agent-envoy/hermes-envoy`.
3. Make `agent-envoy/hermes-envoy/` itself the Hermes plugin root so it can be copied directly into `~/.hermes/plugins/hermes-envoy/`.
4. Require an explicit `grant_token` for each session in MVP. Do not prompt installers to persist a default grant token.
5. Persist only sanitized state and audit data under `~/.hermes/envoy/`.
6. Register explicit lifecycle tools (`envoy_session_start`, `envoy_send`, `envoy_status`, `envoy_close`) plus an optional convenience wrapper (`envoy_consult`).
7. Add cleanup hooks so abandoned Hermes sessions do not leave remote consultation sessions hanging.
8. Treat Hermes provider/server mode as a separately gated phase 2 design, not a hidden MVP requirement.

## 3. Executive Decision

Build `hermes-envoy` as a local Hermes plugin that lets a Hermes agent act as a **policy-bound requester** against an OpenClaw Agent Envoy grant. The plugin must let Henry's Hermes agents open short-lived remote consultation sessions, send guarded text turns, inspect status, and close sessions without exposing local secrets, local files, or broad Hermes runtime access.

The MVP must prove five things:

1. Hermes can start and manage a requester consultation session against OpenClaw Envoy using the existing WebSocket contract.
2. Local guardrails run **before** any outbound turn is sent.
3. Raw grant tokens are never persisted.
4. Session state and audit records survive normal runtime churn under `~/.hermes/envoy/`.
5. Install, enable, restart, and smoke-test steps are simple enough for Book/Hermes to use reliably.

Do **not** build Hermes as a public consultation server in this phase. That work depends on plugin route-extension capabilities that are not established by the evidence.

## 4. Problem Statement

Henry already has an owner-controlled consultation pattern on the OpenClaw side through Agent Envoy. What is missing is the Hermes-side counterpart: a safe way for a Hermes agent to participate in those consultations without exposing the Hermes runtime directly.

Today, the unsafe defaults would be:

- pasting grant details into ad hoc chat context,
- manually copying messages between runtimes,
- letting a remote consultation request trick Hermes into revealing local secrets,
- or inventing a server-side Hermes exposure path before the plugin API clearly supports it.

Hermes Envoy should solve the narrow, defensive problem:

> Let a Hermes agent intentionally consult a remote OpenClaw Envoy using a short-lived grant and a deterministic local safety layer, while keeping Hermes local state, secrets, tools, and file access out of scope.

## 5. Goals

1. Provide a Hermes plugin named `hermes-envoy` that installs under `~/.hermes/plugins/hermes-envoy/`.
2. Support the requester/client flow against OpenClaw Agent Envoy over WebSocket.
3. Expose lifecycle tools for start, send, status, close, and an optional one-shot consult convenience path.
4. Enforce local deterministic guardrails before sending any outbound turn.
5. Persist active session summaries and audit records under `~/.hermes/envoy/`.
6. Add cleanup hooks so sessions are closed or marked stale when the Hermes session ends.
7. Keep the plugin resumable and debuggable after context compaction.
8. Ship with clear install, enable, restart, test, proof, rollout, and rollback instructions.

## 6. Non-Goals

1. No Hermes public HTTP or WebSocket consultation server in MVP.
2. No inbound external requester access directly into Hermes.
3. No automatic local file attachment, shell execution, browser execution, or local tool forwarding to satisfy a remote consultation.
4. No persistent default grant-token storage in Hermes `.env` by default.
5. No attempt to extend or replace the OpenClaw Envoy policy engine; Hermes Envoy is a local requester-side safety layer plus protocol client.
6. No multi-tenant broker, marketplace, payments, discovery, or public grant management.
7. No non-text transport in MVP; attachments, files, images, and binary payloads are deferred.
8. No autonomous follow-up actions based on remote content. Remote answers are data, not commands.

## 7. Users, Jobs, and Scope Split

### Primary User

- **Henry / owner operator** using Hermes (Book) and OpenClaw together.

### Jobs to Be Done

1. Start a remote consultation from Hermes using a grant issued by OpenClaw Envoy.
2. Send a guarded question and receive the remote result.
3. Track whether the session is active, denied, closed, expired, or failed.
4. Inspect local audit records without digging through raw chat context.
5. Shut down the session cleanly when done.

### Scope Split

#### MVP: requester/client mode

Hermes Envoy acts as a client to the OpenClaw requester WebSocket and returns normalized tool results inside Hermes.

#### Phase 2: provider/server mode

Hermes Envoy may later expose owner-controlled consultation endpoints only if Hermes documents a stable plugin route API. That work must be a separate spec and implementation track.

## 8. Core Workflows

### 8.1 Install and Enable

1. Builder creates the `agent-envoy/hermes-envoy/` subproject with `plugin.yaml` and `__init__.py` at its root.
2. Operator copies or symlinks that directory to `~/.hermes/plugins/hermes-envoy/`.
3. Operator enables the plugin through `plugins.enabled` in `~/.hermes/config.yaml` and ensures it is not listed in `plugins.disabled`.
4. Operator restarts Hermes with `hermes gateway restart`.
5. Smoke test confirms `envoy_status` and `/envoy help` register successfully.

### 8.2 Start Consultation Session

1. Hermes tool caller invokes `envoy_session_start` with `ws_url`, `grant_token`, and requester metadata.
2. Plugin validates URL shape, transport policy, prompt metadata, and token presence.
3. Plugin opens a WebSocket to the remote Agent Envoy.
4. Plugin sends `session.start` with `client.type="agent"` metadata.
5. Plugin waits for `session.started` or a terminal error/close event.
6. Plugin stores a sanitized local session summary and returns the normalized session object.

### 8.3 Send a Consultation Turn

1. Caller invokes `envoy_send` with `session_id` and `message`.
2. Local guardrail engine checks max bytes, secret patterns, local path exfiltration patterns, and message emptiness.
3. If blocked locally, the plugin records a local deny audit event and returns `blocked_local` without contacting the remote server.
4. If allowed, the plugin sends `consultation.send` with a per-turn `message_id`.
5. Plugin consumes remote events until a terminal event arrives: `agent.final`, `policy.denied`, `session.closed`, timeout, or protocol error.
6. Plugin stores audit state and returns a normalized result object.

### 8.4 One-Shot Consult Convenience Flow

1. Caller invokes `envoy_consult` with session-start inputs plus a single message.
2. Plugin internally runs start -> send -> optional close.
3. Default behavior is `close_after=true` for one-shot usage.
4. This is a convenience wrapper; lifecycle tools remain the source of truth.

### 8.5 Status and Help

1. `envoy_status` returns active sessions, stale sessions, latest audit outcome, and configured defaults.
2. `/envoy help` explains supported commands.
3. `/envoy status` shows the same summary available through the tool.
4. `/envoy close <session_id>` closes a session if it is still open locally.

### 8.6 Session End Cleanup

1. On `on_session_end`, `on_session_finalize`, or `subagent_stop`, the plugin inspects active local sessions owned by the current Hermes session.
2. It attempts a graceful close to the remote socket.
3. If close cannot be confirmed, the session is marked `stale_local` and surfaced in the next `envoy_status` call.
4. Cleanup never blocks Hermes shutdown indefinitely; it uses bounded timeouts.

## 9. Technical Design

### 9.1 Monorepo Layout

```text
agent-envoy/
├── openclaw-envoy/
│   └── ...existing OpenClaw plugin project...
└── hermes-envoy/
    ├── plugin.yaml
    ├── __init__.py
    ├── README.md
    ├── after-install.md
    ├── protocol.py
    ├── transport.py
    ├── guardrails.py
    ├── state.py
    ├── audit.py
    ├── tools.py
    ├── commands.py
    ├── hooks.py
    ├── models.py
    ├── tests/
    │   ├── test_manifest.py
    │   ├── test_registration.py
    │   ├── test_guardrails.py
    │   ├── test_protocol_contract.py
    │   ├── test_state_store.py
    │   ├── test_tools.py
    │   └── test_smoke_runtime.py
    └── fixtures/
        ├── session_started.json
        ├── agent_final.json
        ├── policy_denied.json
        └── session_closed.json
```

### 9.2 Runtime Install Layout

```text
~/.hermes/plugins/hermes-envoy/
├── plugin.yaml
├── __init__.py
└── ...helper modules...

~/.hermes/envoy/
├── state.json
├── sessions/
│   └── <session_id>.json
├── audit/
│   └── YYYY-MM-DD.jsonl
├── transcripts/
│   └── <session_id>.jsonl
└── quarantine/
    └── YYYY-MM-DD.jsonl
```

Notes:

- `transcripts/` is sanitized local session output, not raw token storage.
- `quarantine/` stores digests and reasons for locally blocked outbound payloads, not raw secret-bearing content.
- If transcript retention is disabled, `transcripts/` may be omitted.

### 9.3 Component Responsibilities

| Component | Responsibility |
|---|---|
| `__init__.py` | Plugin entrypoint and registration of tools, commands, and hooks. |
| `tools.py` | Tool handlers and normalized response payloads. |
| `protocol.py` | Event envelope builders/parsers for OpenClaw Envoy requester protocol. |
| `transport.py` | WebSocket connection lifecycle, timeouts, retries, and graceful close. |
| `guardrails.py` | Deterministic outbound safety checks and optional redaction. |
| `state.py` | Local session index and per-session metadata persistence. |
| `audit.py` | Append-only audit writer for send/receive/block/close events. |
| `commands.py` | Slash command dispatcher for `/envoy ...`. |
| `hooks.py` | Session-end cleanup hooks. |
| `models.py` | Typed local data structures or dataclass models. |

### 9.4 `plugin.yaml` Shape

Recommended MVP manifest:

```yaml
manifest_version: 1
name: hermes-envoy
version: 0.1.0
description: Requester-side Hermes plugin for owner-controlled Agent Envoy consultations.
author: Henry Mascot
provides_tools:
  - envoy_session_start
  - envoy_send
  - envoy_status
  - envoy_close
  - envoy_consult
hooks:
  - on_session_end
  - on_session_finalize
  - subagent_stop
requires_env:
  - HERMES_ENVOY_DEFAULT_WS_URL
  - HERMES_ENVOY_DEFAULT_OWNER_LABEL
  - HERMES_ENVOY_DEFAULT_REQUESTER_LABEL
  - HERMES_ENVOY_MAX_PROMPT_BYTES
  - HERMES_ENVOY_ALLOW_INSECURE_WS
  - HERMES_ENVOY_STORE_TRANSCRIPTS
```

Manifest rules:

1. `name` must be `hermes-envoy` so the installed directory and enabled plugin key stay aligned.
2. Do **not** declare `HERMES_ENVOY_DEFAULT_GRANT_TOKEN` in `requires_env` for MVP.
3. Hook names must match Hermes `VALID_HOOKS` exactly.
4. `after-install.md` should explain any Python dependency step needed for WebSocket support if the Hermes runtime does not already provide it.

### 9.5 `__init__.py` Registration Contract

```python
from .tools import (
    envoy_session_start,
    envoy_send,
    envoy_status,
    envoy_close,
    envoy_consult,
)
from .commands import envoy_command
from .hooks import on_session_end, on_session_finalize, on_subagent_stop
from .schemas import (
    ENVOY_SESSION_START_SCHEMA,
    ENVOY_SEND_SCHEMA,
    ENVOY_STATUS_SCHEMA,
    ENVOY_CLOSE_SCHEMA,
    ENVOY_CONSULT_SCHEMA,
)


def register(ctx):
    toolset = "envoy"

    ctx.register_tool(
        "envoy_session_start",
        toolset,
        ENVOY_SESSION_START_SCHEMA,
        envoy_session_start,
        is_async=True,
        description="Open a guarded requester session to Agent Envoy.",
        emoji="🛰️",
    )
    ctx.register_tool(
        "envoy_send",
        toolset,
        ENVOY_SEND_SCHEMA,
        envoy_send,
        is_async=True,
        description="Send one guarded consultation turn on an active Envoy session.",
        emoji="📨",
    )
    ctx.register_tool(
        "envoy_status",
        toolset,
        ENVOY_STATUS_SCHEMA,
        envoy_status,
        is_async=False,
        description="Inspect active and recent local Envoy session state.",
        emoji="📊",
    )
    ctx.register_tool(
        "envoy_close",
        toolset,
        ENVOY_CLOSE_SCHEMA,
        envoy_close,
        is_async=True,
        description="Close an active Envoy session and persist final state.",
        emoji="🔌",
    )
    ctx.register_tool(
        "envoy_consult",
        toolset,
        ENVOY_CONSULT_SCHEMA,
        envoy_consult,
        is_async=True,
        description="Convenience wrapper: start, send one message, optionally close.",
        emoji="💬",
    )

    ctx.register_command(
        "envoy",
        envoy_command,
        description="Hermes Envoy status/help/close command.",
        args_hint="help | status | close <session_id>",
    )

    ctx.register_hook("on_session_end", on_session_end)
    ctx.register_hook("on_session_finalize", on_session_finalize)
    ctx.register_hook("subagent_stop", on_subagent_stop)
```

Registration requirements:

1. `register(ctx)` is mandatory.
2. Tool names are stable API and should not be renamed casually after MVP.
3. Async registration is preferred for networked tools.
4. Hooks must never throw uncaught exceptions that break Hermes session shutdown.

### 9.6 Protocol Contract With OpenClaw Envoy

Hermes Envoy must implement the requester side of the existing Agent Envoy contract.

#### Start event

```json
{
  "protocol_version": "2026-05-31",
  "type": "session.start",
  "grant_token": "raw-token",
  "client": {
    "type": "agent",
    "agent_id": "book",
    "agent_name": "Book",
    "run_id": "optional-run-id",
    "purpose": "Need policy-bound consultation for a bounded task",
    "response_format": "text"
  }
}
```

#### Successful start

```json
{
  "protocol_version": "2026-05-31",
  "type": "session.started",
  "session_id": "sess_123",
  "grant_id": "gr_123",
  "remaining_turns": 3,
  "expires_at": "2026-06-02T12:00:00Z",
  "transcript_notice": "The owner may inspect this consultation transcript and policy decisions."
}
```

#### Send event

```json
{
  "protocol_version": "2026-05-31",
  "type": "consultation.send",
  "message_id": "msg_001",
  "content": {
    "type": "text",
    "text": "Question text"
  }
}
```

#### Terminal response examples

```json
{
  "protocol_version": "2026-05-31",
  "type": "agent.final",
  "message_id": "msg_001",
  "correlation_id": "corr_123",
  "receipt_id": "rcpt_123",
  "policy_decision": "allow",
  "turn_index": 1,
  "remaining_turns": 2,
  "text": "Final answer."
}
```

```json
{
  "protocol_version": "2026-05-31",
  "type": "policy.denied",
  "message_id": "msg_002",
  "correlation_id": "corr_456",
  "receipt_id": "rcpt_456",
  "policy_decision": "deny",
  "turn_index": 2,
  "remaining_turns": 1,
  "message": "This request was blocked by the owner's access policy."
}
```

```json
{
  "protocol_version": "2026-05-31",
  "type": "session.closed",
  "reason": "grant_expired"
}
```

Protocol requirements:

1. Default `protocol_version` is `2026-05-31` until OpenClaw Envoy publishes a newer compatible contract.
2. Hermes Envoy must reject unexpected top-level event shapes with a fail-closed `protocol_error` result.
3. `agent.delta` may be accumulated locally, but MVP tool outputs may return only the final normalized text unless Hermes tool streaming is verified.
4. Raw `grant_token` may exist only in memory for session start and must be discarded immediately after auth.

### 9.7 Tool Schemas

#### `envoy_session_start`

```json
{
  "type": "object",
  "properties": {
    "ws_url": { "type": "string", "format": "uri" },
    "grant_token": { "type": "string", "minLength": 8 },
    "agent_id": { "type": "string", "minLength": 1, "maxLength": 80 },
    "agent_name": { "type": "string", "minLength": 1, "maxLength": 80 },
    "run_id": { "type": "string", "maxLength": 120 },
    "purpose": { "type": "string", "minLength": 1, "maxLength": 280 },
    "owner_label": { "type": "string", "maxLength": 120 },
    "requester_label": { "type": "string", "maxLength": 120 },
    "response_format": { "type": "string", "enum": ["text"] },
    "timeout_seconds": { "type": "integer", "minimum": 3, "maximum": 60 }
  },
  "required": ["ws_url", "grant_token", "purpose"],
  "additionalProperties": false
}
```

Return shape:

```json
{
  "ok": true,
  "local_session_id": "henv_01...",
  "remote_session_id": "sess_123",
  "grant_id": "gr_123",
  "status": "active",
  "remaining_turns": 3,
  "expires_at": "2026-06-02T12:00:00Z",
  "protocol_version": "2026-05-31",
  "transcript_notice": "..."
}
```

#### `envoy_send`

```json
{
  "type": "object",
  "properties": {
    "session_id": { "type": "string", "minLength": 1 },
    "message": { "type": "string", "minLength": 1, "maxLength": 12000 },
    "timeout_seconds": { "type": "integer", "minimum": 3, "maximum": 180 },
    "close_on_terminal": { "type": "boolean" }
  },
  "required": ["session_id", "message"],
  "additionalProperties": false
}
```

Return shape:

```json
{
  "ok": true,
  "session_id": "henv_01...",
  "outcome": "allowed",
  "correlation_id": "corr_123",
  "receipt_id": "rcpt_123",
  "turn_index": 1,
  "remaining_turns": 2,
  "text": "Final answer.",
  "remote_event_type": "agent.final"
}
```

Possible `outcome` values: `allowed`, `denied_remote`, `blocked_local`, `closed`, `error`.

#### `envoy_status`

```json
{
  "type": "object",
  "properties": {
    "session_id": { "type": "string" },
    "include_recent": { "type": "boolean" }
  },
  "additionalProperties": false
}
```

Return shape:

```json
{
  "ok": true,
  "active_sessions": [
    {
      "session_id": "henv_01...",
      "remote_session_id": "sess_123",
      "status": "active",
      "last_activity_at": "2026-06-02T03:00:00Z",
      "remaining_turns": 2,
      "ws_url_host": "consult.example.com"
    }
  ],
  "recent_audit_file": "~/.hermes/envoy/audit/2026-06-02.jsonl"
}
```

#### `envoy_close`

```json
{
  "type": "object",
  "properties": {
    "session_id": { "type": "string", "minLength": 1 },
    "reason": { "type": "string", "maxLength": 80 }
  },
  "required": ["session_id"],
  "additionalProperties": false
}
```

Return shape:

```json
{
  "ok": true,
  "session_id": "henv_01...",
  "closed": true,
  "final_status": "closed_local",
  "reason": "user_closed"
}
```

#### `envoy_consult`

```json
{
  "type": "object",
  "properties": {
    "ws_url": { "type": "string", "format": "uri" },
    "grant_token": { "type": "string", "minLength": 8 },
    "purpose": { "type": "string", "minLength": 1, "maxLength": 280 },
    "message": { "type": "string", "minLength": 1, "maxLength": 12000 },
    "agent_id": { "type": "string", "maxLength": 80 },
    "agent_name": { "type": "string", "maxLength": 80 },
    "run_id": { "type": "string", "maxLength": 120 },
    "close_after": { "type": "boolean" },
    "timeout_seconds": { "type": "integer", "minimum": 3, "maximum": 180 }
  },
  "required": ["ws_url", "grant_token", "purpose", "message"],
  "additionalProperties": false
}
```

### 9.8 Slash Command Contract

Supported MVP command forms:

```text
/envoy help
/envoy status
/envoy close <session_id>
```

Command rules:

1. No secret-bearing args are allowed in slash command history except a session ID.
2. Do not accept `grant_token` through `/envoy ...` in MVP.
3. Status output should be concise and point users to `envoy_status` for structured data.

### 9.9 State and Audit Model

#### `state.json`

Purpose: current index of active and recent sessions.

Suggested shape:

```json
{
  "version": 1,
  "updated_at": "2026-06-02T03:00:00Z",
  "active_sessions": ["henv_01..."],
  "recent_sessions": ["henv_00..."]
}
```

#### `sessions/<session_id>.json`

Purpose: per-session summary safe for inspection.

Fields:

- `session_id`
- `remote_session_id`
- `grant_id`
- `grant_fingerprint` (hash prefix only)
- `ws_url_host`
- `created_at`
- `last_activity_at`
- `status`
- `remaining_turns`
- `expires_at`
- `purpose`
- `owner_label`
- `requester_label`
- `local_block_count`
- `remote_deny_count`
- `close_reason`

#### `audit/YYYY-MM-DD.jsonl`

Purpose: append-only audit trail.

Each line must include:

- timestamp
- local session id
- remote session id if known
- event type (`start_attempt`, `start_ok`, `local_block`, `send_ok`, `remote_deny`, `remote_close`, `close_local`, `protocol_error`)
- correlation id / receipt id when available
- message digest or character count, not raw secrets
- result summary

#### `transcripts/<session_id>.jsonl`

Purpose: sanitized send/receive transcript for debugging.

Rules:

1. Store only if `HERMES_ENVOY_STORE_TRANSCRIPTS=true`.
2. Never store raw grant tokens.
3. Outbound messages may be stored only after local redaction pass.
4. Inbound remote text is stored as untrusted plain text with event type and timestamp.

#### `quarantine/YYYY-MM-DD.jsonl`

Purpose: prove local guardrail blocking without preserving sensitive payloads.

Fields:

- timestamp
- reason code(s)
- sha256 digest of blocked payload
- payload byte count
- session context if known

### 9.10 Local Safety Guardrails

Hermes Envoy is defensive. It must block or sanitize risky outbound content before it reaches the remote Envoy.

| Guardrail ID | Rule | MVP Behavior |
|---|---|---|
| LG-001 | Require explicit remote target | `ws_url` is required unless a default URL is configured. |
| LG-002 | Transport safety | Require `wss://` by default. Allow `ws://` only for loopback/private testing with `HERMES_ENVOY_ALLOW_INSECURE_WS=true`. |
| LG-003 | Token hygiene | Raw `grant_token` allowed only in memory during start auth and never persisted to state, transcripts, audit, or command history. |
| LG-004 | Prompt size bound | Block outbound messages above `HERMES_ENVOY_MAX_PROMPT_BYTES` (default 8192 bytes). |
| LG-005 | Secret-pattern deny | Block messages containing high-confidence secret shapes such as PEM blocks, common API-key prefixes, bearer tokens, or `.env` dumps. |
| LG-006 | Local exfiltration deny | Block messages that attempt to dump local secrets or config, e.g. `printenv`, `~/.ssh`, `~/.hermes/config.yaml`, raw credential files, or token inventories. |
| LG-007 | No local file path attachment | MVP tools accept only text. No `file_path`, `glob`, or local file read parameter is allowed. |
| LG-008 | Purpose required | Session start requires a bounded `purpose` string for auditability. |
| LG-009 | Remote content untrusted | Inbound remote content is returned as text only and never auto-routed into local commands or tools. |
| LG-010 | Fail closed | Protocol parse errors, unknown terminal events, or state corruption return errors and stop sending further turns. |

Local guardrail actions:

- `allow`: send as-is.
- `redact_then_allow`: replace matched sensitive fragments with typed placeholders and note this in audit.
- `deny`: do not contact remote Envoy; return `blocked_local`.

MVP default: use **deny** for high-confidence secrets and local exfiltration patterns; reserve `redact_then_allow` for clearly bounded safe replacements only.

### 9.11 Failure Modes and Expected Handling

| Failure | Expected Handling |
|---|---|
| Invalid or insecure `ws_url` | Reject before network call with actionable error. |
| Invalid/expired/revoked token | Return `auth_failed`/remote close, store sanitized audit, discard token from memory. |
| OpenClaw remote policy denial | Return `denied_remote`, preserve receipt/correlation IDs. |
| Grant expiry or turn exhaustion | Return normalized `closed` or `denied_remote` result and mark session closed. |
| WebSocket disconnect mid-turn | Return `error`, mark session `stale_local`, require explicit retry/send decision. |
| Unknown remote event type | Fail closed with `protocol_error`. |
| State file corruption | Rebuild `state.json` from per-session files when possible and record repair event. |
| Hook cleanup timeout | Mark session stale and continue Hermes shutdown. |

## 10. Requirements, Acceptance Criteria, and Validation

| ID | Requirement | Acceptance Criteria | Validation Method |
|---|---|---|---|
| HE-001 | Monorepo split is explicit. | Spec and implementation place Hermes code under `agent-envoy/hermes-envoy/` and OpenClaw code under `agent-envoy/openclaw-envoy/`. | Repo layout inspection. |
| HE-002 | Hermes subproject is directly installable as a plugin directory. | `agent-envoy/hermes-envoy/` contains `plugin.yaml`, `__init__.py`, and required helpers at subproject root. | File inspection + local copy/symlink smoke test. |
| HE-003 | Plugin registers required tools. | Hermes loads `envoy_session_start`, `envoy_send`, `envoy_status`, `envoy_close`, `envoy_consult`. | Registration smoke test. |
| HE-004 | Plugin registers cleanup hooks safely. | `on_session_end`, `on_session_finalize`, and `subagent_stop` are registered and do not crash shutdown. | Hook unit/integration tests. |
| HE-005 | Session start uses the OpenClaw requester contract. | Valid start emits `session.start` agent payload and handles `session.started` correctly. | Protocol contract test with fixtures or mock server. |
| HE-006 | Outbound turns are locally guarded before send. | Secret-bearing or exfiltration-like content is blocked locally and no network send occurs. | Guardrail tests + mock transport spy. |
| HE-007 | Raw grant tokens are never persisted. | Tokens absent from `state.json`, per-session files, audit logs, transcripts, and slash command history. | Storage inspection tests. |
| HE-008 | Active sessions persist locally. | After restart-safe write, `envoy_status` can reconstruct active/recent sessions from `~/.hermes/envoy/`. | State store tests. |
| HE-009 | Remote denials and closes are normalized. | `policy.denied` and `session.closed` return stable tool result shapes with correlation/receipt metadata when available. | Protocol and tool integration tests. |
| HE-010 | One-shot consult works. | `envoy_consult` can start, send one message, and close by default. | End-to-end mock server test. |
| HE-011 | Status is operator-usable. | `envoy_status` returns active sessions and latest audit summary without raw secrets. | Tool output snapshot tests. |
| HE-012 | Install/enable/restart flow is documented. | `README.md` and `after-install.md` cover copy/symlink install, enablement, env defaults, restart, and smoke test. | Doc checklist review. |
| HE-013 | Proof gate exists. | Implementation defines a `ctrl:gate` path or a documented `hermes-envoy` package gate covering tests and smoke checks. | Gate script inspection + execution. |
| HE-014 | MVP remains client-only. | No public route/server registration is added for external inbound consultation. | Scope review. |

## 11. Tests, Proof Gates, and Verification

### 11.1 Minimum Test Set

1. **Manifest test**: `plugin.yaml` parses and contains expected name, hooks, and tool list.
2. **Registration test**: `register(ctx)` registers tools, command, and hooks exactly once.
3. **Guardrail deny tests**: secret patterns, PEM blocks, `.env` dump requests, and local config exfiltration patterns are blocked locally.
4. **Guardrail allow tests**: normal bounded prompts pass.
5. **Token hygiene test**: token does not appear in persisted files after start/send/close.
6. **Protocol start test**: mock server receives correct `session.start` envelope.
7. **Protocol send test**: `envoy_send` converts remote `agent.final` into normalized result.
8. **Remote deny test**: `policy.denied` becomes `denied_remote` result with receipt metadata.
9. **Close test**: explicit `envoy_close` updates state and audit.
10. **Hook cleanup test**: `on_session_end` or `subagent_stop` attempts bounded cleanup.
11. **State rebuild test**: corrupted `state.json` can be rebuilt from per-session files.
12. **Smoke runtime test**: plugin can be copied into `~/.hermes/plugins/hermes-envoy`, enabled, restarted, and queried via `envoy_status`.

### 11.2 Proof Gates

Required implementation proof path:

1. Run the repo-level `ctrl:gate` **if the monorepo provides it**.
2. If no root `ctrl:gate` exists yet, run the `hermes-envoy` package gate at minimum:
   - unit/integration tests,
   - protocol fixture tests,
   - state/audit persistence tests,
   - local install smoke test on Hermes,
   - and one real or mock consultation round-trip.
3. If the monorepo later adds a unified root gate, `ctrl:gate` must include the Hermes Envoy package gate when files under `hermes-envoy/` change.

Recommended package gate shape:

```text
hermes-envoy package gate
- test manifest + registration
- test guardrails
- test protocol contract
- test state/audit persistence
- smoke install + enable + restart + envoy_status
- smoke envoy_consult against mock or staging Agent Envoy
```

### 11.3 Manual Verification Checklist

1. Copy or symlink `agent-envoy/hermes-envoy` into `~/.hermes/plugins/hermes-envoy`.
2. Enable plugin in `~/.hermes/config.yaml`.
3. Restart Hermes with `hermes gateway restart`.
4. Confirm `/envoy help` or `envoy_status` works.
5. Start a session against a valid staging Agent Envoy grant.
6. Send a safe prompt and receive `agent.final`.
7. Attempt a clearly secret-bearing prompt and confirm local block without remote send.
8. Inspect `~/.hermes/envoy/` and confirm token absence.
9. Close the session and confirm state/audit updates.

## 12. Rollout

### Phase 0 - build only

- Create `hermes-envoy` subproject in the monorepo.
- Keep plugin disabled by default.
- Finish tests and package gate.

### Phase 1 - local owner smoke test

- Install only on Henry's Hermes host.
- Enable only for Book/Hermes local use.
- Test against a staging or controlled OpenClaw Envoy grant.
- Verify local block, remote allow, remote deny, and close flows.

### Phase 2 - stable internal use

- Keep plugin enabled for Henry's own workflows.
- Monitor audit noise, stale-session behavior, and whether transcript storage defaults are correct.
- Tighten guardrails before broader reuse.

### Explicit rollout constraints

1. Do not advertise public server/provider behavior.
2. Do not store long-lived grant tokens for convenience.
3. Do not enable on multiple hosts until local state/audit behavior is proven stable.

## 13. Rollback

1. Remove `hermes-envoy` from `plugins.enabled` and add it to `plugins.disabled` if necessary.
2. Restart Hermes with `hermes gateway restart`.
3. Remove or archive `~/.hermes/plugins/hermes-envoy/`.
4. Optionally archive `~/.hermes/envoy/` for audit retention, then remove it if the operator wants a clean uninstall.
5. If a session is still active remotely, revoke the corresponding OpenClaw grant from the owner side.

Rollback success criteria:

- Plugin no longer registers tools or commands.
- Hermes starts without plugin errors.
- No new Envoy state or audit entries are created after rollback.

## 14. Traceability Matrix

| Requirement ID | Design Section(s) | Tests / Proof | Build Task(s) |
|---|---|---|---|
| HE-001 | 9.1 | Repo layout inspection | T1 |
| HE-002 | 9.1, 9.2, 9.4 | Install smoke test | T1, T2 |
| HE-003 | 9.5, 9.7 | Registration test | T2 |
| HE-004 | 8.6, 9.5 | Hook cleanup test | T2, T8 |
| HE-005 | 8.2, 9.6 | Protocol contract test | T4, T6 |
| HE-006 | 8.3, 9.10 | Guardrail tests + transport spy | T3, T5 |
| HE-007 | 9.9, 9.10 | Token hygiene test | T3, T5, T7 |
| HE-008 | 9.9 | State persistence/rebuild tests | T5 |
| HE-009 | 9.6, 9.7, 9.11 | Protocol/tool integration tests | T4, T6 |
| HE-010 | 8.4, 9.7 | One-shot E2E test | T6 |
| HE-011 | 8.5, 9.7, 9.9 | Status snapshot tests | T5, T7 |
| HE-012 | 8.1, 11.3 | Doc checklist review | T9 |
| HE-013 | 11.2 | Gate execution | T10 |
| HE-014 | 7, 12, 13 | Scope review | T1, T10 |

## 15. Atomic Build Tasks

### T1. Create monorepo Hermes subproject skeleton

- Create `agent-envoy/hermes-envoy/` with plugin-root files at subproject top level.
- Add `README.md`, `after-install.md`, and test/fixture directories.
- Proof: file tree matches spec.

### T2. Implement plugin registration surface

- Implement `plugin.yaml` and `__init__.py`.
- Register five tools, one slash command, and cleanup hooks.
- Proof: registration test passes.

### T3. Implement guardrail engine

- Add prompt-byte bounds, secret-pattern deny, local exfiltration deny, and token hygiene helpers.
- Decide and document any narrow redaction cases.
- Proof: guardrail tests and token-hygiene tests pass.

### T4. Implement protocol encoder/decoder

- Add `session.start`, `consultation.send`, and terminal-event parsing.
- Normalize remote outcomes into stable tool return shapes.
- Proof: protocol fixture tests pass.

### T5. Implement state and audit persistence

- Add `state.json`, per-session files, daily audit JSONL, optional transcripts, and quarantine log.
- Add rebuild logic for corrupted top-level state index.
- Proof: persistence/rebuild tests pass.

### T6. Implement networked tool handlers

- Wire `envoy_session_start`, `envoy_send`, `envoy_close`, and `envoy_consult` through guardrails, protocol, transport, and persistence.
- Proof: mock-server E2E tests pass.

### T7. Implement operator status surfaces

- Add `envoy_status` and `/envoy help|status|close <session_id>`.
- Keep outputs concise and secret-safe.
- Proof: snapshot/smoke tests pass.

### T8. Implement cleanup hooks

- Gracefully close or mark stale sessions on session end/finalize/subagent stop.
- Bound timeouts so Hermes shutdown is not trapped.
- Proof: hook cleanup tests pass.

### T9. Write install and operator docs

- Document local copy/symlink install, enablement, restart, env defaults, dependency note, smoke test, and rollback.
- Proof: docs checklist complete.

### T10. Add package gate and run proof

- Add or document the `hermes-envoy` package gate.
- Run repo `ctrl:gate` if available, otherwise run the package gate.
- Capture final smoke evidence for start/send/local-block/close.
- Proof: gate output and smoke notes are archived with the change.

## 16. Risks and Open Questions

### Risks

1. **WebSocket dependency ambiguity**: the evidence does not prove which Python WebSocket client library is already present in Hermes. The builder must confirm runtime dependency strategy before finalizing install docs.
2. **Streaming output ambiguity**: Hermes tool runtime streaming behavior is not established. MVP should safely support final-result return even if deltas cannot stream live.
3. **Protocol drift**: if the OpenClaw Envoy requester protocol changed after the captured spec, Hermes Envoy may need a version bump or compatibility layer.
4. **Installer subdirectory gap**: Hermes native Git install may not support monorepo subdirectory installs. Local copy/symlink is therefore required for MVP and should be documented as the supported path.
5. **Over-redaction vs usability**: guardrails that are too broad may block legitimate prompts. Audit and test coverage must make tuning easy.

### Open Questions

1. Which WebSocket client dependency is already available in the target Hermes runtime, and if none is bundled, what is the preferred supported install path?
2. Does Hermes expose tool-result streaming in a way that should surface `agent.delta` live, or should MVP collapse deltas into a final buffered response?
3. Should transcript retention default to on or off for Henry's own workflows? The evidence supports local persistence, but exact retention default is not specified.
4. Should the monorepo eventually provide a helper installer script for `hermes-envoy` subdirectory deployment, or is documented copy/symlink install sufficient?
5. If OpenClaw Envoy adopts a newer `protocol_version`, should Hermes Envoy auto-negotiate or stay pinned until explicitly updated?

## 17. Builder Prompt

Build `hermes-envoy` inside the `agent-envoy` monorepo as the Hermes-side requester/client counterpart to the existing OpenClaw Agent Envoy.

Constraints:

- Keep the repo split as `openclaw-envoy/` and `hermes-envoy/`.
- Do not build Hermes public provider/server mode in this pass.
- `agent-envoy/hermes-envoy/` must itself be a valid Hermes plugin root containing `plugin.yaml`, `__init__.py`, and helper modules.
- Implement tools: `envoy_session_start`, `envoy_send`, `envoy_status`, `envoy_close`, `envoy_consult`.
- Implement `/envoy help|status|close <session_id>`.
- Use the OpenClaw requester WebSocket contract from this spec.
- Enforce deterministic local guardrails before outbound send.
- Never persist raw grant tokens.
- Persist sanitized state and audit data under `~/.hermes/envoy/`.
- Add cleanup hooks for `on_session_end`, `on_session_finalize`, and `subagent_stop`.
- Add tests and a package gate; run root `ctrl:gate` if the repo provides it, otherwise run the documented package gate.
- If a detail is ambiguous, resolve it conservatively and record it under Open Questions or implementation notes instead of broadening scope.

Deliverables:

1. `hermes-envoy` subproject code.
2. Tests and fixtures.
3. `README.md` and `after-install.md`.
4. Gate output proving start/send/local-block/close behavior.

## 18. Reviewer Prompt

Review the `hermes-envoy` implementation against this spec.

Check specifically:

1. The subproject root is a valid Hermes plugin directory with `plugin.yaml` and `__init__.py`.
2. Tool names, slash command, and hook registrations match the spec exactly.
3. Raw grant tokens do not appear anywhere in persisted files, logs, transcripts, or docs.
4. Local guardrails block secret-bearing or exfiltration-like prompts **before** network send.
5. Protocol handling matches the OpenClaw requester contract and fails closed on unknown events.
6. `envoy_consult` is a thin wrapper over the lifecycle tools rather than a separate hidden codepath.
7. State and audit files under `~/.hermes/envoy/` are sanitized and restart-safe.
8. Cleanup hooks do not trap Hermes shutdown.
9. Install/enable/restart/rollback docs are accurate.
10. The proof gate ran: root `ctrl:gate` if available, otherwise the documented `hermes-envoy` package gate.

Reject the change if it adds provider/server behavior, local file-read features, raw token persistence, or unguarded remote-content execution paths.
