using Juple.Application.Collections;

namespace Juple.Application.Collections.Public;

/// <summary>Resolution of an active share of an active Collection - server-side only, never serialized.</summary>
public sealed record PublicShareState(
    long ShareId,
    long CollectionId,
    string Name,
    bool IsLocked,
    int LockVersion,
    Juple.Domain.Collections.CollectionSharePermission Permission = Juple.Domain.Collections.CollectionSharePermission.Read,
    Juple.Domain.Collections.CollectionSharePasswordMode SharePasswordMode = Juple.Domain.Collections.CollectionSharePasswordMode.None,
    int SharePasswordVersion = 0);

public interface IPublicCollectionShareStore
{
    Task<PublicShareState?> GetStateAsync(string publicId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Items of the share's Collection that belong to the Collection's Owner, plus links signed-in
    /// holders added through a writable link (CollectionItem.AddedViaPublicShare) - only their
    /// public-safe fields. A member's (Contributor's) own Item is never published (defense in depth:
    /// collaboration and public sharing are mutually exclusive, but a public page must never carry
    /// a member's Item even if that invariant were ever broken).
    /// </summary>
    Task<PublicCollectionItemPage?> GetItemsAsync(
        string publicId,
        CollectionItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
