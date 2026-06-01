import { type ConsultationClientDescriptor, type ConsultationCompiledPolicy, type ConsultationPolicyEvaluation, type ConsultationPolicyInput } from "./consultation-types.js";
export declare function compileConsultationPolicy(ownerId: string, policyId: string, input: ConsultationPolicyInput, nowIso: string): ConsultationCompiledPolicy;
export declare function evaluateConsultationPolicy(policy: ConsultationCompiledPolicy, prompt: string, client?: ConsultationClientDescriptor): ConsultationPolicyEvaluation;
