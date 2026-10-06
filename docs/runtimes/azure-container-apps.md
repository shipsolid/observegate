# Azure Container Apps runtime

The Azure Container Apps adapter reads the application, candidate revision, replica state, image,
traffic weights, provisioning conditions, and activation failures. It does not create revisions,
change traffic, scale replicas, or restart the application.

## Target fields

```yaml
runtime:
  type: azure_container_apps
  provider: azure-runtime
  subscription_id_env: AZURE_SUBSCRIPTION_ID
  resource_group_env: AZURE_RESOURCE_GROUP
  application_name_env: CONTAINER_APP_NAME
  revision_name_env: CONTAINER_APP_REVISION
  expected:
    image_digest_env: IMAGE_DIGEST
    revision_suffix_env: REVISION_SUFFIX
```

## Identity and permissions

Use GitHub OIDC or ambient Azure identity. Grant Reader at the narrowest resource group or Container
App scope. No client secret is required when workload identity is available, and no Contributor
permission is needed.

## Evidence and gates

- Candidate revision provisioning and active state.
- Exact image digest and revision suffix.
- Candidate, baseline, and unknown revision traffic weights.
- Healthy/unhealthy replicas, restarts, and activation failures.
- Rendered Container App configuration before deployment.

Safe Azure CLI diagnostics:

```bash
az containerapp show --subscription "$AZURE_SUBSCRIPTION_ID" --resource-group "$AZURE_RESOURCE_GROUP" --name "$CONTAINER_APP_NAME"
az containerapp revision list --subscription "$AZURE_SUBSCRIPTION_ID" --resource-group "$AZURE_RESOURCE_GROUP" --name "$CONTAINER_APP_NAME"
```
