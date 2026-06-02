# Agent Envoy

Agent Envoy is a two-runtime envoy project for owner-controlled, policy-bound agent consultations.

## Subprojects

- `openclaw-envoy/` - OpenClaw plugin for owner policies, grants, requester WebSocket sessions, revocation, and audit.
- `hermes-envoy/` - Hermes plugin design/spec for Hermes-side envoy participation.

## OpenClaw Envoy

```bash
cd openclaw-envoy
npm ci
npm test
npm run typecheck
npm run build
npm run plugin:validate
```

For local gateway testing from this monorepo checkout:

```bash
openclaw plugins install ./openclaw-envoy
openclaw plugins enable agent-envoy
openclaw plugins inspect agent-envoy --runtime --json
```

## Hermes Envoy

The Hermes implementation spec lives in `hermes-envoy/SPEC.md`.

The MVP direction is Hermes as a requester/client to an existing Agent Envoy grant. Hermes provider/server mode is intentionally later because the observed Hermes plugin template is tool/hook oriented, not a stable public HTTP-route extension surface.
