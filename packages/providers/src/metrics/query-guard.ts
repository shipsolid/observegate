import { GateError } from "@observability-gate/core";

export interface PrometheusQueryGuardInput {
  readonly query: string;
  readonly maximumQueryLength?: number;
  readonly startMs?: number;
  readonly endMs?: number;
  readonly maximumRangeMs?: number;
  readonly stepMs?: number;
  readonly minimumStepMs?: number;
  readonly requiredScopeLabels?: readonly string[];
}

function reject(message: string): never {
  throw new GateError({
    code: "SECURITY_POLICY",
    safeMessage: message,
    retryable: false
  });
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function guardPrometheusQuery(input: PrometheusQueryGuardInput): void {
  const maximumQueryLength = input.maximumQueryLength ?? 16 * 1024;
  if (input.query.length === 0 || input.query.length > maximumQueryLength) {
    reject("Prometheus query length is outside the configured limit");
  }

  if (input.startMs !== undefined || input.endMs !== undefined || input.stepMs !== undefined) {
    if (
      input.startMs === undefined ||
      input.endMs === undefined ||
      !Number.isFinite(input.startMs) ||
      !Number.isFinite(input.endMs) ||
      input.endMs <= input.startMs
    ) {
      reject("Prometheus range boundaries are invalid");
    }
    if (input.maximumRangeMs !== undefined && input.endMs - input.startMs > input.maximumRangeMs) {
      reject("Prometheus query range exceeds the configured limit");
    }
    if (
      input.stepMs === undefined ||
      !Number.isFinite(input.stepMs) ||
      input.stepMs < (input.minimumStepMs ?? 1_000)
    ) {
      reject("Prometheus range step must be at least one second");
    }
  }

  for (const label of input.requiredScopeLabels ?? []) {
    const matcher = new RegExp(
      `(?:\\{|,)\\s*${escapeRegularExpression(label)}\\s*=~?\\s*[^,}]+`,
      "u"
    );
    if (!matcher.test(input.query)) {
      reject("Production Prometheus query is missing a required identity scope");
    }
  }
}
