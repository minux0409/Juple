// Resource-less guard: deployed only when the web is declared launch-ready (launchSettingsRequired =
// true in main.bicep). Its only purpose is the parameter validation below - the deployment fails during
// validation, before anything changes, when a setting a public Production launch cannot go without is
// empty. Nothing is created and no value is an output. None of these values is a secret.
//
// It checks presence, not truth: the operator's real values (business registration number, address)
// and the Play App Signing fingerprint are supplied by the operator once they exist; an obviously
// wrong value cannot be detected here.
targetScope = 'resourceGroup'

@description('The verified Production web host, e.g. juple.co.kr (bound with `az containerapp hostname add/bind`).')
@minLength(1)
#disable-next-line no-unused-params
param customDomainName string

@description('The existing managed certificate that covers customDomainName.')
@minLength(1)
#disable-next-line no-unused-params
param managedCertificateName string

@description('The real Google Play listing URL - never invented before a listing exists.')
@minLength(1)
#disable-next-line no-unused-params
param googlePlayUrl string

@description('The certificate that signs the INSTALLED app: the Google Play App Signing certificate, never the upload key (assetlinks.json).')
@minLength(1)
#disable-next-line no-unused-params
param androidAssetlinksSha256Fingerprints string

@minLength(1)
#disable-next-line no-unused-params
param legalOperatorName string

@minLength(1)
#disable-next-line no-unused-params
param legalBusinessRegistrationNumber string

@minLength(1)
#disable-next-line no-unused-params
param legalBusinessAddress string

@description('YYYY-MM-DD.')
@minLength(1)
#disable-next-line no-unused-params
param legalEffectiveDate string
