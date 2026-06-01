export { consultationPluginConfigSchema, parseConsultationConfig } from "./config.js";
export { FakeConsultationAgentAdapter, type ConsultationAgentAdapter } from "./consultation-adapter.js";
export { ConsultationGatewayRuntime, type LoggerLike } from "./gateway-runtime.js";
export * from "./consultation-types.js";
declare const _default: {
    id: string;
    name: string;
    description: string;
    configSchema: import("openclaw/plugin-sdk/plugin-entry").OpenClawPluginConfigSchema;
    register: NonNullable<import("openclaw/plugin-sdk/plugin-entry").OpenClawPluginDefinition["register"]>;
} & Pick<import("openclaw/plugin-sdk/plugin-entry").OpenClawPluginDefinition, "kind" | "reload" | "nodeHostCommands" | "securityAuditCollectors">;
export default _default;
