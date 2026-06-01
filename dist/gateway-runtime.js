import { randomBytes } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { FakeConsultationAgentAdapter } from "./consultation-adapter.js";
import { evaluateConsultationPolicy } from "./consultation-policy.js";
import { buildSessionStartedPayload, ConsultationStore } from "./consultation-store.js";
import { CONSULTATION_AGENT_UNAVAILABLE_MESSAGE, CONSULTATION_EXPIRED_MESSAGE, CONSULTATION_GENERIC_DENY_MESSAGE, CONSULTATION_LIMIT_MESSAGE, CONSULTATION_PROTOCOL_VERSION, CONSULTATION_REVOKED_MESSAGE, CONSULTATION_UNAVAILABLE_MESSAGE, } from "./consultation-types.js";
function asObject(value) {
    return value && typeof value === "object" ? value : {};
}
function asString(value) {
    return typeof value === "string" ? value : "";
}
function bearerToken(req) {
    const header = req.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    return value?.startsWith("Bearer ") ? value.slice(7) : undefined;
}
function requestUrl(req) {
    return new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
}
function wsUrlFromBaseUrl(baseUrl, wsPath) {
    const url = new URL(wsPath, baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
}
function makeReceiptId() {
    return `rcpt_${randomBytes(8).toString("hex")}`;
}
function closeMessageForReason(reason) {
    switch (reason) {
        case "grant_expired":
            return CONSULTATION_EXPIRED_MESSAGE;
        case "grant_revoked":
            return CONSULTATION_REVOKED_MESSAGE;
        case "limit_exceeded":
            return CONSULTATION_LIMIT_MESSAGE;
        case "auth_failed":
            return CONSULTATION_UNAVAILABLE_MESSAGE;
        case "agent_unavailable":
            return CONSULTATION_AGENT_UNAVAILABLE_MESSAGE;
        default:
            return undefined;
    }
}
async function readJsonBody(req, maxBytes = 1_000_000) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > maxBytes) {
            throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
        }
        chunks.push(buffer);
    }
    if (chunks.length === 0) {
        return {};
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    catch {
        throw Object.assign(new Error("Invalid JSON body"), { statusCode: 400 });
    }
}
function writeJson(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
}
function writeText(res, statusCode, message) {
    res.statusCode = statusCode;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(message);
}
function assertOwnerId(ownerId) {
    if (!ownerId) {
        throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    }
    return ownerId;
}
export class ConsultationGatewayRuntime {
    config;
    logger;
    store;
    adapter;
    wsServer = new WebSocketServer({ noServer: true });
    sockets = new Map();
    socketState = new WeakMap();
    abortControllers = new Map();
    expiryTimer = null;
    detachCloseListener = null;
    started = false;
    constructor(config, logger, adapter) {
        this.config = config;
        this.logger = logger;
        this.store = new ConsultationStore(config);
        this.adapter = adapter || new FakeConsultationAgentAdapter();
        this.detachCloseListener = this.store.onSessionClosed((sessionId, reason) => {
            void this.closeSessionSocket(sessionId, reason);
        });
        this.wsServer.on("connection", (socket) => this.handleSocket(socket));
    }
    start() {
        if (this.started || !this.config.enabled) {
            return;
        }
        this.started = true;
        this.expiryTimer = setInterval(() => {
            void this.store.expireOpenSessions().then((closed) => {
                for (const entry of closed) {
                    void this.closeSessionSocket(entry.sessionId, entry.reason);
                }
            }).catch((error) => {
                this.logger.warn(`consultation: expiry check failed: ${error instanceof Error ? error.message : String(error)}`);
            });
        }, 500);
    }
    async stop() {
        this.started = false;
        if (this.expiryTimer) {
            clearInterval(this.expiryTimer);
            this.expiryTimer = null;
        }
        this.detachCloseListener?.();
        this.detachCloseListener = null;
        for (const [sessionId] of this.sockets) {
            await this.closeSessionSocket(sessionId, "server_shutdown");
        }
        await new Promise((resolve) => this.wsServer.close(() => resolve()));
    }
    async handleApiRequest(req, res) {
        if (!this.config.enabled) {
            writeJson(res, 404, { error: "Not found" });
            return true;
        }
        const url = requestUrl(req);
        const relative = url.pathname.slice(this.config.apiBasePath.length);
        const segments = relative.split("/").filter(Boolean);
        const ownerId = this.store.resolveOwnerToken(bearerToken(req))?.id;
        try {
            if (req.method === "POST" && segments.length === 1 && segments[0] === "policies") {
                const body = asObject(await readJsonBody(req));
                const policy = await this.store.createPolicy(assertOwnerId(ownerId), body);
                writeJson(res, 201, {
                    policy_id: policy.id,
                    compiled_version: policy.compiled_version,
                    summary: {
                        default_action: policy.default_action,
                        rules_count: policy.rules.length,
                        requester_message: policy.requester_message,
                    },
                });
                return true;
            }
            if (req.method === "POST" && segments.length === 3 && segments[0] === "policies" && segments[2] === "dry-run") {
                const body = asObject(await readJsonBody(req));
                const result = await this.store.dryRunPolicy(assertOwnerId(ownerId), segments[1], asString(body.prompt), body.client);
                writeJson(res, 200, {
                    decision: result.decision,
                    would_reach_agent: result.would_reach_agent,
                    matched_rules: result.matched_rules.map((rule) => rule.id),
                    requester_message: result.requester_message,
                });
                return true;
            }
            if (req.method === "POST" && segments.length === 1 && segments[0] === "grants") {
                const body = asObject(await readJsonBody(req));
                const grant = await this.store.createGrant(assertOwnerId(ownerId), body, this.buildGrantWsUrl(req));
                writeJson(res, 201, grant);
                return true;
            }
            if (req.method === "POST" && segments.length === 3 && segments[0] === "grants" && segments[2] === "revoke") {
                const body = asObject(await readJsonBody(req));
                await this.store.revokeGrant(assertOwnerId(ownerId), segments[1], asString(body.reason) || "owner_revoked");
                writeJson(res, 200, { grant_id: segments[1], revoked: true });
                return true;
            }
            if (req.method === "GET" && segments.length === 3 && segments[0] === "grants" && segments[2] === "sessions") {
                const sessions = await this.store.listGrantSessions(assertOwnerId(ownerId), segments[1]);
                writeJson(res, 200, { sessions });
                return true;
            }
            if (req.method === "GET" && segments.length === 3 && segments[0] === "sessions" && segments[2] === "audit") {
                const audit = await this.store.getSessionAudit(assertOwnerId(ownerId), segments[1]);
                writeJson(res, 200, audit);
                return true;
            }
            writeJson(res, 404, { error: "Not found" });
            return true;
        }
        catch (error) {
            const statusCode = typeof error?.statusCode === "number"
                ? error.statusCode
                : 400;
            writeJson(res, statusCode, {
                error: error instanceof Error ? error.message : String(error),
            });
            return true;
        }
    }
    handleWebSocketHttpRequest(_req, res) {
        writeText(res, 426, "Upgrade Required");
        return true;
    }
    handleWebSocketUpgrade(req, socket, head) {
        this.wsServer.handleUpgrade(req, socket, head, (ws) => {
            this.wsServer.emit("connection", ws, req);
        });
        return true;
    }
    buildGrantWsUrl(req) {
        if (this.config.publicWsUrl) {
            return this.config.publicWsUrl;
        }
        if (this.config.publicBaseUrl) {
            return wsUrlFromBaseUrl(this.config.publicBaseUrl, this.config.wsPath);
        }
        const protoHeader = req.headers["x-forwarded-proto"];
        const proto = typeof protoHeader === "string"
            ? (protoHeader.includes("https") ? "wss" : "ws")
            : req.socket.encrypted ? "wss" : "ws";
        return `${proto}://${req.headers.host || "127.0.0.1"}${this.config.wsPath}`;
    }
    handleSocket(socket) {
        const state = {
            authenticated: false,
            responseFormat: "text",
            authTimer: setTimeout(() => {
                void this.sendAndClose(socket, { protocol_version: CONSULTATION_PROTOCOL_VERSION, type: "session.closed", reason: "auth_timeout" }, "auth_timeout");
            }, this.config.authTimeoutMs),
        };
        this.socketState.set(socket, state);
        socket.on("message", (raw) => {
            void this.handleSocketMessage(socket, raw.toString());
        });
        socket.on("close", () => {
            const current = this.socketState.get(socket);
            if (current?.authTimer) {
                clearTimeout(current.authTimer);
            }
            if (current?.sessionId) {
                this.sockets.delete(current.sessionId);
                const controllers = this.abortControllers.get(current.sessionId);
                if (controllers) {
                    for (const controller of controllers) {
                        controller.abort("socket_closed");
                    }
                    this.abortControllers.delete(current.sessionId);
                }
                void this.store.closeSession(current.sessionId, "server_shutdown");
            }
        });
    }
    async handleSocketMessage(socket, raw) {
        let frame;
        try {
            frame = JSON.parse(raw);
        }
        catch {
            await this.sendAndClose(socket, { protocol_version: CONSULTATION_PROTOCOL_VERSION, type: "session.closed", reason: "protocol_error" }, "protocol_error");
            return;
        }
        const state = this.socketState.get(socket);
        if (!state) {
            return;
        }
        if (!state.authenticated) {
            await this.handleSessionStart(socket, state, frame);
            return;
        }
        if (asString(frame.protocol_version) !== this.config.protocolVersion) {
            await this.sendAndClose(socket, { protocol_version: CONSULTATION_PROTOCOL_VERSION, type: "session.closed", reason: "protocol_error" }, "protocol_error");
            return;
        }
        if (asString(frame.type) !== "consultation.send") {
            await this.sendEvent(socket, {
                protocol_version: this.config.protocolVersion,
                type: "consultation.error",
                message: "Unsupported event type",
            });
            return;
        }
        const messageId = asString(frame.message_id);
        const content = asObject(frame.content);
        const prompt = asString(content.text);
        const reservation = await this.store.reserveTurn(state.sessionId, messageId, prompt);
        if (await this.handleReservation(socket, reservation, messageId, state.sessionId)) {
            return;
        }
        const reserved = reservation;
        if (reserved.max_prompt_chars && prompt.length > reserved.max_prompt_chars) {
            const event = {
                protocol_version: this.config.protocolVersion,
                type: "policy.denied",
                message_id: messageId,
                correlation_id: `corr_${messageId}`,
                receipt_id: makeReceiptId(),
                policy_decision: "deny",
                turn_index: reserved.turn_index,
                remaining_turns: reserved.remaining_turns,
                message: CONSULTATION_GENERIC_DENY_MESSAGE,
            };
            const finalized = await this.store.finalizeDenied(state.sessionId, messageId, ["grant-max-prompt-chars"], event);
            await this.sendEvent(socket, event);
            if (finalized.closeReason) {
                await this.sendAndClose(socket, { protocol_version: this.config.protocolVersion, type: "session.closed", reason: finalized.closeReason }, finalized.closeReason);
            }
            return;
        }
        let decision;
        try {
            decision = evaluateConsultationPolicy(reserved.policy, prompt, reserved.session.client_metadata_json);
        }
        catch {
            const event = {
                protocol_version: this.config.protocolVersion,
                type: "consultation.error",
                message_id: messageId,
                correlation_id: `corr_${messageId}`,
                receipt_id: makeReceiptId(),
                policy_decision: "error",
                turn_index: reserved.turn_index,
                remaining_turns: reserved.remaining_turns,
                message: "Policy evaluation failed closed.",
            };
            await this.store.finalizeError(state.sessionId, messageId, event);
            await this.sendAndClose(socket, { protocol_version: this.config.protocolVersion, type: "session.closed", reason: "policy_error" }, "policy_error");
            return;
        }
        const receiptId = makeReceiptId();
        const correlationId = `corr_${messageId}`;
        if (decision.decision === "deny") {
            const event = {
                protocol_version: this.config.protocolVersion,
                type: "policy.denied",
                message_id: messageId,
                correlation_id: correlationId,
                receipt_id: receiptId,
                policy_decision: "deny",
                turn_index: reserved.turn_index,
                remaining_turns: reserved.remaining_turns,
                message: decision.requester_message,
            };
            const finalized = await this.store.finalizeDenied(state.sessionId, messageId, decision.matched_rules.map((rule) => rule.id), event);
            await this.sendEvent(socket, event);
            if (finalized.closeReason) {
                await this.sendAndClose(socket, { protocol_version: this.config.protocolVersion, type: "session.closed", reason: finalized.closeReason }, finalized.closeReason);
            }
            return;
        }
        const controller = new AbortController();
        if (!this.abortControllers.has(state.sessionId)) {
            this.abortControllers.set(state.sessionId, new Set());
        }
        this.abortControllers.get(state.sessionId).add(controller);
        try {
            const result = await this.adapter.consult({
                targetAgentId: reserved.grant.target_agent_id,
                prompt,
                responseFormat: state.responseFormat,
                sessionId: state.sessionId,
                messageId,
            }, controller.signal);
            const deliverable = await this.store.canDeliverToSession(state.sessionId);
            if (!deliverable.allowed) {
                await this.store.finalizeError(state.sessionId, messageId, {
                    protocol_version: this.config.protocolVersion,
                    type: "consultation.error",
                    message_id: messageId,
                    correlation_id: correlationId,
                    receipt_id: receiptId,
                    policy_decision: "error",
                    turn_index: reserved.turn_index,
                    remaining_turns: reserved.remaining_turns,
                    message: closeMessageForReason(deliverable.reason || "agent_unavailable") || CONSULTATION_UNAVAILABLE_MESSAGE,
                });
                await this.sendAndClose(socket, { protocol_version: this.config.protocolVersion, type: "session.closed", reason: deliverable.reason || "agent_unavailable" }, deliverable.reason || "agent_unavailable");
                return;
            }
            const event = {
                protocol_version: this.config.protocolVersion,
                type: "agent.final",
                message_id: messageId,
                correlation_id: correlationId,
                receipt_id: receiptId,
                policy_decision: "allow",
                turn_index: reserved.turn_index,
                remaining_turns: reserved.remaining_turns,
                text: result.text,
            };
            const finalized = await this.store.finalizeAllowed(state.sessionId, messageId, decision.matched_rules.map((rule) => rule.id), event, result.adapterCallId);
            await this.sendEvent(socket, event);
            if (finalized.closeReason) {
                await this.sendAndClose(socket, { protocol_version: this.config.protocolVersion, type: "session.closed", reason: finalized.closeReason }, finalized.closeReason);
            }
        }
        catch {
            const event = {
                protocol_version: this.config.protocolVersion,
                type: "consultation.error",
                message_id: messageId,
                correlation_id: correlationId,
                receipt_id: receiptId,
                policy_decision: "error",
                turn_index: reserved.turn_index,
                remaining_turns: reserved.remaining_turns,
                message: CONSULTATION_AGENT_UNAVAILABLE_MESSAGE,
            };
            await this.store.finalizeError(state.sessionId, messageId, event);
            await this.sendAndClose(socket, { protocol_version: this.config.protocolVersion, type: "session.closed", reason: "agent_unavailable" }, "agent_unavailable");
        }
        finally {
            this.abortControllers.get(state.sessionId)?.delete(controller);
        }
    }
    async handleReservation(socket, reservation, messageId, sessionId) {
        if (!("kind" in reservation)) {
            return false;
        }
        if (reservation.kind === "duplicate") {
            await this.sendEvent(socket, reservation.event);
            return true;
        }
        if (reservation.kind === "duplicate_in_flight") {
            await this.sendEvent(socket, {
                protocol_version: this.config.protocolVersion,
                type: "consultation.error",
                message_id: messageId,
                message: "Duplicate message_id is already in flight.",
            });
            return true;
        }
        if (reservation.reason === "invalid_message") {
            await this.sendEvent(socket, {
                protocol_version: this.config.protocolVersion,
                type: "consultation.error",
                message_id: messageId,
                message: reservation.message,
            });
            return true;
        }
        await this.sendAndClose(socket, {
            protocol_version: this.config.protocolVersion,
            type: "session.closed",
            reason: reservation.reason,
            message: reservation.message,
        }, reservation.reason);
        await this.store.closeSession(sessionId, reservation.reason);
        return true;
    }
    async handleSessionStart(socket, state, frame) {
        if (asString(frame.protocol_version) !== this.config.protocolVersion || asString(frame.type) !== "session.start") {
            await this.sendAndClose(socket, { protocol_version: CONSULTATION_PROTOCOL_VERSION, type: "session.closed", reason: "protocol_error" }, "protocol_error");
            return;
        }
        const client = asObject(frame.client);
        const token = asString(frame.grant_token);
        try {
            const started = await this.store.startSession(token, client);
            state.authenticated = true;
            state.sessionId = started.session.id;
            state.responseFormat = client.response_format || "text";
            if (state.authTimer) {
                clearTimeout(state.authTimer);
            }
            this.sockets.set(started.session.id, socket);
            await this.sendEvent(socket, buildSessionStartedPayload(started));
        }
        catch (error) {
            const reason = error.closeReason || "auth_failed";
            await this.sendAndClose(socket, {
                protocol_version: CONSULTATION_PROTOCOL_VERSION,
                type: "session.closed",
                reason,
                message: reason === "protocol_error" && error instanceof Error ? error.message : undefined,
            }, reason);
        }
    }
    async closeSessionSocket(sessionId, reason) {
        const socket = this.sockets.get(sessionId);
        if (!socket) {
            return;
        }
        const controllers = this.abortControllers.get(sessionId);
        if (controllers) {
            for (const controller of controllers) {
                controller.abort(reason);
            }
            this.abortControllers.delete(sessionId);
        }
        await this.sendAndClose(socket, { protocol_version: this.config.protocolVersion, type: "session.closed", reason }, reason);
    }
    async sendAndClose(socket, event, reason) {
        try {
            await this.sendEvent(socket, event);
        }
        finally {
            const state = this.socketState.get(socket);
            if (state?.sessionId) {
                this.sockets.delete(state.sessionId);
                await this.store.closeSession(state.sessionId, reason);
            }
            socket.close();
        }
    }
    async sendEvent(socket, event) {
        if (socket.readyState !== WebSocket.OPEN) {
            return;
        }
        await new Promise((resolve, reject) => {
            socket.send(JSON.stringify(event), (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }
}
