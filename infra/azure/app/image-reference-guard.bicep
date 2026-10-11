// Resource-less guard for how the container image is identified (see imageTag / imageDigest in main.bicep).
// Its only purpose is the parameter validation below: ARM rejects the deployment during template validation -
// before anything is created or changed - when no image is named, or an "image digest" is not a sha256 digest.
// Nothing is created and nothing is an output. Values are not secrets.
targetScope = 'resourceGroup'

@description('1 when a tag or a digest was supplied (must be 1). The template never picks an image on its own, and never falls back to a floating tag such as latest.')
@minValue(1)
#disable-next-line no-unused-params
param imageReferenceSupplied int

@description('0 when no digest was supplied; 71 when it is exactly "sha256:" followed by 64 characters (the only valid length of a sha256 image digest reference). Anything else is a malformed digest.')
@allowed([
  0
  71
])
#disable-next-line no-unused-params
param imageDigestLength int
