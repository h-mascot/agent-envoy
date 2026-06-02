import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packageJsonPath = path.join(root, "package.json");
const manifestPath = path.join(root, "openclaw.plugin.json");
const distEntryPath = path.join(root, "dist", "index.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

assert(fs.existsSync(distEntryPath), "Missing built runtime entry at dist/index.js");
assert(pkg.type === "module", "package.json must set type=module");
assert(pkg.openclaw && typeof pkg.openclaw === "object", "package.json must include openclaw metadata");
assert(Array.isArray(pkg.openclaw.extensions) && pkg.openclaw.extensions.includes("./dist/index.js"), "package.json must include openclaw.extensions with ./dist/index.js");
assert(pkg.openclaw.plugin === "./openclaw.plugin.json", "package.json must set openclaw.plugin to ./openclaw.plugin.json");
assert(pkg.openclaw.compat && pkg.openclaw.compat.pluginApi, "package.json must include openclaw.compat.pluginApi");
assert(pkg.openclaw.build && pkg.openclaw.build.openclawVersion, "package.json must include openclaw.build.openclawVersion");
assert(pkg.openclaw.build && pkg.openclaw.build.pluginSdkVersion, "package.json must include openclaw.build.pluginSdkVersion");
assert(manifest && typeof manifest === "object", "openclaw.plugin.json must be valid JSON");
assert(manifest.id === "agent-envoy", "openclaw.plugin.json must declare the expected plugin id");
assert(manifest.activation && manifest.activation.onStartup === true, "openclaw.plugin.json must enable activation.onStartup");
assert(manifest.configSchema && typeof manifest.configSchema === "object", "openclaw.plugin.json must include a configSchema");

console.log("Plugin package sanity checks passed.");
