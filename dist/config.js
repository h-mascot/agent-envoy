import os from "node:os";
import path from "node:path";
import { CONSULTATION_PROTOCOL_VERSION, } from "./consultation-types.js";
function asObject(value) {
    return value && typeof value === "object" ? value : {};
}
function asString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
}
function asBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}
function asFiniteNumber(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function normalizeHttpPath(value, fallback) {
    const trimmed = value.trim() || fallback;
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
function parseNetworkMode(value) {
    const normalized = asString(value, "private").trim() || "private";
    if (normalized === "private" || normalized === "tailscale-private-admin-public-session") {
        return normalized;
    }
    throw new Error("networkMode must be one of: private, tailscale-private-admin-public-session");
}
function parseOptionalUrl(value, fieldName, allowedProtocols) {
    const raw = asString(value).trim();
    if (!raw) {
        return undefined;
    }
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new Error(`${fieldName} must be a valid URL`);
    }
    if (!allowedProtocols.includes(url.protocol)) {
        const expected = allowedProtocols.map((protocol) => protocol.replace(":", "")).join(" or ");
        throw new Error(`${fieldName} must use ${expected}`);
    }
    return url.toString();
}
function resolveStorePath(rawPath) {
    if (!rawPath.trim()) {
        return path.join(os.homedir(), ".openclaw", "plugins", "openclaw-agent-envoy", "store.json");
    }
    if (rawPath.startsWith("~/")) {
        return path.join(os.homedir(), rawPath.slice(2));
    }
    return path.isAbsolute(rawPath) ? rawPath : path.resolve(rawPath);
}
function parseOwners(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const owners = [];
    for (const entry of value) {
        const owner = asObject(entry);
        const id = asString(owner.id).trim();
        const token = asString(owner.token).trim();
        const agentIds = Array.isArray(owner.agentIds)
            ? owner.agentIds.filter((item) => typeof item === "string" && item.trim().length > 0)
            : [];
        if (!id || !token || agentIds.length === 0) {
            continue;
        }
        owners.push({ id, token, agentIds });
    }
    return owners;
}
export const consultationPluginConfigSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        enabled: { type: "boolean", default: true },
        networkMode: {
            type: "string",
            enum: ["private", "tailscale-private-admin-public-session"],
            default: "private",
        },
        apiBasePath: { type: "string", default: "/v1/consultation" },
        wsPath: { type: "string", default: "/v1/consultations" },
        internalBaseUrl: {
            type: "string",
            description: "Optional private/admin base URL metadata, for example the Tailscale-only admin endpoint.",
        },
        publicBaseUrl: {
            type: "string",
            description: "Optional public HTTP(S) base URL used to derive the requester WebSocket URL.",
        },
        publicWsUrl: {
            type: "string",
            description: "Optional explicit public WS(S) URL override for requester consultation sessions.",
        },
        protocolVersion: { type: "string", default: CONSULTATION_PROTOCOL_VERSION },
        authTimeoutMs: { type: "integer", minimum: 100, default: 5_000 },
        maxGrantTtlSeconds: { type: "integer", minimum: 1, default: 7_200 },
        maxGrantTurns: { type: "integer", minimum: 1, default: 10 },
        maxSessionsPerGrant: { type: "integer", minimum: 1, default: 2 },
        auditFailClosed: { type: "boolean", default: false },
        storePath: { type: "string" },
        owners: {
            type: "array",
            default: [],
            items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "token", "agentIds"],
                properties: {
                    id: { type: "string" },
                    token: { type: "string" },
                    agentIds: {
                        type: "array",
                        items: { type: "string" },
                    },
                },
            },
        },
    },
};
export function parseConsultationConfig(raw) {
    const config = asObject(raw);
    return {
        enabled: asBoolean(config.enabled, true),
        networkMode: parseNetworkMode(config.networkMode),
        apiBasePath: normalizeHttpPath(asString(config.apiBasePath), "/v1/consultation"),
        wsPath: normalizeHttpPath(asString(config.wsPath), "/v1/consultations"),
        internalBaseUrl: parseOptionalUrl(config.internalBaseUrl, "internalBaseUrl", ["http:", "https:"]),
        publicBaseUrl: parseOptionalUrl(config.publicBaseUrl, "publicBaseUrl", ["http:", "https:"]),
        publicWsUrl: parseOptionalUrl(config.publicWsUrl, "publicWsUrl", ["ws:", "wss:"]),
        protocolVersion: asString(config.protocolVersion, CONSULTATION_PROTOCOL_VERSION),
        authTimeoutMs: Math.max(100, Math.floor(asFiniteNumber(config.authTimeoutMs, 5_000))),
        maxGrantTtlSeconds: Math.max(1, Math.floor(asFiniteNumber(config.maxGrantTtlSeconds, 7_200))),
        maxGrantTurns: Math.max(1, Math.floor(asFiniteNumber(config.maxGrantTurns, 10))),
        maxSessionsPerGrant: Math.max(1, Math.floor(asFiniteNumber(config.maxSessionsPerGrant, 2))),
        auditFailClosed: asBoolean(config.auditFailClosed, false),
        storePath: resolveStorePath(asString(config.storePath)),
        owners: parseOwners(config.owners),
    };
}
