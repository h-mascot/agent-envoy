import assert from "node:assert/strict";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";

import plugin from "../src/index.js";

interface RegisteredRoute {
  path: string;
  match?: "exact" | "prefix";
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void;
  handleUpgrade?: (req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => Promise<boolean | void> | boolean | void;
}

interface RegisteredService {
  id: string;
  start?: () => Promise<void> | void;
  stop?: () => Promise<void> | void;
}

function routeMatches(route: RegisteredRoute, pathname: string): boolean {
  if (route.match === "prefix") {
    return pathname === route.path || pathname.startsWith(`${route.path}/`);
  }
  return pathname === route.path;
}

export function registerPlugin(config: Record<string, unknown>) {
  const routes: RegisteredRoute[] = [];
  const services: RegisteredService[] = [];

  plugin.register({
    id: "openclaw-agent-consultation-access",
    name: "Agent Consultation Access",
    source: "test",
    registrationMode: "runtime",
    config: { gateway: { port: 19001 } } as any,
    pluginConfig: config,
    runtime: {} as any,
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
      trace() {},
    },
    session: {} as any,
    agent: {} as any,
    runContext: {} as any,
    lifecycle: {} as any,
    registerTool() {},
    registerHook() {},
    registerHostedMediaResolver() {},
    registerChannel() {},
    registerGatewayMethod() {},
    registerCli() {},
    registerNodeCliFeature() {},
    registerReload() {},
    registerNodeHostCommand() {},
    registerNodeInvokePolicy() {},
    registerSecurityAuditCollector() {},
    registerGatewayDiscoveryService() {},
    registerCliBackend() {},
    registerTextTransforms() {},
    registerConfigMigration() {},
    registerMigrationProvider() {},
    registerAutoEnableProbe() {},
    registerProvider() {},
    registerModelCatalogProvider() {},
    registerSpeechProvider() {},
    registerRealtimeTranscriptionProvider() {},
    registerRealtimeVoiceProvider() {},
    registerMediaUnderstandingProvider() {},
    registerImageGenerationProvider() {},
    registerVideoGenerationProvider() {},
    registerMusicGenerationProvider() {},
    registerWebFetchProvider() {},
    registerWebSearchProvider() {},
    registerInteractiveHandler() {},
    onConversationBindingResolved() {},
    registerCommand() {},
    registerContextEngine() {},
    registerCompactionProvider() {},
    registerAgentHarness() {},
    registerCodexAppServerExtensionFactory() {},
    registerAgentToolResultMiddleware() {},
    registerSessionExtension() {},
    registerHttpRoute(route: RegisteredRoute) {
      routes.push(route);
    },
    registerService(service: RegisteredService) {
      services.push(service);
    },
  } as any);

  return { routes, services };
}

export async function startRegisteredServer(config: Record<string, unknown>) {
  const { routes, services } = registerPlugin(config);
  assert(routes.length > 0, "expected plugin routes to be registered");
  assert(services.length > 0, "expected plugin service to be registered");

  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`).pathname;
    for (const route of routes) {
      if (!routeMatches(route, pathname)) {
        continue;
      }
      const handled = await route.handler(req, res);
      if (handled !== false || res.writableEnded) {
        return;
      }
    }
    res.statusCode = 404;
    res.end("Not found");
  });

  server.on("upgrade", async (req, socket, head) => {
    const pathname = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`).pathname;
    for (const route of routes) {
      if (!route.handleUpgrade || !routeMatches(route, pathname)) {
        continue;
      }
      const handled = await route.handleUpgrade(req, socket, head);
      if (handled !== false) {
        return;
      }
    }
    socket.destroy();
  });

  for (const service of services) {
    await service.start?.();
  }

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as import("node:net").AddressInfo).port;

  return {
    port,
    routes,
    services,
    async close() {
      for (const service of services.slice().reverse()) {
        await service.stop?.();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
