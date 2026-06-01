import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("plugin package metadata", () => {
  it("ships the required OpenClaw manifest and package metadata", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")) as any;
    const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "openclaw.plugin.json"), "utf8")) as any;

    assert.equal(pkg.type, "module");
    assert.equal(pkg.openclaw.plugin, "./openclaw.plugin.json");
    assert.deepEqual(pkg.openclaw.extensions, ["./dist/index.js"]);
    assert.ok(pkg.openclaw.compat?.pluginApi);
    assert.ok(pkg.openclaw.build?.openclawVersion);
    assert.ok(pkg.openclaw.build?.pluginSdkVersion);

    assert.equal(manifest.id, "openclaw-agent-consultation-access");
    assert.equal(manifest.activation?.onStartup, true);
    assert.equal(typeof manifest.configSchema, "object");
    assert.equal(manifest.configSchema.properties.networkMode.default, "private");
    assert.deepEqual(
      manifest.configSchema.properties.networkMode.enum,
      ["private", "tailscale-private-admin-public-session"],
    );
    assert.equal(typeof manifest.configSchema.properties.internalBaseUrl, "object");
    assert.equal(typeof manifest.configSchema.properties.publicBaseUrl, "object");
    assert.equal(typeof manifest.configSchema.properties.publicWsUrl, "object");
  });
});
