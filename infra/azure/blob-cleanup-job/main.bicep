// Account deletion Blob cleanup scheduled Job - resource group scope. Deployed after Foundation
// (../foundation) and after an image has been pushed to the ACR Foundation created, same as
// ../app/main.bicep and ../job/main.bicep - this file references Foundation/App resources purely
// through parameters, never re-declaring or re-discovering them.
//
// This is a SEPARATE resource from ../job/main.bicep (the Push dispatch Job) on purpose - the two
// Jobs have unrelated lifecycles and completely disjoint configuration (this one never touches
// Firebase; that one never touches Blob Storage). Bundling them into one all-or-nothing deployment
// would only couple two independent operational concerns together for no benefit. See
// IBlobCleanupService/AccountDeletionBlobCleanup's own remarks for why this Job exists at all: it
// is not a failure-only safety net - every account deletion (including the normal, fully successful
// path) leaves its Blob cleanup task pending until a LATER run confirms the Blob prefix is clean a
// second time, at or after a 10-minute grace period (see BlobCleanupService.GracePeriod). Until this
// Job is actually deployed and running on schedule, that confirming sweep never happens for anyone -
// see ../README.md's "Blob cleanup scheduled Job" section for why this makes the Job a hard release
// blocker for the account deletion feature, not an optional extra.
targetScope = 'resourceGroup'

@description('Short environment name - must match the Foundation/App deployment this is layered on top of.')
param environmentName string = 'dev'

param location string = 'koreacentral'

@description('ACR login server - Foundation output "acrLoginServer".')
param acrLoginServer string

@description('Repository name within the ACR - must match ../app/main.bicep\'s imageRepository (same image, reused as-is - no separate worker image, and the Dockerfile ENTRYPOINT is never overridden here, only its args).')
param imageRepository string = 'juple-api'

@description('Image tag to deploy. Empty only when imageDigest is used - the template never picks an image on its own, same reasoning as ../app/main.bicep and ../job/main.bicep - the deployer picks an explicit, already-pushed tag every time. Should normally match whatever tag the Container App (../app/main.bicep) is running, so this Job cleans up Blobs against the same code that owns the AccountDeletionBlobCleanup table schema.')
param imageTag string = ''

@description('Immutable image digest ("sha256:" + 64 hex characters) to deploy instead of a tag - Production pins the exact image the API runs, so a re-pushed tag can never change what runs. When set it wins over imageTag and the reference becomes {acrLoginServer}/{imageRepository}@{imageDigest}. Empty = use imageTag (Dev).')
param imageDigest string = ''

@description('Container Apps Environment resource ID - Foundation output "containerAppsEnvironmentId". Same Environment as the API Container App and the Push dispatch Job - this is a second scheduled Job, not a second Environment.')
param containerAppsEnvironmentId string

@description('User Assigned Managed Identity resource ID - Foundation output "managedIdentityResourceId". Reused as-is for both ACR pull (existing AcrPull role assignment in ../foundation/resources.bicep) and Blob Storage access (existing Storage Blob Data Contributor role assignment, same Managed Identity ../app/main.bicep already uses for the same purpose) - no new role assignment of any kind is created by this template.')
param managedIdentityResourceId string

@description('User Assigned Managed Identity client ID - Foundation output "managedIdentityClientId". Not a secret (an identifier, not a credential) - passed through as AZURE_CLIENT_ID so this container\'s DefaultAzureCredential() (see BlobServiceClientFactory.cs, unchanged from the API\'s own Blob access path) resolves this specific identity. Same value ../app/main.bicep passes for the same reason.')
param managedIdentityClientId string

@description('Full ASP.NET Core SQL connection string, credentials included - same value/shape as ../app/main.bicep and ../job/main.bicep\'s own sqlConnectionString parameter, supplied separately here because this Job has its own independent secret namespace (a Container Apps Job is a distinct resource, not a shared config scope). Never put a real value in a checked-in parameter file.')
@secure()
param sqlConnectionString string = ''

@description('Where the SQL runtime connection string comes from. false (default - Dev): the @secure() sqlConnectionString parameter carries the VALUE into a Container Apps secret. true (Production): a Key Vault reference to the secret named by sqlConnectionStringSecretName, resolved at runtime through this workload\'s own managed identity - the deployer never reads or passes a connection string, and a supplied one is refused by ../app/sql-connection-source-guard.bicep rather than silently ignored. Requires the Key Vault URI. The vault secret holds the RUNTIME principal\'s connection string, never the administrator\'s.')
param sqlConnectionStringFromKeyVault bool = false

@description('Key Vault secret NAME (never a value) of the runtime connection string - used only when sqlConnectionStringFromKeyVault. The Container Apps secret keeps its own name, sql-connection-string, so the env secretRef is unchanged.')
param sqlConnectionStringSecretName string = 'sql-runtime-connection-string'

@description('Key Vault URI with trailing slash - the Production vault\'s "keyVaultUri" (../foundation/billing.bicep output). Needed only when sqlConnectionStringFromKeyVault.')
param keyVaultUri string = ''

@description('Blob service endpoint URI - Foundation output "storageBlobServiceUri". No Storage Account key or connection string is ever used; this Job authenticates the same way the API Container App does, via managedIdentityResourceId + DefaultAzureCredential.')
param storageBlobServiceUri string

@description('Must match the API Container App\'s own blobContainerName (../app/main.bicep) - the same container both write to/clean up.')
param blobContainerName string = 'item-images'

@description('How the Job starts. Schedule (default - every existing environment): runs on cronExpression. Manual: no schedule at all; an execution starts only when an operator starts it (az containerapp job start). Production deploys these destructive cleanup Jobs as Manual first, runs them once under observation, and only then switches to Schedule as a deliberate change.')
@allowed([
  'Schedule'
  'Manual'
])
param triggerType string = 'Schedule'

@description('UTC cron expression - Container Apps Job schedules are always UTC, never local/server time (same convention as ../job/main.bicep). Default: every 5 minutes. This is NOT a mathematical requirement of the 10-minute grace period in BlobCleanupService (a longer interval would still eventually run the confirming sweep) - 5 minutes is chosen to keep orphan-Blob and cleanup-task residency time low and to keep operational visibility (how long a stuck task can go unnoticed) tight.')
param cronExpression string = '*/5 * * * *'

@description('Wall-clock ceiling for one Job execution. Kept comfortably under the 5-minute schedule interval so a slow execution cannot still be running when the next one is due - BlobCleanupService/AccountDeletionBlobCleanupStore already treat a re-run over the same pending tasks as safe (DeleteBlobsByPrefixAsync is idempotent via DeleteIfExistsAsync, and every store mutation no-ops on an already-gone row - see those types\' own remarks), so an occasional overlap would not corrupt anything, but there is no reason to invite it routinely.')
param replicaTimeoutSeconds int = 240

@description('Kept at 0, unlike ../job/main.bicep\'s Push dispatch Job (which uses 1): the next scheduled execution, five minutes away at most, already serves as the retry for a whole-container failure here, and BlobCleanupService\'s own per-task failure handling (RecordFailedAttemptAsync, leaving the task pending) already covers a single cleanup task failing without blocking the rest of that same run. An immediate whole-Job retry on top of that would mostly just risk overlapping the next scheduled run for no correctness benefit.')
param replicaRetryLimit int = 0

@description('Finishes pending Entra sign-in account deletions (the same pass as the blob cleanup). Off by default (the Job then skips that step and keeps any pending rows); same settings as ../app/main.bicep. Needs the customer tenant id, the deletion app registration client id and its client secret - a Key Vault reference (entraAccountDeletionClientSecretFromKeyVault, Production) or the value (Dev).')
param entraAccountDeletionEnabled bool = false
param entraAccountDeletionTenantId string = ''
param entraAccountDeletionClientId string = ''

@description('Vault mode for the deletion client secret, the same pattern as ../app/main.bicep (apiKeysFromKeyVault): the Container Apps secret is a Key Vault reference read through the Managed Identity, so the value never passes through a deployment parameter. Uses keyVaultUri above. Production sets true.')
param entraAccountDeletionClientSecretFromKeyVault bool = false

@description('Key Vault secret NAME (never a value) of the deletion client secret - used only when entraAccountDeletionClientSecretFromKeyVault. The same vault secret the API reads.')
param entraAccountDeletionClientSecretName string = 'entra-account-deletion-client-secret'

@secure()
@description('The deletion client secret as a value (parameter mode, Dev). Leave empty in vault mode. Never committed.')
param entraAccountDeletionClientSecret string = ''

@description('Smallest Consumption-plan cpu/memory pairing, same as ../app/main.bicep and ../job/main.bicep - listing/deleting a Dev-scale number of Blobs under a handful of pending prefixes needs nothing larger.')
param containerCpu string = '0.25'
param containerMemory string = '0.5Gi'

var jobName = 'caj-juple-blob-cleanup-${environmentName}'
var containerImage = empty(imageDigest)
  ? '${acrLoginServer}/${imageRepository}:${imageTag}'
  : '${acrLoginServer}/${imageRepository}@${imageDigest}'

// Fail-closed image reference, shared with the API template (see ../app/image-reference-guard.bicep): an image must
// be named (no floating-tag fallback) and a digest must have the exact length of a sha256 reference.
module imageReferenceGuard '../app/image-reference-guard.bicep' = {
  name: 'juple-${environmentName}-blob-cleanup-image-reference-guard'
  params: {
    #disable-next-line BCP329
    imageReferenceSupplied: (empty(imageTag) ? 0 : 1) + (empty(imageDigest) ? 0 : 1)
    imageDigestLength: length(imageDigest)
  }
}


// The SQL connection string secret: a Key Vault reference (vault mode) or the supplied value (parameter mode).
// Same secret name in both modes, so the env secretRef below never changes.
var sqlConnectionStringSecret = sqlConnectionStringFromKeyVault
  ? {
      name: 'sql-connection-string'
      keyVaultUrl: '${keyVaultUri}secrets/${sqlConnectionStringSecretName}'
      identity: managedIdentityResourceId
    }
  : {
      name: 'sql-connection-string'
      value: sqlConnectionString
    }

// Fail-closed connection string source (see ../app/sql-connection-source-guard.bicep): vault mode needs the vault
// URI and must not also receive a value; parameter mode needs the value. Only 0/1 flags reach the guard.
module sqlConnectionSourceVaultGuard '../app/sql-connection-source-guard.bicep' = if (sqlConnectionStringFromKeyVault) {
  name: 'juple-${environmentName}-blob-cleanup-job-sql-source-vault-guard'
  params: {
    #disable-next-line BCP329
    keyVaultUriProvided: empty(keyVaultUri) ? 0 : 1
    #disable-next-line BCP330
    plaintextConnectionStringSupplied: empty(sqlConnectionString) ? 0 : 1
  }
}

module sqlConnectionSourceParameterGuard '../app/sql-connection-source-guard.bicep' = if (!sqlConnectionStringFromKeyVault) {
  name: 'juple-${environmentName}-blob-cleanup-job-sql-source-parameter-guard'
  params: {
    #disable-next-line BCP329
    connectionStringSupplied: empty(sqlConnectionString) ? 0 : 1
  }
}

// The Entra deletion client secret: a Key Vault reference (vault mode) or the supplied value (parameter mode). Same secret name in
// both modes, so the env secretRef below never changes.
var entraDeletionClientSecret = entraAccountDeletionClientSecretFromKeyVault
  ? {
      name: 'entra-deletion-client-secret'
      keyVaultUrl: '${keyVaultUri}secrets/${entraAccountDeletionClientSecretName}'
      identity: managedIdentityResourceId
    }
  : {
      name: 'entra-deletion-client-secret'
      value: entraAccountDeletionClientSecret
    }

// Fail-closed secret source (see ../app/entra-deletion-secret-source-guard.bicep), only while the deletion is enabled: vault mode
// needs the vault URI and must not also receive a value; parameter mode needs the value. Only 0/1 flags reach the guard.
module entraDeletionSecretVaultGuard '../app/entra-deletion-secret-source-guard.bicep' = if (entraAccountDeletionEnabled && entraAccountDeletionClientSecretFromKeyVault) {
  name: 'juple-${environmentName}-blob-cleanup-job-entra-secret-vault-guard'
  params: {
    #disable-next-line BCP329
    keyVaultUriProvided: empty(keyVaultUri) ? 0 : 1
    #disable-next-line BCP330
    plaintextClientSecretSupplied: empty(entraAccountDeletionClientSecret) ? 0 : 1
  }
}

module entraDeletionSecretParameterGuard '../app/entra-deletion-secret-source-guard.bicep' = if (entraAccountDeletionEnabled && !entraAccountDeletionClientSecretFromKeyVault) {
  name: 'juple-${environmentName}-blob-cleanup-job-entra-secret-parameter-guard'
  params: {
    #disable-next-line BCP329
    clientSecretSupplied: empty(entraAccountDeletionClientSecret) ? 0 : 1
  }
}

resource blobCleanupJob 'Microsoft.App/jobs@2024-03-01' = {
  name: jobName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironmentId
    configuration: {
      triggerType: triggerType
      replicaTimeout: replicaTimeoutSeconds
      replicaRetryLimit: replicaRetryLimit
      scheduleTriggerConfig: triggerType == 'Schedule' ? {
        // One replica per execution, and exactly one completion required - a cleanup pass is a
        // single sequential loop over pending tasks (see BlobCleanupService.RunPendingCleanupsAsync),
        // not a fan-out workload. Correctness against two executions overlapping in time does not
        // depend on this setting either way - see replicaTimeoutSeconds's own remarks.
        cronExpression: cronExpression
        parallelism: 1
        replicaCompletionCount: 1
      } : null
      manualTriggerConfig: triggerType == 'Manual' ? {
        parallelism: 1
        replicaCompletionCount: 1
      } : null
      // ACR pull via the Managed Identity's AcrPull role (granted in ../foundation/resources.bicep,
      // shared with the API Container App and the Push dispatch Job) - no username/password secret.
      registries: [
        {
          server: acrLoginServer
          identity: managedIdentityResourceId
        }
      ]
      secrets: concat([
        sqlConnectionStringSecret
      ], entraAccountDeletionEnabled ? [
        entraDeletionClientSecret
      ] : [])
    }
    template: {
      containers: [
        {
          name: 'juple-blob-cleanup'
          image: containerImage
          // Dockerfile's ENTRYPOINT ["dotnet", "Juple.Api.dll"] is left untouched (no `command`
          // override) - this only appends the one argument that switches Program.cs into its
          // one-shot Blob cleanup retry branch, which returns before UseAuthentication/
          // MapControllers/app.Run() ever execute, so this Job never opens an HTTP port or runs as
          // a server.
          args: [
            '--run-blob-cleanup-retry'
          ]
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: concat([
            {
              name: 'ConnectionStrings__JupleDatabase'
              secretRef: 'sql-connection-string'
            }
            {
              // Deliberately no ConnectionStrings__BlobStorage - its absence is what makes
              // BlobServiceClientFactory.cs fall through to the ServiceUri + DefaultAzureCredential
              // (Managed Identity) path instead of a Shared Key connection string. No Storage
              // Account key or SAS write credential is ever configured for this Job.
              name: 'BlobStorage__ServiceUri'
              value: storageBlobServiceUri
            }
            {
              name: 'BlobStorage__ContainerName'
              value: blobContainerName
            }
            {
              // Not a secret - a public identifier, same as ../app/main.bicep's own use of it.
              name: 'AZURE_CLIENT_ID'
              value: managedIdentityClientId
            }
          ], entraAccountDeletionEnabled ? [
            {
              name: 'EntraAccountDeletion__Enabled'
              value: 'true'
            }
            {
              name: 'EntraAccountDeletion__TenantId'
              value: entraAccountDeletionTenantId
            }
            {
              name: 'EntraAccountDeletion__ClientId'
              value: entraAccountDeletionClientId
            }
            {
              name: 'EntraAccountDeletion__ClientSecret'
              secretRef: 'entra-deletion-client-secret'
            }
          ] : [])
        }
      ]
    }
  }
}

output jobName string = blobCleanupJob.name
