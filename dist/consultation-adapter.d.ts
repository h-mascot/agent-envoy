export interface ConsultationAdapterRequest {
    targetAgentId: string;
    prompt: string;
    responseFormat: "text" | "json_object";
    sessionId: string;
    messageId: string;
}
export interface ConsultationAdapterResult {
    adapterCallId: string;
    text: string;
}
export interface ConsultationAgentAdapter {
    consult(request: ConsultationAdapterRequest, signal: AbortSignal): Promise<ConsultationAdapterResult>;
}
export declare class FakeConsultationAgentAdapter implements ConsultationAgentAdapter {
    private readonly options?;
    readonly invocations: ConsultationAdapterRequest[];
    readonly abortedMessageIds: string[];
    constructor(options?: {
        delayMs?: number;
    } | undefined);
    consult(request: ConsultationAdapterRequest, signal: AbortSignal): Promise<ConsultationAdapterResult>;
}
