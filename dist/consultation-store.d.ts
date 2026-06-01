import { type ConsultationClientDescriptor, type ConsultationCloseReason, type ConsultationCompiledPolicy, type ConsultationConfig, type ConsultationGrantRequest, type ConsultationGrantView, type ConsultationPolicyInput, type ConsultationSessionRecord, type ConsultationStartResult, type ConsultationStoredState, type ConsultationTurnReservation } from "./consultation-types.js";
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
export declare class ConsultationStore {
    private readonly config;
    private readonly statePath;
    private readonly authTokenMap;
    private readonly closeListeners;
    private state;
    private mutation;
    constructor(config: ConsultationConfig);
    resolveOwnerToken(token: string | undefined): OwnerIdentity | null;
    onSessionClosed(listener: (sessionId: string, reason: ConsultationCloseReason) => void): () => void;
    createPolicy(ownerId: string, input: ConsultationPolicyInput): Promise<ConsultationCompiledPolicy>;
    dryRunPolicy(ownerId: string, policyId: string, prompt: string, client?: ConsultationClientDescriptor): Promise<import("./consultation-types.js").ConsultationPolicyEvaluation>;
    createGrant(ownerId: string, input: ConsultationGrantRequest, wsUrl: string): Promise<ConsultationGrantView>;
    revokeGrant(ownerId: string, grantId: string, reason: string): Promise<{
        closedSessionIds: string[];
    }>;
    listGrantSessions(ownerId: string, grantId: string): Promise<ConsultationSessionRecord[]>;
    getSessionAudit(ownerId: string, sessionId: string): Promise<Record<string, unknown>>;
    startSession(rawToken: string, client: ConsultationClientDescriptor): Promise<ConsultationStartResult>;
    closeSession(sessionId: string, reason: ConsultationCloseReason): Promise<void>;
    expireOpenSessions(): Promise<Array<{
        sessionId: string;
        reason: ConsultationCloseReason;
    }>>;
    reserveTurn(sessionId: string, messageId: string, prompt: string): Promise<ReserveTurnResult>;
    finalizeDenied(sessionId: string, messageId: string, matchedRuleIds: string[], event: Record<string, unknown>): Promise<{
        closeReason?: ConsultationCloseReason;
    }>;
    finalizeAllowed(sessionId: string, messageId: string, matchedRuleIds: string[], event: Record<string, unknown>, adapterCallId: string): Promise<{
        closeReason?: ConsultationCloseReason;
    }>;
    finalizeError(sessionId: string, messageId: string, event: Record<string, unknown>): Promise<{
        closeReason?: ConsultationCloseReason;
    }>;
    canDeliverToSession(sessionId: string): Promise<{
        allowed: boolean;
        reason?: ConsultationCloseReason;
    }>;
    getStoreSnapshot(): Promise<ConsultationStoredState>;
    private finalizeTurn;
    private validateClientAgainstGrant;
    private determineGrantCloseReason;
    private closeSessionRecord;
    private requireOwner;
    private requirePolicy;
    private requireGrant;
    private syncGrantStatus;
    private load;
    private persist;
    private recordAudit;
    private emitClose;
    private withMutation;
}
export declare function buildSessionStartedPayload(start: ConsultationStartResult): Record<string, unknown>;
export {};
