import type { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import { type ConsultationAgentAdapter } from "./consultation-adapter.js";
import { ConsultationStore } from "./consultation-store.js";
import { type ConsultationConfig } from "./consultation-types.js";
export interface LoggerLike {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
export declare class ConsultationGatewayRuntime {
    private readonly config;
    private readonly logger;
    readonly store: ConsultationStore;
    readonly adapter: ConsultationAgentAdapter;
    private readonly wsServer;
    private readonly sockets;
    private readonly socketState;
    private readonly abortControllers;
    private expiryTimer;
    private detachCloseListener;
    private started;
    constructor(config: ConsultationConfig, logger: LoggerLike, adapter?: ConsultationAgentAdapter);
    start(): void;
    stop(): Promise<void>;
    handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
    handleWebSocketHttpRequest(_req: IncomingMessage, res: ServerResponse): boolean;
    handleWebSocketUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
    private buildGrantWsUrl;
    private handleSocket;
    private handleSocketMessage;
    private handleReservation;
    private handleSessionStart;
    private closeSessionSocket;
    private sendAndClose;
    private sendEvent;
}
