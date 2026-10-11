// Resource-less guard shared by the API (../app/main.bicep) and the billing worker
// (../billing-worker/main.bicep): deployed only when Google billing is switched on. Its only purpose is
// the parameter validation below - the deployment fails during validation, before anything changes, when
// a setting that billing cannot run without is empty. Nothing is created and no value is an output.
// None of these are secrets (product / plan ids, a public webhook URL, a service-account e-mail, a Key
// Vault URI, a Service Bus FQDN); the secret VALUES live in Key Vault and are never passed here.
targetScope = 'resourceGroup'

@minLength(1)
#disable-next-line no-unused-params
param googleProductId string

@minLength(1)
#disable-next-line no-unused-params
param googleBasePlanId string

@description('The exact RTDN webhook URL the Pub/Sub push subscription is configured with.')
@minLength(1)
#disable-next-line no-unused-params
param googlePubSubAudience string

@minLength(1)
#disable-next-line no-unused-params
param googlePushServiceAccountEmail string

@description('Key Vault URI with trailing slash.')
@minLength(1)
#disable-next-line no-unused-params
param billingKeyVaultUri string

@description('Service Bus namespace FQDN for the billing-events wake-up.')
@minLength(1)
#disable-next-line no-unused-params
param billingEventsServiceBusNamespace string
