import { GateError } from "@observability-gate/core";
import { assertion, createEvidenceGate, record } from "../../evaluation.js";

export interface ChangeWindowConfiguration {
  readonly timezone: string;
  readonly freezes: readonly unknown[];
}

export function parseChangeWindowConfiguration(input: unknown): ChangeWindowConfiguration {
  const value = record(input);
  const timezone = value?.timezone;
  const freezes = value?.freezes;
  const isNamedIanaTimezone =
    typeof timezone === "string" &&
    (timezone === "UTC" || /^[A-Za-z_+-]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?$/.test(timezone));
  let isSupportedTimezone = false;
  if (isNamedIanaTimezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0));
      isSupportedTimezone = true;
    } catch {
      isSupportedTimezone = false;
    }
  }
  if (!isSupportedTimezone || !Array.isArray(freezes)) {
    throw new GateError({
      code: "CONFIG_SCHEMA",
      safeMessage:
        "Change-window configuration requires an explicit IANA timezone and freezes array",
      retryable: false
    });
  }
  return Object.freeze({ timezone: timezone as string, freezes: Object.freeze([...freezes]) });
}

export const changeWindowGate = createEvidenceGate({
  type: "policy.change_window",
  description: "Evaluate deployment freezes and explicit exceptions.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const active = value.freezeActive === true;
    const exceptionValid =
      value.exceptionApproved === true &&
      typeof value.exceptionId === "string" &&
      value.exceptionId.length > 0 &&
      typeof value.exceptionReason === "string" &&
      value.exceptionReason.length > 0 &&
      typeof value.exceptionApprover === "string" &&
      value.exceptionApprover.length > 0;
    return [
      assertion(
        "change window",
        !active || exceptionValid,
        active
          ? "Active freeze requires a complete approved exception"
          : "No deployment freeze is active",
        active
      )
    ];
  }
});
