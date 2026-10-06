# OTLP contract evidence

OTLP contract evidence proves that a release is instrumented consistently before deployment. The
file provider reads a bounded JSON document inside the workspace and validates its provenance.

## Contract contents

- Required metric instruments with type and unit.
- Required structured log fields and severity behavior.
- Required server/client spans, span kinds, status behavior, and normalized `http.route`.
- Canonical resource identity for service, namespace, environment, and release.
- Trace/log correlation using `trace_id` and `span_id`.
- Error spans and exception recording expectations.
- Producer, artifact digest, release ID, and generation timestamp.

Sensitive attributes and high-cardinality metric dimensions are rejected. Request IDs, user IDs,
raw URLs, raw timestamps, trace IDs, and span IDs belong in logs, traces, or exemplars—not metric
labels.

## Validation

```bash
observability-gate run --config observability-gate.yml --phase pre_deployment
```

An absent file is missing evidence. An old timestamp is stale evidence. Invalid JSON, wrong
provenance, or an unsafe attribute is invalid evidence. None of these states is converted to pass.
