import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseConsultationConfig } from "../src/config.js";

describe("consultation config", () => {
  it("defaults to private networking with no public overrides", () => {
    const config = parseConsultationConfig({
      owners: [{ id: "owner-1", token: "owner-token-1", agentIds: ["agent-owner-1"] }],
    });

    assert.equal(config.networkMode, "private");
    assert.equal(config.internalBaseUrl, undefined);
    assert.equal(config.publicBaseUrl, undefined);
    assert.equal(config.publicWsUrl, undefined);
  });

  it("rejects an invalid publicBaseUrl", () => {
    assert.throws(
      () => parseConsultationConfig({ publicBaseUrl: "consult.superada.ai" }),
      /publicBaseUrl must be a valid URL/,
    );
  });

  it("rejects an invalid publicWsUrl", () => {
    assert.throws(
      () => parseConsultationConfig({ publicWsUrl: "https://consult.superada.ai/v1/consultations" }),
      /publicWsUrl must use ws or wss/,
    );
  });
});
