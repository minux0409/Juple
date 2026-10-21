// Push dispatch scheduled Job - resource group scope. Deployed after Foundation (../foundation)
// and after an image has been pushed to the ACR Foundation created, same as ../app/main.bicep -
// this file references Foundation/App resources purely through parameters, never re-declaring or
// re-discovering them.
//
// This Job reuses the exact same Backend image as ../app/main.bicep's Container App (one image,
// two very different entrypoints via `args`) - see docs/architecture.md's "Push 알림 전송" section
// on why a scheduled Job rather than an in-API BackgroundService: the API Container App scales to
// zero, so nothing would ever be running to host a background timer.
targetScope = 'resourceGroup'

@description('Short environment name - must match the Foundation/App deployment this is layered on top of.')
param environmentName string = 'dev'

param location string = 'koreacentral'

@description('ACR login server - Foundation output "acrLoginServer".')
param acrLoginServer string

@description('Repository name within the ACR - must match ../app/main.bicep\'s imageRepository (same image, reused as-is).')
param imageRepository string = 'juple-api'

@description('Image tag to deploy. Empty only when imageDigest is used - the template never picks an image on its own, same reasoning as ../app/main.bicep - the deployer picks an explicit, already-pushed tag every time. Should normally match whatever tag the Container App (../app/main.bicep) is running, so the Job dispatches against the same code the API validates Notifications/RepeatPurchases with.')
param imageTag string = ''

@description('Immutable image digest ("sha256:" + 64 hex characters) to deploy instead of a tag - Production pins the exact image the API runs, so a re-pushed tag can never change what runs. When set it wins over imageTag and the reference becomes {acrLoginServer}/{imageRepository}@{imageDigest}. Empty = use imageTag (Dev).')
param imageDigest string = ''

@description('Container Apps Environment resource ID - Foundation output "containerAppsEnvironmentId". Same Environment as the API Container App - this is a scheduled Job, not a second always-on app, so it does not need its own Environment.')
param containerAppsEnvironmentId string

@description('User Assigned Managed Identity resource ID - Foundation output "managedIdentityResourceId". Used only for ACR pull here - unlike ../app/main.bicep\'s Container App, this Job never talks to Blob Storage (Push dispatch never touches Item images), so it does not need AZURE_CLIENT_ID/DefaultAzureCredential at all.')
param managedIdentityResourceId string

@description('Full ASP.NET Core SQL connection string, credentials included - same value/shape as ../app/main.bicep\'s sqlConnectionString parameter, supplied separately here because this Job has its own independent secret namespace (a Container Apps Job is a distinct resource from the Container App, not a shared config scope). Never put a real value in a checked-in parameter file.')
@secure()
param sqlConnectionString string = ''

@description('Where the SQL runtime connection string comes from. false (default - Dev): the @secure() sqlConnectionString parameter carries the VALUE into a Container Apps secret. true (Production): a Key Vault reference to the secret named by sqlConnectionStringSecretName, resolved at runtime through this workload\'s own managed identity - the deployer never reads or passes a connection string, and a supplied one is refused by ../app/sql-connection-source-guard.bicep rather than silently ignored. Requires the Key Vault URI. The vault secret holds the RUNTIME principal\'s connection string, never the administrator\'s.')
param sqlConnectionStringFromKeyVault bool = false

@description('Key Vault secret NAME (never a value) of the runtime connection string - used only when sqlConnectionStringFromKeyVault. The Container Apps secret keeps its own name, sql-connection-string, so the env secretRef is unchanged.')
param sqlConnectionStringSecretName string = 'sql-runtime-connection-string'

@description('Key Vault URI with trailing slash - the Production vault\'s "keyVaultUri" (../foundation/billing.bicep output). Needed only when sqlConnectionStringFromKeyVault.')
param keyVaultUri string = ''

@description('Firebase service-account credential JSON (FCM v1 - see FirebaseCloudMessagingSender) for this Job\'s IPushSender. Deliberately never supplied to the API Container App (../app/main.bicep has no equivalent parameter) - the API never sends Push itself, only this Job does, so only this Job needs it. Never put a real value in a checked-in parameter file.')
@secure()
param firebaseServiceAccountKeyJson string = ''

@description('Where the Firebase credential comes from. false (default - Dev): the @secure() firebaseServiceAccountKeyJson parameter carries the VALUE into a Container Apps secret. true (Production): a Key Vault reference to the secret named by firebaseCredentialSecretName, resolved at runtime through this Job\'s own managed identity - the deployer never reads or passes the credential, and a supplied one is refused by ../app/firebase-credential-source-guard.bicep. Requires the Key Vault URI.')
param firebaseCredentialFromKeyVault bool = false

@description('Key Vault secret NAME (never a value) of the Firebase service-account JSON - used only when firebaseCredentialFromKeyVault. The Container Apps secret keeps its own name, firebase-credential, so the env secretRef is unchanged.')
param firebaseCredentialSecretName string = 'firebase-service-account-key-json'

@description('APNs (iOS Push) Key ID - the 10-character id of the .p8 auth key (Apple Developer > Keys). Not a secret. Empty (default) = APNs off: iOS deliveries wait as push_transport_not_configured and Android is unaffected. All or nothing with apnsTeamId and apnsPrivateKeySecretName (../app/apns-config-guard.bicep).')
param apnsKeyId string = ''

@description('Apple Developer Team ID (10 characters) - the APNs provider-token issuer. Not a secret. Empty = APNs off.')
param apnsTeamId string = ''

@description('Key Vault secret NAME (never a value) holding the PEM content of the .p8 APNs auth key (Apns__PrivateKeyPem), resolved at runtime through this workload\'s own managed identity. There is no parameter that could carry the key itself. Requires the Key Vault URI; the identity of this Job (the API identity) must be able to read that secret before this template is deployed - otherwise every execution fails, Android dispatch included. Empty = APNs off.')
param apnsPrivateKeySecretName string = ''

@description('UTC cron expression - Container Apps Job schedules are always UTC, never local/server time (matches this project\'s own DateTimeOffset/UTC-storage convention). Default: every minute - friend request and Collection invitation Push should arrive within about a minute. Overlapping executions are safe: NotificationDeliveryStore.TryClaimAsync sends each (notification, device) pair at most once.')
param cronExpression string = '* * * * *'

@description('Wall-clock ceiling for one Job execution. Well under NotificationDeliveryStore\'s 15-minute stale-lease timeout (900s) and comfortably above FirebaseCloudMessagingSender\'s single-send 20s timeout - a run that hits this ceiling mid-send leaves that one delivery reclaimable by a later execution, never stuck.')
param replicaTimeoutSeconds int = 300

@description('Azure retries the whole execution this many additional times on outright container failure (crash, failed to start) - not a per-delivery retry (that is NotificationDeliveryStore\'s own claim/lease mechanism, wholly separate). Kept at 1 since the per-minute schedule already provides a natural retry cadence for anything transient.')
param replicaRetryLimit int = 1

@description('Smallest Consumption-plan cpu/memory pairing, same as ../app/main.bicep - a one-shot dispatch pass over a Dev-scale RepeatPurchase table needs nothing larger.')
param containerCpu string = '0.25'
param containerMemory string = '0.5Gi'

var jobName = 'caj-juple-push-dispatch-${environmentName}'
var containerImage = empty(imageDigest)
  ? '${acrLoginServer}/${imageRepository}:${imageTag}'
  : '${acrLoginServer}/${imageRepository}@${imageDigest}'

// Fail-closed image reference, shared with the API template (see ../app/image-reference-guard.bicep): an image must
// be named (no floating-tag fallback) and a digest must have the exact length of a sha256 reference.
module imageReferenceGuard '../app/image-reference-guard.bicep' = {
  name: 'juple-${environmentName}-job-image-reference-guard'
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
  name: 'juple-${environmentName}-job-sql-source-vault-guard'
  params: {
    #disable-next-line BCP329
    keyVaultUriProvided: empty(keyVaultUri) ? 0 : 1
    #disable-next-line BCP330
    plaintextConnectionStringSupplied: empty(sqlConnectionString) ? 0 : 1
  }
}

module sqlConnectionSourceParameterGuard '../app/sql-connection-source-guard.bicep' = if (!sqlConnectionStringFromKeyVault) {
  name: 'juple-${environmentName}-job-sql-source-parameter-guard'
  params: {
    #disable-next-line BCP329
    connectionStringSupplied: empty(sqlConnectionString) ? 0 : 1
  }
}

// The Firebase credential secret: a Key Vault reference (vault mode) or the supplied value (parameter mode).
// Same secret name in both modes, so the env secretRef below never changes.
var firebaseCredentialSecret = firebaseCredentialFromKeyVault
  ? {
      name: 'firebase-credential'
      keyVaultUrl: '${keyVaultUri}secrets/${firebaseCredentialSecretName}'
      identity: managedIdentityResourceId
    }
  : {
      name: 'firebase-credential'
      value: firebaseServiceAccountKeyJson
    }

// Fail-closed credential source (see ../app/firebase-credential-source-guard.bicep). Only 0/1 flags reach it.
module firebaseCredentialSourceVaultGuard '../app/firebase-credential-source-guard.bicep' = if (firebaseCredentialFromKeyVault) {
  name: 'juple-${environmentName}-job-firebase-source-vault-guard'
  params: {
    #disable-next-line BCP329
    keyVaultUriProvided: empty(keyVaultUri) ? 0 : 1
    #disable-next-line BCP330
    plaintextCredentialSupplied: empty(firebaseServiceAccountKeyJson) ? 0 : 1
  }
}

module firebaseCredentialSourceParameterGuard '../app/firebase-credential-source-guard.bicep' = if (!firebaseCredentialFromKeyVault) {
  name: 'juple-${environmentName}-job-firebase-source-parameter-guard'
  params: {
    #disable-next-line BCP329
    credentialSupplied: empty(firebaseServiceAccountKeyJson) ? 0 : 1
  }
}

var apnsEnabled = !empty(apnsPrivateKeySecretName)

// Fail-closed APNs settings (see ../app/apns-config-guard.bicep): all three or none, 10-character ids and the vault URI
// when on - checked during template validation, because half an Apns section stops this process (and with it Android
// Push) at startup. Only counts and lengths reach the guard.
module apnsConfigGuard '../app/apns-config-guard.bicep' = {
  name: 'juple-${environmentName}-push-dispatch-apns-config-guard'
  params: {
    #disable-next-line BCP330
    apnsSettingsPartiallySupplied: apnsEnabled != !empty(apnsKeyId) || apnsEnabled != !empty(apnsTeamId) ? 1 : 0
    #disable-next-line BCP330
    apnsKeyIdNotTenCharacters: apnsEnabled && length(apnsKeyId) != 10 ? 1 : 0
    #disable-next-line BCP330
    apnsTeamIdNotTenCharacters: apnsEnabled && length(apnsTeamId) != 10 ? 1 : 0
    #disable-next-line BCP329
    keyVaultUriProvided: apnsEnabled && empty(keyVaultUri) ? 0 : 1
  }
}

// The .p8 private key is only ever a Key Vault reference; Key ID and Team ID are plain settings. Off = nothing added,
// so a template without APNs values deploys exactly what it did before.
var apnsSecrets = apnsEnabled
  ? [
      {
        name: 'apns-private-key'
        keyVaultUrl: '${keyVaultUri}secrets/${apnsPrivateKeySecretName}'
        identity: managedIdentityResourceId
      }
    ]
  : []

var apnsEnv = apnsEnabled
  ? [
      {
        name: 'Apns__KeyId'
        value: apnsKeyId
      }
      {
        name: 'Apns__TeamId'
        value: apnsTeamId
      }
      {
        name: 'Apns__PrivateKeyPem'
        secretRef: 'apns-private-key'
      }
    ]
  : []

resource pushDispatchJob 'Microsoft.App/jobs@2024-03-01' = {
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
      triggerType: 'Schedule'
      replicaTimeout: replicaTimeoutSeconds
      replicaRetryLimit: replicaRetryLimit
      scheduleTriggerConfig: {
        cronExpression: cronExpression
        // One replica per execution, and exactly one completion required - a dispatch pass is a
        // single sequential loop over candidate users (see DispatchDuePushNotificationsService),
        // not a fan-out workload. This bounds waste within one execution; correctness against two
        // executions overlapping in time is NotificationDeliveryStore.TryClaimAsync's job, not
        // this setting's (see that store's own remarks on why GetPendingAsync is a candidate list,
        // not a claim).
        parallelism: 1
        replicaCompletionCount: 1
      }
      // ACR pull via the Managed Identity's AcrPull role (granted in ../foundation/resources.bicep,
      // shared with the API Container App) - no username/password secret of any kind.
      registries: [
        {
          server: acrLoginServer
          identity: managedIdentityResourceId
        }
      ]
      secrets: concat([
        sqlConnectionStringSecret
        firebaseCredentialSecret
      ], apnsSecrets)
    }
    template: {
      containers: [
        {
          name: 'juple-push-dispatch'
          image: containerImage
          // Dockerfile's ENTRYPOINT ["dotnet", "Juple.Api.dll"] is left untouched (no `command`
          // override) - this only appends the one argument that switches Program.cs into its
          // one-shot dispatch branch, which returns before UseAuthentication/MapControllers/
          // app.Run() ever execute, so this Job never opens an HTTP port or runs as a server.
          args: [
            '--run-push-dispatch'
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
              name: 'Firebase__ServiceAccountKeyJson'
              secretRef: 'firebase-credential'
            }
          ], apnsEnv)
        }
      ]
    }
  }
}

output jobName string = pushDispatchJob.name
