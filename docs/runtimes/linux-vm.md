# Linux VM runtime

Linux VM gates consume workspace-local evidence produced by a user-owned deployment or inventory
job. ObserveGate never opens SSH and never executes `systemctl` or a shell pipeline.

## Required evidence

- Host identity and availability.
- Bounded CPU, memory, disk, load, and collection timestamps.
- systemd unit active/sub-state, restart count, result, and failed-unit count.
- Candidate release marker and artifact digest for every expected host.
- Telemetry-agent health, export failures, queue utilization, and last successful export time.

The systemd evidence parser accepts only bounded, normalized fields. Command strings, pipelines,
redirections, and executable payloads are rejected as `SECURITY_POLICY`.

```yaml
runtime:
  type: linux_vm
  operating_system: linux
  provider: generic-runtime
  host_group_env: HOST_GROUP
  service_name_env: SYSTEMD_SERVICE_NAME
```

Produce JSON evidence in the configured workspace path, sign deployment evidence where required,
and keep collection privileged operations in the user-owned deployment system.
