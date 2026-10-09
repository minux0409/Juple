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
    int SharePasswordVersion = 0,
    bool IsPublic = true,
    string? Icon = null,
    string? Color = null,
    long OwnerUserId = 0,
    string? IconImageBlobName = null);

public interface IPublicCollectionShareStore
{
    /// <summary>The PUBLIC state of an active link (IsPublic): every anonymous read and every public write goes through this and so can never reach a private link.</summary>
    Task<PublicShareState?> GetStateAsync(string publicId, CancellationToken cancellationToken = default);

    /// <summary>The state of an active link whether or not its contents are public - only for the password gate and the join-request landing, never for content.</summary>
    Task<PublicShareState?> GetLinkStateAsync(string publicId, CancellationToken cancellationToken = default);

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
