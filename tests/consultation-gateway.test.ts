import assert from "node:assert/strict";
import http, { type OutgoingHttpHeaders } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { afterEach, beforeEach, describe, it } from "node:test";
import { WebSocket } from "ws";

import { ConsultationGatewayRuntime } from "../src/gateway-runtime.js";
import { FakeConsultationAgentAdapter } from "../src/consultation-adapter.js";
import type { ConsultationConfig } from "../src/consultation-types.js";
import { startRegisteredServer } from "./helpers.js";

let tmpDir = "";
let storePath = "";

function makeConfig(overrides: Partial<ConsultationConfig> = {}): ConsultationConfig {
  return {
    enabled: true,
    networkMode: "private",
    apiBasePath: "/v1/consultation",
    wsPath: "/v1/consultations",
    internalBaseUrl: undefined,
    publicBaseUrl: undefined,
    publicWsUrl: undefined,
    protocolVersion: "2026-05-31",
    authTimeoutMs: 200,
    maxGrantTtlSeconds: 7_200,
    maxGrantTurns: 10,
    maxSessionsPerGrant: 2,
    auditFailClosed: false,
    storePath,
    owners: [
      { id: "owner-1", token: "owner-token-1", agentIds: ["agent-owner-1"] },
      { id: "owner-2", token: "owner-token-2", agentIds: ["agent-owner-2"] },
    ],
    ...overrides,
  };
}

async function postJsonWithHeaders(
  baseUrl: string,
  pathname: string,
  body: Record<string, unknown>,
  headers: OutgoingHttpHeaders = {},
): Promise<{ statusCode: number; json: any }> {
  const url = new URL(pathname, baseUrl);
  const payload = JSON.stringify(body);

  const response = await new Promise<{ statusCode: number; bodyText: string }>((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        ...headers,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 0,
          bodyText: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });

  return {
    statusCode: response.statusCode,
    json: JSON.parse(response.bodyText),
  };
}

function createEventQueue(ws: WebSocket): { nextEvent: () => Promise<any> } {
  const buffered: any[] = [];
  const waiters: Array<(event: any) => void> = [];

  ws.on("message", (raw: Buffer) => {
    const event = JSON.parse(raw.toString());
    const waiter = waiters.shift();
    if (waiter) {
      waiter(event);
      return;
    }
    buffered.push(event);
  });

  return {
    nextEvent() {
      if (buffered.length > 0) {
        return Promise.resolve(buffered.shift());
      }
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
  };
}

async function createPolicyAndGrant(baseUrl: string, body?: Record<string, unknown>) {
  const policyResponse = await fetch(`${baseUrl}/v1/consultation/policies`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer owner-token-1",
    },
    body: JSON.stringify({
      name: "Read only research",
      template: "read-only-research",
      ...body,
    }),
  });
  assert.equal(policyResponse.status, 201);
  const policy = await policyResponse.json() as any;

  const grantResponse = await fetch(`${baseUrl}/v1/consultation/grants`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer owner-token-1",
    },
    body: JSON.stringify({
      target_agent_id: "agent-owner-1",
      requester: { type: "human", display_name: "Requester", ...(body?.requester as Record<string, unknown> | undefined) },
      policy_id: policy.policy_id,
      max_turns: 2,
      ttl_seconds: 60,
      max_sessions: 1,
      ...body,
    }),
  });
  assert.equal(grantResponse.status, 201);
  return await grantResponse.json() as any;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consultation-gateway-"));
  storePath = path.join(tmpDir, "consultation-store.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("consultation gateway plugin", () => {
  it("supports policy dry-run, denied prompts, receipts, and no-bypass adapter protection", async () => {
    const adapter = new FakeConsultationAgentAdapter();
    const runtime = new ConsultationGatewayRuntime(makeConfig(), {
      info() {},
      warn() {},
      error() {},
    }, adapter);
    runtime.start();

    const server = http.createServer((req, res) => {
      void runtime.handleApiRequest(req, res);
    });
    server.on("upgrade", (req, socket, head) => {
      runtime.handleWebSocketUpgrade(req, socket, head);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as import("node:net").AddressInfo).port;
    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      const policyResponse = await fetch(`${baseUrl}/v1/consultation/policies`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer owner-token-1",
        },
        body: JSON.stringify({
          name: "Read only research",
          template: "read-only-research",
        }),
      });
      const policy = await policyResponse.json() as any;

      const dryRunResponse = await fetch(`${baseUrl}/v1/consultation/policies/${policy.policy_id}/dry-run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer owner-token-1",
        },
        body: JSON.stringify({
          prompt: "Please buy this market for me",
          client: { type: "human", display_name: "Requester" },
        }),
      });
      const dryRun = await dryRunResponse.json() as any;
      assert.equal(dryRun.decision, "deny");
      assert.equal(dryRun.would_reach_agent, false);

      const grantResponse = await fetch(`${baseUrl}/v1/consultation/grants`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer owner-token-1",
        },
        body: JSON.stringify({
          target_agent_id: "agent-owner-1",
          requester: { type: "human", display_name: "Requester" },
          policy_id: policy.policy_id,
          max_turns: 1,
          ttl_seconds: 60,
          max_sessions: 1,
        }),
      });
      const grant = await grantResponse.json() as any;

      const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/consultations`);
      await once(ws, "open");
      const queue = createEventQueue(ws);
      ws.send(JSON.stringify({
        protocol_version: "2026-05-31",
        type: "session.start",
        grant_token: grant.grant_token,
        client: { type: "human", display_name: "Requester" },
      }));
      const started = await queue.nextEvent();
      assert.equal(started.type, "session.started");

      ws.send(JSON.stringify({
        protocol_version: "2026-05-31",
        type: "consultation.send",
        message_id: "msg-1",
        content: { type: "text", text: "Please buy this market for me" },
      }));
      const denied = await queue.nextEvent();
      assert.equal(denied.type, "policy.denied");
      assert.equal(denied.policy_decision, "deny");
      assert.equal(denied.remaining_turns, 0);
      const closed = await queue.nextEvent();
      assert.equal(closed.reason, "limit_exceeded");

      const snapshot = JSON.parse(fs.readFileSync(storePath, "utf8")) as { messages: Array<{ result_type?: string }> };
      assert.equal(snapshot.messages.some((message) => message.result_type === "agent.final"), false);
      assert.equal(adapter.invocations.length, 0);
      ws.close();
    } finally {
      await runtime.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("supports allowed prompts, idempotent duplicates, agent session schema, audit retrieval, and revocation", async () => {
    const server = await startRegisteredServer(makeConfig() as unknown as Record<string, unknown>);
    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const grant = await createPolicyAndGrant(baseUrl, {
        requester: { type: "agent", subject_id: "agent-external-1", display_name: "Research Agent" },
      });
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v1/consultations`);
      await once(ws, "open");
      const queue = createEventQueue(ws);
      ws.send(JSON.stringify({
        protocol_version: "2026-05-31",
        type: "session.start",
        grant_token: grant.grant_token,
        client: {
          type: "agent",
          agent_id: "agent-external-1",
          agent_name: "Research Agent",
          run_id: "run-1",
          purpose: "Need context",
          response_format: "text",
        },
      }));
      const started = await queue.nextEvent();
      assert.equal(started.type, "session.started");

      ws.send(JSON.stringify({
        protocol_version: "2026-05-31",
        type: "consultation.send",
        message_id: "msg-allow",
        content: { type: "text", text: "Summarize the public market context" },
      }));
      const allowed = await queue.nextEvent();
      assert.equal(allowed.type, "agent.final");

      ws.send(JSON.stringify({
        protocol_version: "2026-05-31",
        type: "consultation.send",
        message_id: "msg-allow",
        content: { type: "text", text: "Summarize the public market context" },
      }));
      const duplicate = await queue.nextEvent();
      assert.equal(duplicate.type, "agent.final");

      const auditResponse = await fetch(`${baseUrl}/v1/consultation/sessions/${started.session_id}/audit`, {
        headers: { authorization: "Bearer owner-token-1" },
      });
      assert.equal(auditResponse.status, 200);
      const audit = await auditResponse.json() as any;
      assert.ok(audit.messages.some((message: any) => message.result_type === "agent.final"));

      const revokeResponse = await fetch(`${baseUrl}/v1/consultation/grants/${grant.grant_id}/revoke`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer owner-token-1",
        },
        body: JSON.stringify({ reason: "done" }),
      });
      assert.equal(revokeResponse.status, 200);

      const closed = await queue.nextEvent();
      assert.equal(closed.reason, "grant_revoked");
      ws.close();
    } finally {
      await server.close();
    }
  });

  it("returns the internal host-derived ws_url when no public session config is set", async () => {
    const server = await startRegisteredServer(makeConfig() as unknown as Record<string, unknown>);
    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const policyResponse = await fetch(`${baseUrl}/v1/consultation/policies`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer owner-token-1",
        },
        body: JSON.stringify({
          name: "Read only research",
          template: "read-only-research",
        }),
      });
      assert.equal(policyResponse.status, 201);
      const policy = await policyResponse.json() as any;

      const grantResponse = await postJsonWithHeaders(
        baseUrl,
        "/v1/consultation/grants",
        {
          target_agent_id: "agent-owner-1",
          requester: { type: "human", display_name: "Requester" },
          policy_id: policy.policy_id,
          max_turns: 2,
          ttl_seconds: 60,
          max_sessions: 1,
        },
        {
          authorization: "Bearer owner-token-1",
          host: "100.88.77.66:8443",
          "x-forwarded-proto": "https",
        },
      );

      assert.equal(grantResponse.statusCode, 201);
      assert.equal(grantResponse.json.ws_url, "wss://100.88.77.66:8443/v1/consultations");
    } finally {
      await server.close();
    }
  });

  it("derives the requester ws_url from publicBaseUrl and wsPath when configured", async () => {
    const server = await startRegisteredServer(
      makeConfig({
        networkMode: "tailscale-private-admin-public-session",
        wsPath: "/custom/consultations",
        publicBaseUrl: "https://consult.superada.ai",
      }) as unknown as Record<string, unknown>,
    );
    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const policyResponse = await fetch(`${baseUrl}/v1/consultation/policies`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer owner-token-1",
        },
        body: JSON.stringify({
          name: "Read only research",
          template: "read-only-research",
        }),
      });
      assert.equal(policyResponse.status, 201);
      const policy = await policyResponse.json() as any;

      const grantResponse = await postJsonWithHeaders(
        baseUrl,
        "/v1/consultation/grants",
        {
          target_agent_id: "agent-owner-1",
          requester: { type: "human", display_name: "Requester" },
          policy_id: policy.policy_id,
          max_turns: 2,
          ttl_seconds: 60,
          max_sessions: 1,
        },
        {
          authorization: "Bearer owner-token-1",
          host: "100.88.77.66:8443",
          "x-forwarded-proto": "https",
        },
      );

      assert.equal(grantResponse.statusCode, 201);
      assert.equal(grantResponse.json.ws_url, "wss://consult.superada.ai/custom/consultations");
    } finally {
      await server.close();
    }
  });

  it("prefers publicWsUrl over publicBaseUrl for requester sessions", async () => {
    const server = await startRegisteredServer(
      makeConfig({
        networkMode: "tailscale-private-admin-public-session",
        publicBaseUrl: "https://consult.superada.ai",
        publicWsUrl: "wss://sessions.superada.ai/v1/consultations",
      }) as unknown as Record<string, unknown>,
    );
    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const policyResponse = await fetch(`${baseUrl}/v1/consultation/policies`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer owner-token-1",
        },
        body: JSON.stringify({
          name: "Read only research",
          template: "read-only-research",
        }),
      });
      assert.equal(policyResponse.status, 201);
      const policy = await policyResponse.json() as any;

      const grantResponse = await postJsonWithHeaders(
        baseUrl,
        "/v1/consultation/grants",
        {
          target_agent_id: "agent-owner-1",
          requester: { type: "human", display_name: "Requester" },
          policy_id: policy.policy_id,
          max_turns: 2,
          ttl_seconds: 60,
          max_sessions: 1,
        },
        {
          authorization: "Bearer owner-token-1",
          host: "100.88.77.66:8443",
          "x-forwarded-proto": "https",
        },
      );

      assert.equal(grantResponse.statusCode, 201);
      assert.equal(grantResponse.json.ws_url, "wss://sessions.superada.ai/v1/consultations");
    } finally {
      await server.close();
    }
  });

  it("expires grants and closes in-flight sessions before delivery", async () => {
    const adapter = new FakeConsultationAgentAdapter({ delayMs: 80 });
    const runtime = new ConsultationGatewayRuntime(makeConfig({ authTimeoutMs: 500, maxGrantTtlSeconds: 5 }), {
      info() {},
      warn() {},
      error() {},
    }, adapter);
    runtime.start();
    try {
      const policy = await runtime.store.createPolicy("owner-1", {
        name: "Read only research",
        template: "read-only-research",
      });
      const grant = await runtime.store.createGrant("owner-1", {
        target_agent_id: "agent-owner-1",
        requester: { type: "human", display_name: "Requester" },
        policy_id: policy.id,
        max_turns: 2,
        ttl_seconds: 1,
        max_sessions: 1,
      }, "ws://127.0.0.1:18800/v1/consultations");
      const started = await runtime.store.startSession(grant.grant_token, {
        type: "human",
        display_name: "Requester",
      });
      const reservation = await runtime.store.reserveTurn(started.session.id, "msg-expire", "Summarize the public market context");
      assert.equal("kind" in reservation, false);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const snapshot = await runtime.store.getStoreSnapshot();
      const session = snapshot.sessions.find((entry) => entry.id === started.session.id);
      const storedGrant = snapshot.grants.find((entry) => entry.id === grant.grant_id);
      assert.equal(session?.status, "closed");
      assert.equal(session?.close_reason, "grant_expired");
      assert.equal(storedGrant?.status, "expired");
    } finally {
      await runtime.stop();
    }
  });
});
