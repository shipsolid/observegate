# Kubernetes and AKS runtime

ObserveGate reads Kubernetes deployment state and rendered manifests. It supports `Deployment`,
`StatefulSet`, and `DaemonSet` workloads, including AKS; it never applies, patches, scales, restarts,
or changes traffic.

## Target fields

```yaml
runtime:
  type: kubernetes
  provider: kubernetes-runtime
  distribution: aks
  context_env: KUBE_CONTEXT
  namespace_env: K8S_NAMESPACE
  workload:
    kind: Deployment
    name_env: K8S_WORKLOAD
    container_env: K8S_CONTAINER
  expected:
    image_digest_env: IMAGE_DIGEST
  artifacts:
    rendered_manifests:
      - deploy/rendered/kubernetes.yaml
```

Environment variables contain selected values; credential values stay outside YAML.

## Permissions

Grant `get` and `list` only for the selected workload kind, ReplicaSets, Pods, and Events in the
target namespace. The implementation follows pagination and does not require mutation verbs.
If organizational policy grants `watch`, ObserveGate does not rely on it.

## Evidence and gates

- Workload generation, observed generation, rollout conditions, and available replicas.
- Candidate image identity across workload and Pods.
- Pod readiness, restarts, termination reasons, and release-related Events.
- Rendered manifest selectors, probes, resource requests/limits, strategy, disruption policy,
  topology spread, and telemetry injection.

Run pre-deployment gates against rendered manifests before Helm deploys. Run post-deployment gates
after the deployment job publishes the release ID and deployment completion time.

## Safe diagnostics

```bash
kubectl --context "$KUBE_CONTEXT" --namespace "$K8S_NAMESPACE" get deployment "$K8S_WORKLOAD" -o yaml
kubectl --context "$KUBE_CONTEXT" --namespace "$K8S_NAMESPACE" get pods -o wide
kubectl --context "$KUBE_CONTEXT" --namespace "$K8S_NAMESPACE" get events --sort-by=.lastTimestamp
```

These commands are read-only. Permanent resources remain owned by Helm or Terraform.
