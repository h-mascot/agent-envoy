import { setTimeout as delay } from "node:timers/promises";

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

export class FakeConsultationAgentAdapter implements ConsultationAgentAdapter {
  readonly invocations: ConsultationAdapterRequest[] = [];
  readonly abortedMessageIds: string[] = [];

  constructor(private readonly options?: { delayMs?: number }) {}

  async consult(request: ConsultationAdapterRequest, signal: AbortSignal): Promise<ConsultationAdapterResult> {
    this.invocations.push({ ...request });
    const adapterCallId = `adapter_${this.invocations.length}`;

    if (this.options?.delayMs) {
      try {
        await delay(this.options.delayMs, undefined, { signal });
      } catch (error) {
        this.abortedMessageIds.push(request.messageId);
        throw error;
      }
    } else if (signal.aborted) {
      this.abortedMessageIds.push(request.messageId);
      throw signal.reason;
    }

    const text = request.responseFormat === "json_object"
      ? JSON.stringify({
          target_agent_id: request.targetAgentId,
          answer: `Fake consultation reply for: ${request.prompt}`,
        })
      : `Fake consultation reply for: ${request.prompt}`;

    return {
      adapterCallId,
      text,
    };
  }
}
