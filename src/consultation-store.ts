import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  CONSULTATION_LIMIT_MESSAGE,
  CONSULTATION_PROTOCOL_VERSION,
  CONSULTATION_TRANSCRIPT_NOTICE,
  CONSULTATION_UNAVAILABLE_MESSAGE,
  type ConsultationAuditEvent,
  type ConsultationClientDescriptor,
  type ConsultationCloseReason,
  type ConsultationCompiledPolicy,
  type ConsultationConfig,
  type ConsultationGrantRecord,
  type ConsultationGrantRequest,
  type ConsultationGrantView,
  type ConsultationMessageRecord,
  type ConsultationPolicyInput,
  type ConsultationSessionRecord,
  type ConsultationStartResult,
  type ConsultationStoredState,
  type ConsultationTurnReservation,
} from "./consultation-types.js";
import { compileConsultationPolicy, evaluateConsultationPolicy } from "./consultation-policy.js";

interface OwnerIdentity {
  id: string;
  agentIds: string[];
}

interface DuplicateResult {
  kind: "duplicate";
  event: Record<string, unknown>;
}

interface DuplicateInFlightResult {
  kind: "duplicate_in_flight";
}

interface ReserveFailureResult {
  kind: "error";
  reason: ConsultationCloseReason | "invalid_message";
  message: string;
}

export type ReserveTurnResult = ConsultationTurnReservation | DuplicateResult | DuplicateInFlightResult | ReserveFailureResult;

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function ensureDirFor(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const EMPTY_STATE: ConsultationStoredState = {
  version: 1,
  policies: [],
  grants: [],
  sessions: [],
  messages: [],
  audit_events: [],
};

export class ConsultationStore {
  private readonly statePath: string;
  private readonly authTokenMap = new Map<string, OwnerIdentity>();
  private readonly closeListeners = new Set<(sessionId: string, reason: ConsultationCloseReason) => void>();
  private state: ConsultationStoredState = clone(EMPTY_STATE);
  private mutation = Promise.resolve();

  constructor(private readonly config: ConsultationConfig) {
    this.statePath = config.storePath;
    for (const owner of config.owners) {
      this.authTokenMap.set(owner.token, { id: owner.id, agentIds: owner.agentIds });
    }
    this.load();
  }

  resolveOwnerToken(token: string | undefined): OwnerIdentity | null {
    return token ? this.authTokenMap.get(token) || null : null;
  }

  onSessionClosed(listener: (sessionId: string, reason: ConsultationCloseReason) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  async createPolicy(ownerId: string, input: ConsultationPolicyInput): Promise<ConsultationCompiledPolicy> {
    return this.withMutation(async () => {
      const policy = compileConsultationPolicy(ownerId, makeId("pol"), input, nowIso());
      this.state.policies.push(policy);
      this.persist();
      this.recordAudit({
        event_type: "consultation.policy.created",
        actor_type: "owner",
        metadata_json: {
          owner_id: ownerId,
          policy_id: policy.id,
          template: policy.template,
          rules_count: policy.rules.length,
        },
      });
      this.persist();
      return clone(policy);
    });
  }

  async dryRunPolicy(ownerId: string, policyId: string, prompt: string, client?: ConsultationClientDescriptor) {
    return this.withMutation(async () => {
      const policy = this.requirePolicy(policyId, ownerId);
      return evaluateConsultationPolicy(policy, prompt, client);
    });
  }

  async createGrant(ownerId: string, input: ConsultationGrantRequest, wsUrl: string): Promise<ConsultationGrantView> {
    return this.withMutation(async () => {
      const owner = this.requireOwner(ownerId);
      if (!owner.agentIds.includes(input.target_agent_id)) {
        throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
      }

      const policy = this.requirePolicy(input.policy_id, ownerId);
      if (!Number.isFinite(input.ttl_seconds) || input.ttl_seconds <= 0) {
        throw new Error("ttl_seconds must be a positive finite integer");
      }
      if (input.ttl_seconds > this.config.maxGrantTtlSeconds) {
        throw new Error(`ttl_seconds cannot exceed ${this.config.maxGrantTtlSeconds}`);
      }
      if (!Number.isFinite(input.max_turns) || input.max_turns <= 0) {
        throw new Error("max_turns must be a positive finite integer");
      }
      if (input.max_turns > this.config.maxGrantTurns) {
        throw new Error(`max_turns cannot exceed ${this.config.maxGrantTurns}`);
      }

      const maxSessions = Math.max(1, Math.floor(input.max_sessions || 1));
      if (maxSessions > this.config.maxSessionsPerGrant) {
        throw new Error(`max_sessions cannot exceed ${this.config.maxSessionsPerGrant}`);
      }

      const rawToken = crypto.randomBytes(24).toString("base64url");
      const grant: ConsultationGrantRecord = {
        id: makeId("gr"),
        owner_id: ownerId,
        target_agent_id: input.target_agent_id,
        requester_type: input.requester.type,
        requester_subject_id: input.requester.subject_id,
        requester_display_name: input.requester.display_name,
        token_hash: hashToken(rawToken),
        policy_id: policy.id,
        max_turns: Math.floor(input.max_turns),
        used_turns: 0,
        max_sessions: maxSessions,
        active_sessions: 0,
        max_prompt_chars: input.max_prompt_chars,
        expires_at: new Date(Date.now() + input.ttl_seconds * 1000).toISOString(),
        status: "active",
        metadata_json: input.metadata,
        created_at: nowIso(),
      };

      this.state.grants.push(grant);
      this.recordAudit({
        grant_id: grant.id,
        event_type: "consultation.grant.created",
        actor_type: "owner",
        metadata_json: {
          owner_id: ownerId,
          target_agent_id: grant.target_agent_id,
          policy_id: grant.policy_id,
          max_turns: grant.max_turns,
          max_sessions: grant.max_sessions,
          expires_at: grant.expires_at,
        },
      });
      this.persist();

      return {
        grant_id: grant.id,
        grant_token: rawToken,
        expires_at: grant.expires_at,
        max_turns: grant.max_turns,
        max_sessions: grant.max_sessions,
        policy_id: grant.policy_id,
        ws_url: wsUrl,
      };
    });
  }

  async revokeGrant(ownerId: string, grantId: string, reason: string): Promise<{ closedSessionIds: string[] }> {
    return this.withMutation(async () => {
      const grant = this.requireGrant(grantId, ownerId);
      if (grant.status === "revoked") {
        return { closedSessionIds: [] };
      }

      grant.status = "revoked";
      grant.revoked_at = nowIso();
      grant.revoked_reason = reason || "owner_revoked";

      const closedSessionIds: string[] = [];
      for (const session of this.state.sessions) {
        if (session.grant_id === grantId && session.status === "open") {
          this.closeSessionRecord(session, "grant_revoked");
          closedSessionIds.push(session.id);
        }
      }

      this.recordAudit({
        grant_id: grant.id,
        event_type: "consultation.grant.revoked",
        actor_type: "owner",
        metadata_json: {
          owner_id: ownerId,
          reason: grant.revoked_reason,
        },
      });
      this.persist();

      for (const sessionId of closedSessionIds) {
        this.emitClose(sessionId, "grant_revoked");
      }
      return { closedSessionIds };
    });
  }

  async listGrantSessions(ownerId: string, grantId: string): Promise<ConsultationSessionRecord[]> {
    return this.withMutation(async () => {
      this.requireGrant(grantId, ownerId);
      return clone(this.state.sessions.filter((session) => session.grant_id === grantId));
    });
  }

  async getSessionAudit(ownerId: string, sessionId: string): Promise<Record<string, unknown>> {
    return this.withMutation(async () => {
      const session = this.state.sessions.find((entry) => entry.id === sessionId);
      if (!session) {
        throw Object.assign(new Error("Not found"), { statusCode: 404 });
      }

      const grant = this.requireGrant(session.grant_id, ownerId);
      return {
        session: clone(session),
        grant: clone(grant),
        transcript_notice: CONSULTATION_TRANSCRIPT_NOTICE,
        messages: clone(this.state.messages.filter((message) => message.session_id === sessionId)),
        audit_events: clone(this.state.audit_events.filter((event) => event.session_id === sessionId || event.grant_id === grant.id)),
      };
    });
  }

  async startSession(rawToken: string, client: ConsultationClientDescriptor): Promise<ConsultationStartResult> {
    return this.withMutation(async () => {
      const hashed = hashToken(rawToken);
      const grant = this.state.grants.find((entry) => entry.token_hash === hashed);
      if (!grant) {
        throw Object.assign(new Error(CONSULTATION_UNAVAILABLE_MESSAGE), { closeReason: "auth_failed" as const });
      }

      this.syncGrantStatus(grant);
      if (grant.status !== "active" || grant.active_sessions >= grant.max_sessions) {
        throw Object.assign(new Error(CONSULTATION_UNAVAILABLE_MESSAGE), { closeReason: "auth_failed" as const });
      }

      this.validateClientAgainstGrant(grant, client);

      const session: ConsultationSessionRecord = {
        id: makeId("sess"),
        grant_id: grant.id,
        client_type: client.type,
        client_subject_id: client.type === "agent" ? client.agent_id : client.display_name,
        client_metadata_json: clone(client),
        status: "open",
        started_at: nowIso(),
      };
      grant.active_sessions += 1;
      this.state.sessions.push(session);
      this.recordAudit({
        grant_id: grant.id,
        session_id: session.id,
        event_type: "consultation.session.started",
        actor_type: "requester",
        metadata_json: {
          client_type: client.type,
          client_subject_id: session.client_subject_id,
          response_format: client.response_format || "text",
        },
      });
      this.persist();
      return {
        session: clone(session),
        grant: clone(grant),
        policy: clone(this.requirePolicy(grant.policy_id, grant.owner_id)),
      };
    });
  }

  async closeSession(sessionId: string, reason: ConsultationCloseReason): Promise<void> {
    return this.withMutation(async () => {
      const session = this.state.sessions.find((entry) => entry.id === sessionId);
      if (!session || session.status === "closed") {
        return;
      }
      this.closeSessionRecord(session, reason);
      this.persist();
    });
  }

  async expireOpenSessions(): Promise<Array<{ sessionId: string; reason: ConsultationCloseReason }>> {
    return this.withMutation(async () => {
      const closed: Array<{ sessionId: string; reason: ConsultationCloseReason }> = [];
      for (const session of this.state.sessions) {
        if (session.status !== "open") {
          continue;
        }
        const grant = this.state.grants.find((entry) => entry.id === session.grant_id);
        if (!grant) {
          continue;
        }
        const reason = this.determineGrantCloseReason(grant);
        if (!reason) {
          continue;
        }
        this.closeSessionRecord(session, reason);
        closed.push({ sessionId: session.id, reason });
      }
      if (closed.length > 0) {
        this.persist();
      }
      return closed;
    });
  }

  async reserveTurn(sessionId: string, messageId: string, prompt: string): Promise<ReserveTurnResult> {
    return this.withMutation(async () => {
      if (!messageId.trim()) {
        return { kind: "error", reason: "invalid_message", message: "message_id is required" };
      }
      const session = this.state.sessions.find((entry) => entry.id === sessionId);
      if (!session || session.status !== "open") {
        return { kind: "error", reason: "auth_failed", message: CONSULTATION_UNAVAILABLE_MESSAGE };
      }
      const grant = this.state.grants.find((entry) => entry.id === session.grant_id);
      if (!grant) {
        return { kind: "error", reason: "auth_failed", message: CONSULTATION_UNAVAILABLE_MESSAGE };
      }
      this.syncGrantStatus(grant);
      const closeReason = this.determineGrantCloseReason(grant);
      if (closeReason) {
        return {
          kind: "error",
          reason: closeReason,
          message: closeReason === "limit_exceeded" ? CONSULTATION_LIMIT_MESSAGE : CONSULTATION_UNAVAILABLE_MESSAGE,
        };
      }

      const existing = this.state.messages.find(
        (entry) => entry.session_id === sessionId && entry.client_message_id === messageId && entry.direction === "requester_to_agent",
      );
      if (existing?.result_payload) {
        return { kind: "duplicate", event: clone(existing.result_payload) };
      }
      if (existing?.pending) {
        return { kind: "duplicate_in_flight" };
      }

      grant.used_turns += 1;
      const correlationId = makeId("corr");
      const message: ConsultationMessageRecord = {
        id: makeId("msg"),
        session_id: sessionId,
        grant_id: grant.id,
        client_message_id: messageId,
        direction: "requester_to_agent",
        content_text: prompt,
        policy_decision: "not_applicable",
        turn_index: grant.used_turns,
        correlation_id: correlationId,
        pending: true,
        created_at: nowIso(),
      };
      this.state.messages.push(message);
      this.recordAudit({
        grant_id: grant.id,
        session_id: session.id,
        message_id: message.id,
        event_type: "consultation.turn.reserved",
        actor_type: "requester",
        correlation_id: correlationId,
        metadata_json: {
          client_message_id: messageId,
          turn_index: message.turn_index,
        },
      });
      this.persist();

      return {
        grant: clone(grant),
        session: clone(session),
        policy: clone(this.requirePolicy(grant.policy_id, grant.owner_id)),
        turn_index: grant.used_turns,
        remaining_turns: Math.max(0, grant.max_turns - grant.used_turns),
        max_prompt_chars: grant.max_prompt_chars,
      };
    });
  }

  async finalizeDenied(sessionId: string, messageId: string, matchedRuleIds: string[], event: Record<string, unknown>) {
    return this.finalizeTurn(sessionId, messageId, "deny", matchedRuleIds, event);
  }

  async finalizeAllowed(
    sessionId: string,
    messageId: string,
    matchedRuleIds: string[],
    event: Record<string, unknown>,
    adapterCallId: string,
  ) {
    return this.finalizeTurn(sessionId, messageId, "allow", matchedRuleIds, event, adapterCallId);
  }

  async finalizeError(sessionId: string, messageId: string, event: Record<string, unknown>) {
    return this.finalizeTurn(sessionId, messageId, "error", [], event);
  }

  async canDeliverToSession(sessionId: string): Promise<{ allowed: boolean; reason?: ConsultationCloseReason }> {
    return this.withMutation(async () => {
      const session = this.state.sessions.find((entry) => entry.id === sessionId);
      if (!session || session.status !== "open") {
        return { allowed: false, reason: "auth_failed" };
      }
      const grant = this.state.grants.find((entry) => entry.id === session.grant_id);
      if (!grant) {
        return { allowed: false, reason: "auth_failed" };
      }
      this.syncGrantStatus(grant);
      const reason = this.determineGrantCloseReason(grant);
      return reason ? { allowed: false, reason } : { allowed: true };
    });
  }

  async getStoreSnapshot(): Promise<ConsultationStoredState> {
    return this.withMutation(async () => clone(this.state));
  }

  private async finalizeTurn(
    sessionId: string,
    messageId: string,
    decision: "allow" | "deny" | "error",
    matchedRuleIds: string[],
    event: Record<string, unknown>,
    adapterCallId?: string,
  ): Promise<{ closeReason?: ConsultationCloseReason }> {
    return this.withMutation(async () => {
      const message = this.state.messages.find(
        (entry) => entry.session_id === sessionId && entry.client_message_id === messageId && entry.direction === "requester_to_agent",
      );
      if (!message) {
        return {};
      }
      message.pending = false;
      message.policy_decision = decision;
      message.matched_rule_ids_json = matchedRuleIds;
      message.adapter_call_id = adapterCallId;
      message.result_type = decision === "allow" ? "agent.final" : decision === "deny" ? "policy.denied" : "consultation.error";
      message.receipt_id = typeof event.receipt_id === "string" ? event.receipt_id : undefined;
      message.result_payload = clone(event);

      this.state.messages.push({
        id: makeId("msg"),
        session_id: message.session_id,
        grant_id: message.grant_id,
        client_message_id: message.client_message_id,
        direction: decision === "allow" ? "agent_to_requester" : "system_to_requester",
        content_text: typeof event.text === "string" ? event.text : typeof event.message === "string" ? event.message : undefined,
        policy_decision: decision,
        receipt_id: message.receipt_id,
        turn_index: message.turn_index,
        correlation_id: message.correlation_id,
        created_at: nowIso(),
      });

      this.recordAudit({
        grant_id: message.grant_id,
        session_id: message.session_id,
        message_id: message.id,
        event_type: `consultation.turn.${decision}`,
        actor_type: "system",
        correlation_id: message.correlation_id,
        metadata_json: {
          matched_rule_ids: matchedRuleIds,
          receipt_id: message.receipt_id,
          turn_index: message.turn_index,
        },
      });

      const grant = this.state.grants.find((entry) => entry.id === message.grant_id);
      if (!grant) {
        this.persist();
        return {};
      }
      this.syncGrantStatus(grant);
      const closeReason = this.determineGrantCloseReason(grant);
      this.persist();
      return closeReason ? { closeReason } : {};
    });
  }

  private validateClientAgainstGrant(grant: ConsultationGrantRecord, client: ConsultationClientDescriptor): void {
    if (client.type !== "human" && client.type !== "agent") {
      throw Object.assign(new Error(CONSULTATION_UNAVAILABLE_MESSAGE), { closeReason: "auth_failed" as const });
    }
    if (client.type === "agent") {
      if (!client.agent_id || !client.run_id || !client.purpose || !client.response_format) {
        throw Object.assign(new Error("Missing required agent client fields"), { closeReason: "protocol_error" as const });
      }
      if (client.response_format !== "text" && client.response_format !== "json_object") {
        throw Object.assign(new Error("Unsupported response_format"), { closeReason: "protocol_error" as const });
      }
    }
    if (grant.requester_type !== "unknown_bearer" && grant.requester_type !== client.type) {
      throw Object.assign(new Error(CONSULTATION_UNAVAILABLE_MESSAGE), { closeReason: "auth_failed" as const });
    }
    if (grant.requester_subject_id) {
      const subject = client.type === "agent" ? client.agent_id : client.display_name;
      if (grant.requester_subject_id !== subject) {
        throw Object.assign(new Error(CONSULTATION_UNAVAILABLE_MESSAGE), { closeReason: "auth_failed" as const });
      }
    }
  }

  private determineGrantCloseReason(grant: ConsultationGrantRecord): ConsultationCloseReason | undefined {
    this.syncGrantStatus(grant);
    if (grant.status === "revoked") {
      return "grant_revoked";
    }
    if (grant.status === "expired") {
      return "grant_expired";
    }
    if (grant.used_turns >= grant.max_turns) {
      return "limit_exceeded";
    }
    return undefined;
  }

  private closeSessionRecord(session: ConsultationSessionRecord, reason: ConsultationCloseReason): void {
    if (session.status === "closed") {
      return;
    }
    session.status = "closed";
    session.close_reason = reason;
    session.closed_at = nowIso();
    const grant = this.state.grants.find((entry) => entry.id === session.grant_id);
    if (grant && grant.active_sessions > 0) {
      grant.active_sessions -= 1;
      this.syncGrantStatus(grant);
    }
    this.recordAudit({
      grant_id: session.grant_id,
      session_id: session.id,
      event_type: "consultation.session.closed",
      actor_type: "system",
      metadata_json: { reason },
    });
  }

  private requireOwner(ownerId: string): OwnerIdentity {
    const owner = this.config.owners.find((entry) => entry.id === ownerId);
    if (!owner) {
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    }
    return { id: owner.id, agentIds: owner.agentIds };
  }

  private requirePolicy(policyId: string, ownerId: string): ConsultationCompiledPolicy {
    const policy = this.state.policies.find((entry) => entry.id === policyId);
    if (!policy) {
      throw Object.assign(new Error("Policy not found"), { statusCode: 404 });
    }
    if (policy.owner_id !== ownerId) {
      throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    }
    return policy;
  }

  private requireGrant(grantId: string, ownerId: string): ConsultationGrantRecord {
    const grant = this.state.grants.find((entry) => entry.id === grantId);
    if (!grant) {
      throw Object.assign(new Error("Grant not found"), { statusCode: 404 });
    }
    if (grant.owner_id !== ownerId) {
      throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    }
    return grant;
  }

  private syncGrantStatus(grant: ConsultationGrantRecord): void {
    if (grant.status === "revoked") {
      return;
    }
    if (Date.parse(grant.expires_at) <= Date.now()) {
      grant.status = "expired";
      return;
    }
    if (grant.used_turns >= grant.max_turns) {
      grant.status = "exhausted";
      return;
    }
    grant.status = "active";
  }

  private load(): void {
    if (!fs.existsSync(this.statePath)) {
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(this.statePath, "utf-8")) as ConsultationStoredState;
    this.state = {
      version: 1,
      policies: parsed.policies || [],
      grants: parsed.grants || [],
      sessions: parsed.sessions || [],
      messages: parsed.messages || [],
      audit_events: parsed.audit_events || [],
    };
  }

  private persist(): void {
    ensureDirFor(this.statePath);
    const tmp = `${this.statePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.statePath);
  }

  private recordAudit(input: Omit<ConsultationAuditEvent, "id" | "created_at">): void {
    this.state.audit_events.push({
      id: makeId("audit"),
      created_at: nowIso(),
      ...input,
    });
  }

  private emitClose(sessionId: string, reason: ConsultationCloseReason): void {
    for (const listener of this.closeListeners) {
      listener(sessionId, reason);
    }
  }

  private async withMutation<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutation.then(fn, fn);
    this.mutation = run.then(() => undefined, () => undefined);
    return await run;
  }
}

export function buildSessionStartedPayload(start: ConsultationStartResult): Record<string, unknown> {
  return {
    protocol_version: CONSULTATION_PROTOCOL_VERSION,
    type: "session.started",
    session_id: start.session.id,
    grant_id: start.grant.id,
    remaining_turns: Math.max(0, start.grant.max_turns - start.grant.used_turns),
    expires_at: start.grant.expires_at,
    transcript_notice: start.policy.requester_transcript_notice ? CONSULTATION_TRANSCRIPT_NOTICE : undefined,
  };
}
