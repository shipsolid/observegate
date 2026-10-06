import { GateError } from "@observability-gate/core";

export interface IncidentSummary {
  readonly id: string;
  readonly service: string;
  readonly environment: string;
  readonly severity: string;
  readonly state: string;
  readonly updatedAt: string;
}

export function parseIncidentEvidence(content: Buffer): {
  readonly incidents: readonly IncidentSummary[];
} {
  let payload: unknown;
  try {
    payload = JSON.parse(content.toString("utf8")) as unknown;
  } catch {
    payload = undefined;
  }
  const raw = payload as { incidents?: unknown } | undefined;
  if (!Array.isArray(raw?.incidents)) {
    throw new GateError({
      code: "EVIDENCE_INVALID",
      safeMessage: "Incident evidence is invalid",
      retryable: false
    });
  }
  const incidents: IncidentSummary[] = [];
  for (const value of raw.incidents) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new GateError({
        code: "EVIDENCE_INVALID",
        safeMessage: "Incident record is invalid",
        retryable: false
      });
    }
    const incident = value as Record<string, unknown>;
    if (
      typeof incident.id !== "string" ||
      typeof incident.service !== "string" ||
      typeof incident.environment !== "string" ||
      typeof incident.severity !== "string" ||
      typeof incident.state !== "string" ||
      typeof incident.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(incident.updatedAt))
    ) {
      throw new GateError({
        code: "EVIDENCE_INVALID",
        safeMessage: "Incident record is invalid",
        retryable: false
      });
    }
    incidents.push(
      Object.freeze({
        id: incident.id,
        service: incident.service,
        environment: incident.environment,
        severity: incident.severity,
        state: incident.state,
        updatedAt: new Date(incident.updatedAt).toISOString()
      })
    );
  }
  return Object.freeze({ incidents: Object.freeze(incidents) });
}
