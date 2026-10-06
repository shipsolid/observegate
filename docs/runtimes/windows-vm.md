# Windows VM runtime

Windows VM gates consume normalized JSON evidence from a user-owned deployment or inventory job.
ObserveGate never connects over WinRM, PowerShell remoting, or SSH.

## Required evidence

- Windows service name, state, start mode, restart count, and exit code.
- Recovery-action coverage for restart, timeout, and shutdown failures.
- Candidate release marker and artifact digest on every expected host.
- CPU, memory, disk, host availability, and telemetry-agent export state.

The parser accepts data, not commands. Scripts, pipelines, redirections, or executable strings are
rejected. Evidence files must resolve inside the workspace, remain below configured size limits,
and satisfy freshness/provenance checks.

```yaml
runtime:
  type: azure_vm
  operating_system: windows
  provider: azure-runtime
  service_name_env: WINDOWS_SERVICE_NAME
```

Azure VM state may come from ARM instance view. Guest service and release facts must come from the
bounded evidence contract or telemetry.
