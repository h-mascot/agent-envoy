export declare const CONSULTATION_PROTOCOL_VERSION = "2026-05-31";
export declare const CONSULTATION_GENERIC_DENY_MESSAGE = "This request was blocked by the owner's access policy.";
export declare const CONSULTATION_UNAVAILABLE_MESSAGE = "This consultation is unavailable.";
export declare const CONSULTATION_LIMIT_MESSAGE = "This consultation has reached its message limit.";
export declare const CONSULTATION_EXPIRED_MESSAGE = "This consultation has expired.";
export declare const CONSULTATION_REVOKED_MESSAGE = "This consultation is no longer available.";
export declare const CONSULTATION_AGENT_UNAVAILABLE_MESSAGE = "The target agent is unavailable. Try again later or contact the owner.";
export declare const CONSULTATION_TRANSCRIPT_NOTICE = "The owner may inspect this consultation transcript and policy decisions.";
export type ConsultationPolicyAction = "allow" | "deny";
export type ConsultationPolicyTemplate = "general-safe-consult" | "topic-limited" | "no-secrets" | "read-only-research" | "skill-specific";
export type ConsultationRuleEffect = "allow" | "deny";
export type ConsultationRuleType = "contains_any" | "regex" | "max_chars" | "requires_client_field";
export type ConsultationClientType = "human" | "agent";
export type ConsultationRequesterType = ConsultationClientType | "unknown_bearer";
export type ConsultationGrantStatus = "active" | "revoked" | "expired" | "exhausted";
export type ConsultationSessionStatus = "auth_pending" | "open" | "closed";
export type ConsultationMessageDirection = "requester_to_agent" | "agent_to_requester" | "system_to_requester";
export type ConsultationPolicyDecision = "allow" | "deny" | "error" | "not_applicable";
export type ConsultationAuditActor = "owner" | "requester" | "system" | "operator";
export type ConsultationNetworkMode = "private" | "tailscale-private-admin-public-session";
export type ConsultationCloseReason = "auth_timeout" | "auth_failed" | "grant_expired" | "grant_revoked" | "limit_exceeded" | "protocol_error" | "policy_error" | "agent_unavailable" | "server_shutdown";
export interface ConsultationRuleInput {
    id?: string;
    name?: string;
    effect: ConsultationRuleEffect;
    type: ConsultationRuleType;
    values?: string[];
    pattern?: string;
    value?: number;
    field?: "purpose" | "agent_id" | "run_id" | "display_name";
}
export interface ConsultationRule extends ConsultationRuleInput {
    id: string;
}
export interface ConsultationPolicyInput {
    name: string;
    template?: ConsultationPolicyTemplate;
    default_action?: ConsultationPolicyAction;
    deny_reason_visibility?: "generic" | "owner_configured_reason";
    requester_transcript_notice?: boolean;
    rules?: ConsultationRuleInput[];
    allowed_keywords?: string[];
    blocked_keywords?: string[];
    max_prompt_chars?: number;
}
export interface ConsultationClientDescriptor {
    type: ConsultationClientType;
    display_name?: string;
    agent_id?: string;
    agent_name?: string;
    run_id?: string;
    purpose?: string;
    response_format?: "text" | "json_object";
}
export interface ConsultationCompiledPolicy {
    id: string;
    owner_id: string;
    name: string;
    template?: ConsultationPolicyTemplate;
    default_action: ConsultationPolicyAction;
    deny_reason_visibility: "generic" | "owner_configured_reason";
    requester_transcript_notice: boolean;
    requester_message: string;
    compiled_version: number;
    rules: ConsultationRule[];
    created_at: string;
    updated_at: string;
}
export interface ConsultationPolicyEvaluation {
    decision: ConsultationPolicyAction;
    matched_rules: ConsultationRule[];
    requester_message: string;
    would_reach_agent: boolean;
}
export interface ConsultationGrantRequest {
    target_agent_id: string;
    requester: {
        type: ConsultationRequesterType;
        subject_id?: string;
        display_name?: string;
    };
    policy_id: string;
    max_turns: number;
    ttl_seconds: number;
    max_sessions?: number;
    max_prompt_chars?: number;
    metadata?: Record<string, unknown>;
}
export interface ConsultationGrantRecord {
    id: string;
    owner_id: string;
    target_agent_id: string;
    requester_type: ConsultationRequesterType;
    requester_subject_id?: string;
    requester_display_name?: string;
    token_hash: string;
    policy_id: string;
    max_turns: number;
    used_turns: number;
    max_sessions: number;
    active_sessions: number;
    max_prompt_chars?: number;
    expires_at: string;
    status: ConsultationGrantStatus;
    metadata_json?: Record<string, unknown>;
    created_at: string;
    revoked_at?: string;
    revoked_reason?: string;
}
export interface ConsultationSessionRecord {
    id: string;
    grant_id: string;
    client_type: ConsultationClientType;
    client_subject_id?: string;
    client_metadata_json: ConsultationClientDescriptor;
    status: ConsultationSessionStatus;
    close_reason?: ConsultationCloseReason;
    started_at: string;
    closed_at?: string;
}
export interface ConsultationMessageRecord {
    id: string;
    session_id: string;
    grant_id: string;
    client_message_id: string;
    direction: ConsultationMessageDirection;
    content_text?: string;
    policy_decision: ConsultationPolicyDecision;
    matched_rule_ids_json?: string[];
    adapter_call_id?: string;
    receipt_id?: string;
    turn_index?: number;
    correlation_id?: string;
    result_type?: "agent.final" | "policy.denied" | "consultation.error";
    result_payload?: Record<string, unknown>;
    pending?: boolean;
    created_at: string;
}
export interface ConsultationAuditEvent {
    id: string;
    grant_id?: string;
    session_id?: string;
    message_id?: string;
    event_type: string;
    actor_type: ConsultationAuditActor;
    correlation_id?: string;
    metadata_json?: Record<string, unknown>;
    created_at: string;
}
export interface ConsultationOwnerConfig {
    id: string;
    token: string;
    agentIds: string[];
}
export interface ConsultationConfig {
    enabled: boolean;
    networkMode: ConsultationNetworkMode;
    apiBasePath: string;
    wsPath: string;
    internalBaseUrl?: string;
    publicBaseUrl?: string;
    publicWsUrl?: string;
    protocolVersion: string;
    authTimeoutMs: number;
    maxGrantTtlSeconds: number;
    maxGrantTurns: number;
    maxSessionsPerGrant: number;
    auditFailClosed: boolean;
    storePath: string;
    owners: ConsultationOwnerConfig[];
}
export interface ConsultationStartResult {
    session: ConsultationSessionRecord;
    grant: ConsultationGrantRecord;
    policy: ConsultationCompiledPolicy;
}
export interface ConsultationGrantView {
    grant_id: string;
    grant_token: string;
    expires_at: string;
    max_turns: number;
    max_sessions: number;
    policy_id: string;
    ws_url: string;
}
export interface ConsultationTurnReservation {
    grant: ConsultationGrantRecord;
    session: ConsultationSessionRecord;
    policy: ConsultationCompiledPolicy;
    turn_index: number;
    remaining_turns: number;
    max_prompt_chars?: number;
}
export interface ConsultationStoredState {
    version: 1;
    policies: ConsultationCompiledPolicy[];
    grants: ConsultationGrantRecord[];
    sessions: ConsultationSessionRecord[];
    messages: ConsultationMessageRecord[];
    audit_events: ConsultationAuditEvent[];
}
