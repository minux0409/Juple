namespace Juple.Application.Images;

/// <summary>
/// Raw DB projection of an Item's representative image (SortOrder ASC, Id ASC first row) - an
/// internal handoff shape between a Store's query method and its Application Service, which
/// resolves BlobName to a RepresentativeImageDto via IItemImageStorage before it ever reaches a
/// Controller. BlobName never appears in a type returned to a Controller.
/// </summary>
public sealed record ItemRepresentativeImageRef(long ImageId, string BlobName);
