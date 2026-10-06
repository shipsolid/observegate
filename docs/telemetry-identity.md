# Telemetry identity

ObserveGate treats release identity as a cross-signal contract. Runtime state, deployment
attestation, metrics, logs, and traces must identify the same candidate before a deployment passes.

## Canonical OpenTelemetry keys

| Meaning     | Canonical key                 | Cardinality risk | Rule                                                                             |
| ----------- | ----------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| Service     | `service.name`                | low              | Stable service identifier.                                                       |
| Namespace   | `service.namespace`           | low              | Stable product/domain namespace.                                                 |
| Release     | `service.version`             | medium           | Immutable release or artifact ID.                                                |
| Environment | `deployment.environment.name` | low              | Controlled environment vocabulary.                                               |
| Instance    | `service.instance.id`         | medium/high      | Required only where instance analysis is necessary; never aggregate unboundedly. |

Request IDs, user IDs, raw timestamps, trace IDs, and span IDs must not become metric labels. Keep
them in logs/traces or exemplars.

## Provider mappings

- Metrics commonly map dots to underscores: `service_name`, `service_namespace`,
  `service_version`, `deployment_environment`.
- Loki structured metadata uses configured resource-field mappings such as
  `resource_service_name`; `trace_id` and `span_id` remain correlation fields, not index labels.
- Tempo uses resource attributes directly: `resource.service.name`,
  `resource.service.namespace`, `resource.service.version`, and
  `resource.deployment.environment.name`.

Declare mappings explicitly under `identity.provider_mappings`. Do not rely on provider-specific
implicit renaming.

## Release mismatch behavior

Missing or stale release evidence follows the configured no-data policy. Conflicting runtime,
attestation, or telemetry release IDs fail the blocking identity gates. A baseline release is never
silently substituted for the candidate.
