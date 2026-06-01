import {
  CONSULTATION_GENERIC_DENY_MESSAGE,
  type ConsultationClientDescriptor,
  type ConsultationCompiledPolicy,
  type ConsultationPolicyEvaluation,
  type ConsultationPolicyInput,
  type ConsultationRule,
  type ConsultationRuleInput,
} from "./consultation-types.js";

const POLICY_COMPILED_VERSION = 1;
const DEFAULT_MAX_PROMPT_CHARS = 4_000;

function makeRuleId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

function compilePattern(pattern: string): RegExp {
  const trimmed = pattern.trim();
  const ignoreCase = trimmed.startsWith("(?i)");
  const source = ignoreCase ? trimmed.slice(4) : trimmed;
  try {
    return new RegExp(source, ignoreCase ? "i" : undefined);
  } catch {
    throw new Error(`Invalid regex pattern: ${pattern}`);
  }
}

function normalizeRules(rules: ConsultationRuleInput[], prefix: string): ConsultationRule[] {
  return rules.map((rule, index) => {
    if (!rule.effect || !rule.type) {
      throw new Error("Each rule must include effect and type");
    }

    if (rule.type === "contains_any" && (!Array.isArray(rule.values) || rule.values.length === 0)) {
      throw new Error(`Rule ${rule.id || makeRuleId(prefix, index)} must include non-empty values`);
    }

    if (rule.type === "regex") {
      if (!rule.pattern?.trim()) {
        throw new Error(`Rule ${rule.id || makeRuleId(prefix, index)} must include a pattern`);
      }
      compilePattern(rule.pattern);
    }

    if (rule.type === "max_chars" && (!Number.isFinite(rule.value) || (rule.value || 0) <= 0)) {
      throw new Error(`Rule ${rule.id || makeRuleId(prefix, index)} must include a positive value`);
    }

    if (rule.type === "requires_client_field" && !rule.field) {
      throw new Error(`Rule ${rule.id || makeRuleId(prefix, index)} must include a field`);
    }

    return {
      ...rule,
      id: rule.id?.trim() || makeRuleId(prefix, index),
      name: rule.name?.trim() || makeRuleId(prefix, index),
    };
  });
}

function templateRules(input: ConsultationPolicyInput): {
  defaultAction: "allow" | "deny";
  rules: ConsultationRuleInput[];
} {
  const maxPromptChars = Math.min(Math.max(1, input.max_prompt_chars || DEFAULT_MAX_PROMPT_CHARS), 20_000);
  const blockedKeywords = input.blocked_keywords?.filter(Boolean) || [];
  const allowedKeywords = input.allowed_keywords?.filter(Boolean) || [];
  const secretRegex = "(?i)(api[_ -]?key|secret|password|token|system prompt|private memory|credential)";
  const actionRegex = "(?i)(buy|sell|trade|place a bet|send message|execute|run shell|tool|browser|purchase|delete|modify|write file)";

  switch (input.template) {
    case "general-safe-consult":
      return {
        defaultAction: "allow",
        rules: [
          { id: "deny-secrets", effect: "deny", type: "regex", pattern: secretRegex },
          { id: "deny-actions", effect: "deny", type: "regex", pattern: actionRegex },
          { id: "max-size", effect: "deny", type: "max_chars", value: maxPromptChars },
          ...(blockedKeywords.length > 0 ? [{ id: "deny-blocked-keywords", effect: "deny" as const, type: "contains_any" as const, values: blockedKeywords }] : []),
        ],
      };
    case "topic-limited":
      if (allowedKeywords.length === 0) {
        throw new Error("topic-limited requires allowed_keywords");
      }
      return {
        defaultAction: "deny",
        rules: [
          { id: "deny-secrets", effect: "deny", type: "regex", pattern: secretRegex },
          { id: "deny-actions", effect: "deny", type: "regex", pattern: actionRegex },
          { id: "max-size", effect: "deny", type: "max_chars", value: maxPromptChars },
          { id: "allow-topic-keywords", effect: "allow", type: "contains_any", values: allowedKeywords },
        ],
      };
    case "no-secrets":
      return {
        defaultAction: "allow",
        rules: [
          { id: "deny-secrets", effect: "deny", type: "regex", pattern: secretRegex },
          { id: "max-size", effect: "deny", type: "max_chars", value: maxPromptChars },
        ],
      };
    case "read-only-research":
      return {
        defaultAction: "allow",
        rules: [
          { id: "deny-actions", effect: "deny", type: "regex", pattern: actionRegex },
          { id: "deny-secrets", effect: "deny", type: "regex", pattern: secretRegex },
          { id: "max-size", effect: "deny", type: "max_chars", value: maxPromptChars },
        ],
      };
    case "skill-specific":
      if (allowedKeywords.length === 0) {
        throw new Error("skill-specific requires allowed_keywords");
      }
      return {
        defaultAction: "deny",
        rules: [
          { id: "deny-secrets", effect: "deny", type: "regex", pattern: secretRegex },
          { id: "max-size", effect: "deny", type: "max_chars", value: maxPromptChars },
          { id: "allow-skill-keywords", effect: "allow", type: "contains_any", values: allowedKeywords },
        ],
      };
    default:
      return {
        defaultAction: input.default_action || "deny",
        rules: [],
      };
  }
}

export function compileConsultationPolicy(
  ownerId: string,
  policyId: string,
  input: ConsultationPolicyInput,
  nowIso: string,
): ConsultationCompiledPolicy {
  if (!input.name?.trim()) {
    throw new Error("Policy name is required");
  }

  const template = templateRules(input);
  const rules = normalizeRules(
    [...template.rules, ...(input.rules || [])],
    input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "rule",
  );
  const defaultAction = input.default_action || template.defaultAction;

  if (rules.length === 0) {
    throw new Error("At least one deterministic rule is required");
  }

  if (defaultAction === "deny" && !rules.some((rule) => rule.effect === "allow")) {
    throw new Error("Deny-by-default policies require at least one allow rule");
  }

  const tooLarge = rules.find((rule) => rule.type === "max_chars" && (rule.value || 0) > 20_000);
  if (tooLarge) {
    throw new Error("max_chars cannot exceed 20000");
  }

  return {
    id: policyId,
    owner_id: ownerId,
    name: input.name.trim(),
    template: input.template,
    default_action: defaultAction,
    deny_reason_visibility: input.deny_reason_visibility || "generic",
    requester_transcript_notice: input.requester_transcript_notice ?? true,
    requester_message: CONSULTATION_GENERIC_DENY_MESSAGE,
    compiled_version: POLICY_COMPILED_VERSION,
    rules,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

function matchesRule(rule: ConsultationRule, prompt: string, client?: ConsultationClientDescriptor): boolean {
  switch (rule.type) {
    case "contains_any":
      return (rule.values || []).some((value) => prompt.toLowerCase().includes(value.toLowerCase()));
    case "regex":
      return compilePattern(rule.pattern || "").test(prompt);
    case "max_chars":
      return prompt.length > (rule.value || DEFAULT_MAX_PROMPT_CHARS);
    case "requires_client_field": {
      if (!client) {
        return true;
      }
      const value = client[rule.field || "purpose"];
      return typeof value !== "string" || value.trim().length === 0;
    }
    default:
      return false;
  }
}

export function evaluateConsultationPolicy(
  policy: ConsultationCompiledPolicy,
  prompt: string,
  client?: ConsultationClientDescriptor,
): ConsultationPolicyEvaluation {
  const denyMatches = policy.rules
    .filter((rule) => rule.effect === "deny")
    .filter((rule) => matchesRule(rule, prompt, client));
  if (denyMatches.length > 0) {
    return {
      decision: "deny",
      matched_rules: denyMatches,
      requester_message: policy.requester_message,
      would_reach_agent: false,
    };
  }

  const allowMatches = policy.rules
    .filter((rule) => rule.effect === "allow")
    .filter((rule) => matchesRule(rule, prompt, client));
  if (allowMatches.length > 0) {
    return {
      decision: "allow",
      matched_rules: allowMatches,
      requester_message: policy.requester_message,
      would_reach_agent: true,
    };
  }

  const decision = policy.default_action;
  return {
    decision,
    matched_rules: [],
    requester_message: policy.requester_message,
    would_reach_agent: decision === "allow",
  };
}
