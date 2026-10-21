// Resource-less guard for a workload's APNs settings (apnsKeyId / apnsTeamId / apnsPrivateKeySecretName in the
// notification worker and push-dispatch Job templates). Same purpose and shape as ./firebase-credential-source-guard.bicep:
// ARM rejects the deployment during template validation - before anything is created or changed - instead of letting a
// half-configured revision start. The backend refuses to start on half an Apns section (ApnsOptions.Validate), and the same
// process also sends Android (FCM) Push, so a bad APNs configuration must never reach a running revision.
//
// It receives 0/1 flags only, never the vault URI or a secret. Key ID and Team ID are not secrets, but the private key is
// only ever a Key Vault reference: there is deliberately no parameter that could carry the .p8 content. The parameter
// name is the message the operator sees. Nothing is created and nothing is an output.
targetScope = 'resourceGroup'

@description('1 when only one or two of the three APNs settings (Key ID, Team ID, Key Vault secret name of the .p8 key) were supplied (must be 0). Supply all three, or none for APNs off - iOS deliveries then wait as push_transport_not_configured and Android is unaffected.')
@maxValue(0)
#disable-next-line no-unused-params
param apnsSettingsPartiallySupplied int = 0

@description('1 when the APNs Key ID is not the 10-character id from Apple Developer > Keys (must be 0).')
@maxValue(0)
#disable-next-line no-unused-params
param apnsKeyIdNotTenCharacters int = 0

@description('1 when the Apple Developer Team ID is not 10 characters (must be 0).')
@maxValue(0)
#disable-next-line no-unused-params
param apnsTeamIdNotTenCharacters int = 0

@description('APNs on: 1 when the Key Vault URI parameter is non-empty. The private key is a Key Vault reference and cannot be built without the vault URI.')
@minValue(1)
#disable-next-line no-unused-params
param keyVaultUriProvided int = 1
