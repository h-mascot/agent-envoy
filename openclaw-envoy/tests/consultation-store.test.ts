import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ConsultationStore } from "../src/consultation-store.js";
import type { ConsultationConfig } from "../src/consultation-types.js";

let tmpDir = "";
let storePath = "";

function makeConfig(): ConsultationConfig {
  return {
    enabled: true,
    networkMode: "private",
    apiBasePath: "/v1/consultation",
    wsPath: "/v1/consultations",
    internalBaseUrl: undefined,
    publicBaseUrl: undefined,
    publicWsUrl: undefined,
    protocolVersion: "2026-05-31",
    authTimeoutMs: 5_000,
    maxGrantTtlSeconds: 7_200,
    maxGrantTurns: 10,
    maxSessionsPerGrant: 2,
    auditFailClosed: false,
    storePath,
    owners: [
      { id: "owner-1", token: "owner-token-1", agentIds: ["agent-owner-1"] },
      { id: "owner-2", token: "owner-token-2", agentIds: ["agent-owner-2"] },
    ],
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consultation-store-"));
  storePath = path.join(tmpDir, "consultation-store.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("consultation store", () => {
  it("stores only a token hash and blocks cross-owner audit access", async () => {
    const store = new ConsultationStore(makeConfig());
    const policy = await store.createPolicy("owner-1", {
      name: "General safe",
      template: "general-safe-consult",
    });
    const grant = await store.createGrant("owner-1", {
      target_agent_id: "agent-owner-1",
      requester: { type: "human", display_name: "Requester" },
      policy_id: policy.id,
      max_turns: 2,
      ttl_seconds: 120,
    }, "ws://127.0.0.1:18800/v1/consultations");

    const raw = fs.readFileSync(storePath, "utf-8");
    assert.match(raw, /token_hash/);
    assert.doesNotMatch(raw, new RegExp(grant.grant_token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const started = await store.startSession(grant.grant_token, {
      type: "human",
      display_name: "Requester",
    });
    const audit = await store.getSessionAudit("owner-1", started.session.id);
    assert.equal((audit.session as any).id, started.session.id);

    await assert.rejects(() => store.getSessionAudit("owner-2", started.session.id), /Forbidden/);
  });
});
