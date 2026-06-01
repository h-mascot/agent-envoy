import { setTimeout as delay } from "node:timers/promises";
export class FakeConsultationAgentAdapter {
    options;
    invocations = [];
    abortedMessageIds = [];
    constructor(options) {
        this.options = options;
    }
    async consult(request, signal) {
        this.invocations.push({ ...request });
        const adapterCallId = `adapter_${this.invocations.length}`;
        if (this.options?.delayMs) {
            try {
                await delay(this.options.delayMs, undefined, { signal });
            }
            catch (error) {
                this.abortedMessageIds.push(request.messageId);
                throw error;
            }
        }
        else if (signal.aborted) {
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
