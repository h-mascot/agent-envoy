import { type ConsultationConfig } from "./consultation-types.js";
export declare const consultationPluginConfigSchema: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly enabled: {
            readonly type: "boolean";
            readonly default: true;
        };
        readonly networkMode: {
            readonly type: "string";
            readonly enum: readonly ["private", "tailscale-private-admin-public-session"];
            readonly default: "private";
        };
        readonly apiBasePath: {
            readonly type: "string";
            readonly default: "/v1/consultation";
        };
        readonly wsPath: {
            readonly type: "string";
            readonly default: "/v1/consultations";
        };
        readonly internalBaseUrl: {
            readonly type: "string";
            readonly description: "Optional private/admin base URL metadata, for example the Tailscale-only admin endpoint.";
        };
        readonly publicBaseUrl: {
            readonly type: "string";
            readonly description: "Optional public HTTP(S) base URL used to derive the requester WebSocket URL.";
        };
        readonly publicWsUrl: {
            readonly type: "string";
            readonly description: "Optional explicit public WS(S) URL override for requester consultation sessions.";
        };
        readonly protocolVersion: {
            readonly type: "string";
            readonly default: "2026-05-31";
        };
        readonly authTimeoutMs: {
            readonly type: "integer";
            readonly minimum: 100;
            readonly default: 5000;
        };
        readonly maxGrantTtlSeconds: {
            readonly type: "integer";
            readonly minimum: 1;
            readonly default: 7200;
        };
        readonly maxGrantTurns: {
            readonly type: "integer";
            readonly minimum: 1;
            readonly default: 10;
        };
        readonly maxSessionsPerGrant: {
            readonly type: "integer";
            readonly minimum: 1;
            readonly default: 2;
        };
        readonly auditFailClosed: {
            readonly type: "boolean";
            readonly default: false;
        };
        readonly storePath: {
            readonly type: "string";
        };
        readonly owners: {
            readonly type: "array";
            readonly default: readonly [];
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly required: readonly ["id", "token", "agentIds"];
                readonly properties: {
                    readonly id: {
                        readonly type: "string";
                    };
                    readonly token: {
                        readonly type: "string";
                    };
                    readonly agentIds: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                };
            };
        };
    };
};
export declare function parseConsultationConfig(raw: unknown): ConsultationConfig;
