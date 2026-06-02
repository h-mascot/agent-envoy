import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileConsultationPolicy, evaluateConsultationPolicy } from "../src/consultation-policy.js";

describe("consultation policy compiler", () => {
  it("compiles template policies and dry-runs denied prompts deterministically", () => {
    const policy = compileConsultationPolicy("owner-1", "pol_test", {
      name: "Read only research",
      template: "read-only-research",
    }, "2026-06-01T00:00:00.000Z");

    const denied = evaluateConsultationPolicy(policy, "Please buy this market for me");
    assert.equal(denied.decision, "deny");
    assert.equal(denied.would_reach_agent, false);
    assert.ok(denied.matched_rules.some((rule) => rule.id === "deny-actions"));

    const allowed = evaluateConsultationPolicy(policy, "Summarize the public market context");
    assert.equal(allowed.decision, "allow");
    assert.equal(allowed.would_reach_agent, true);
  });

  it("rejects invalid regex and impossible deny-by-default policies", () => {
    assert.throws(() => {
      compileConsultationPolicy("owner-1", "pol_bad", {
        name: "Broken regex",
        rules: [{ effect: "deny", type: "regex", pattern: "(" }],
      }, new Date().toISOString());
    }, /Invalid regex/);

    assert.throws(() => {
      compileConsultationPolicy("owner-1", "pol_impossible", {
        name: "Impossible",
        default_action: "deny",
        rules: [{ effect: "deny", type: "contains_any", values: ["secret"] }],
      }, new Date().toISOString());
    }, /require at least one allow rule/);
  });
});
