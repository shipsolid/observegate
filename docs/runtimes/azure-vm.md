# Azure VM runtime

The Azure VM adapter reads ARM instance view for provisioning, power, and maintenance state. It does
not run commands in the guest, use SSH/WinRM, restart the VM, install extensions, or mutate scale.

## Target fields

```yaml
runtime:
  type: azure_vm
  operating_system: windows
  provider: azure-runtime
  subscription_id_env: AZURE_SUBSCRIPTION_ID
  resource_group_env: AZURE_RESOURCE_GROUP
  virtual_machine_name_env: AZURE_VM_NAME
  service_name_env: WINDOWS_SERVICE_NAME
  expected:
    artifact_digest_env: ARTIFACT_DIGEST
    release_marker_env: RELEASE_MARKER
```

Use GitHub OIDC or ambient Azure identity with Reader at the VM or resource-group scope. Guest
service state, release markers, host health, and telemetry-agent state come from bounded signed
evidence or telemetry, not remote command execution.

```bash
az vm get-instance-view --subscription "$AZURE_SUBSCRIPTION_ID" --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_VM_NAME"
```
