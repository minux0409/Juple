using Juple.Application.Collections.Access;

namespace Juple.Application.Collections.GetCollectionShare;

/// <summary>
/// The Collection's active 모든 사용자 link, for anyone who may view the Collection (the Owner or an
/// accepted Contributor/Viewer) - so a member can pass on a link the Owner already made public.
/// Read-only: only whether the link is on and its PublicId (the URL is composed by the API) - never
/// the link's permission, the share password or anything else from the Owner's share settings, and
/// never a new link or token. A pending invitee or anyone else is refused like any other View.
/// </summary>
public sealed class GetCollectionShareLinkService(
    ICollectionAccessService accessService,
    ICollectionShareLinkReader shareLinkReader) : IGetCollectionShareLinkService
{
    public async Task<string?> GetActivePublicIdAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireAsync(userId, collectionId, CollectionPermission.View, cancellationToken);
        return await shareLinkReader.GetActivePublicIdAsync(collectionId, cancellationToken);
    }
}

public interface IGetCollectionShareLinkService
{
    /// <summary>Null when the Collection has no active public link.</summary>
    Task<string?> GetActivePublicIdAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default);
}

/// <summary>Reads just the PublicId of a Collection's active share - access is checked by the caller.</summary>
public interface ICollectionShareLinkReader
{
    Task<string?> GetActivePublicIdAsync(long collectionId, CancellationToken cancellationToken = default);
}
