import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { consultationPluginConfigSchema, parseConsultationConfig } from "./config.js";
import { ConsultationGatewayRuntime } from "./gateway-runtime.js";
export { consultationPluginConfigSchema, parseConsultationConfig } from "./config.js";
export { FakeConsultationAgentAdapter } from "./consultation-adapter.js";
export { ConsultationGatewayRuntime } from "./gateway-runtime.js";
export * from "./consultation-types.js";
export default definePluginEntry({
    id: "openclaw-agent-consultation-access",
    name: "Agent Consultation Access",
    description: "Owner-controlled consultation policies, grants, audit, and WebSocket sessions for OpenClaw agents.",
    configSchema: consultationPluginConfigSchema,
    register(api) {
        const config = parseConsultationConfig(api.pluginConfig);
        if (!config.enabled) {
            api.logger.info("agent-consultation-access: plugin disabled by config");
            return;
        }
        const runtime = new ConsultationGatewayRuntime(config, api.logger);
        api.registerHttpRoute({
            path: config.apiBasePath,
            auth: "plugin",
            match: "prefix",
            replaceExisting: true,
            handler: (req, res) => runtime.handleApiRequest(req, res),
        });
        api.registerHttpRoute({
            path: config.wsPath,
            auth: "plugin",
            match: "exact",
            replaceExisting: true,
            handler: (req, res) => runtime.handleWebSocketHttpRequest(req, res),
            handleUpgrade: (req, socket, head) => runtime.handleWebSocketUpgrade(req, socket, head),
        });
        api.registerService({
            id: "agent-consultation-access",
            start: async () => {
                runtime.start();
            },
            stop: async () => {
                await runtime.stop();
            },
        });
    },
});
