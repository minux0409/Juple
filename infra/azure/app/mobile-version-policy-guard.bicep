// Resource-less guard for the mobile update policy parameters (MobileVersionPolicy). ARM rejects the deployment during template
// validation - before anything is created or changed - when a platform's policy contradicts itself or points at a non-https store
// page. The API itself degrades (ignores a broken platform) instead of refusing to start, so THIS is where a bad value is caught.
// Nothing is created and nothing is an output. Values are not secrets.
targetScope = 'resourceGroup'

@description('1 when AndroidMinimumSupportedBuild <= AndroidLatestBuild (must be 1): a minimum above the latest would force users onto a build that does not exist.')
@minValue(1)
#disable-next-line no-unused-params
param androidMinimumNotAboveLatest int

@description('1 when the iOS minimum is not above the iOS latest (must be 1).')
@minValue(1)
#disable-next-line no-unused-params
param iosMinimumNotAboveLatest int

@description('1 when every configured store URL is an absolute https URL or empty (must be 1).')
@minValue(1)
#disable-next-line no-unused-params
param storeUrlsAreHttpsOrEmpty int

@description('1 when no build number is negative (must be 1).')
@minValue(1)
#disable-next-line no-unused-params
param buildsAreNotNegative int
